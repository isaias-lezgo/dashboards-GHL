"use client";

import { useCallback, useRef, useState } from "react";
import {
  executeTool,
  executeExportCsv,
  WRITE_TOOLS,
  type ChatDataset,
} from "@/lib/ai-tools";
import { executeUploadedTableTool } from "@/lib/attachment-tools";
import type { UploadedTable } from "@/lib/attachments";
import {
  fetchContactMessages,
  fetchConversationThreads,
  fetchContactTasks,
  fetchContactNotes,
} from "@/lib/ghl-fetchers";
import { triggerDownload } from "@/lib/download";
import { downloadPdf } from "@/lib/pdf/build-pdf";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
export interface DocumentBlock {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
}
export type AnyBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | DocumentBlock;

export interface ApiMessage {
  role: "user" | "assistant";
  content: AnyBlock[];
}

export interface UIMessage {
  role: "user" | "assistant";
  blocks: AnyBlock[];
}

export interface QuestionOption {
  label: string;
  value?: string;
  hint?: string;
}
export interface PendingQuestion {
  toolUseId: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
  context?: string;
}
export type AnswerPayload =
  | { values: string[]; labels?: string[] }
  | { text: string };

// ─── Write mode (modo edición) ──────────────────────────────────────────────
export interface WriteDiffRow {
  id: string;
  label: string;
  sublabel?: string;
  before: string;
  after: string;
}
export interface PendingWrite {
  toolUseId: string;
  action: string;
  title: string; // "Editar contacto" | "Editar 23 contactos" | "Crear campo" | "Editar campo"
  subtitle?: string;
  rows: WriteDiffRow[];
  payload: Record<string, unknown>;
}
export interface WriteReceipt {
  status: "applied" | "partial" | "cancelled" | "failed";
  title: string;
  detail: string;
  ok?: number;
  failed?: number;
  failures?: Array<{ id: string; name?: string; error: string }>;
  at: string;
}

// What the composer hands to send(): content blocks to append to the user
// message, plus any tabular files to register for the query/join tools.
export interface ReadyAttachment {
  blocks: Array<ImageBlock | DocumentBlock | TextBlock>;
  tables?: UploadedTable[];
}

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TURNS = 15;
const PRICING = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

function estimateCost(u: TurnUsage): number {
  return (
    (u.inputTokens * PRICING.input +
      u.outputTokens * PRICING.output +
      u.cacheReadTokens * PRICING.cacheRead +
      u.cacheCreationTokens * PRICING.cacheWrite) /
    1_000_000
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  datasetSummary: string;
  dataset: ChatDataset;
  writeEnabled: boolean;
  onToolExecuted?: (
    name: string,
    input: Record<string, unknown>,
    result: unknown
  ) => void;
}

export interface AgentLoopReturn {
  messages: UIMessage[];
  busy: boolean;
  status: string | null;
  error: string | null;
  totalCost: number;
  totalTools: number;
  send: (text: string, attachments?: ReadyAttachment[]) => void;
  stop: () => void;
  reset: () => void;
  runWithMessages: (msgs: UIMessage[]) => void;
  pendingQuestion: PendingQuestion | null;
  answer: (payload: AnswerPayload) => void;
  pendingWrite: PendingWrite | null;
  resolveWrite: (decision: { approve: boolean }) => void;
  writeReceipts: WriteReceipt[];
}

export function useAgentLoop({
  datasetSummary,
  dataset,
  writeEnabled,
  onToolExecuted,
}: AgentLoopOptions): AgentLoopReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTools, setTotalTools] = useState(0);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const pauseStashRef = useRef<{
    convo: UIMessage[];
    partialResults: ToolResultBlock[];
    askToolUseId: string;
  } | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [writeReceipts, setWriteReceipts] = useState<WriteReceipt[]>([]);
  const writeStashRef = useRef<{
    convo: UIMessage[];
    priorResults: ToolResultBlock[]; // lecturas + escrituras ya resueltas este turno
    queue: ToolUseBlock[]; // escrituras pendientes (la primera es la activa)
  } | null>(null);

  const stopRef = useRef(false);
  const messagesRef = useRef<UIMessage[]>([]);
  const uploadedTablesRef = useRef<UploadedTable[]>([]);
  // Always use the latest callback without re-creating runWithMessages
  const onToolExecutedRef = useRef(onToolExecuted);
  onToolExecutedRef.current = onToolExecuted;

  // Build the confirmation-card diff for one write tool_use, reading the
  // "before" from the record the browser already holds (never the model's
  // narration of it).
  const buildPendingWrite = useCallback(
    (tu: ToolUseBlock): PendingWrite => {
      const cur = (
        rec: { customFieldsResolved?: Record<string, string | string[]> } | undefined,
        name: string,
      ): string => {
        const v = rec?.customFieldsResolved?.[name];
        if (v == null || (Array.isArray(v) && v.length === 0) || v === "")
          return "(sin valor)";
        return Array.isArray(v) ? v.join(", ") : String(v);
      };

      if (tu.name === "set_contact_fields" || tu.name === "set_opportunity_fields") {
        const isContact = tu.name === "set_contact_fields";
        const updates = Array.isArray(tu.input.updates)
          ? (tu.input.updates as Array<Record<string, unknown>>)
          : [];
        const rows: WriteDiffRow[] = [];
        for (const u of updates) {
          const id = String(isContact ? u.contactId : u.opportunityId);
          const rec = isContact
            ? dataset.contacts.find((c) => c.id === id)
            : dataset.opportunities.find((o) => o.id === id);
          const label = (rec as { name?: string } | undefined)?.name ?? id;
          const sublabel = isContact
            ? [
                (rec as { email?: string } | undefined)?.email,
                (rec as { phone?: string } | undefined)?.phone,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined;
          const fields = (u.fields ?? {}) as Record<string, string | string[]>;
          for (const [fname, val] of Object.entries(fields)) {
            rows.push({
              id,
              label,
              sublabel: sublabel || undefined,
              before: cur(rec as { customFieldsResolved?: Record<string, string | string[]> }, fname),
              after: Array.isArray(val) ? val.join(", ") : String(val),
            });
          }
        }
        const n = updates.length;
        const noun = isContact ? "contacto" : "oportunidad";
        return {
          toolUseId: tu.id,
          action: tu.name,
          payload: tu.input,
          title:
            n === 1
              ? `Editar ${noun}`
              : `Editar ${n} ${isContact ? "contactos" : "oportunidades"}`,
          rows,
        };
      }

      if (tu.name === "create_custom_field") {
        const p = tu.input as Record<string, unknown>;
        const opts = Array.isArray(p.options) ? (p.options as string[]) : [];
        return {
          toolUseId: tu.id,
          action: tu.name,
          payload: tu.input,
          title: "Crear campo",
          subtitle: `${p.name} · ${p.dataType}${opts.length ? " · " + opts.join(", ") : ""}`,
          rows: [],
        };
      }

      // update_custom_field
      const p = tu.input as Record<string, unknown>;
      const def = dataset.customFieldDefs.find((d) => d.id === p.fieldId);
      const rows: WriteDiffRow[] = [];
      if (typeof p.name === "string" && p.name && def)
        rows.push({ id: String(p.fieldId), label: "Nombre", before: def.name, after: p.name });
      if (Array.isArray(p.addOptions) && p.addOptions.length && def) {
        const existing = def.picklistOptions ?? [];
        const present = new Set(existing.map((e) => e.toLowerCase()));
        const after = [
          ...existing,
          ...(p.addOptions as string[]).filter((o) => !present.has(String(o).toLowerCase())),
        ];
        rows.push({
          id: String(p.fieldId),
          label: "Opciones",
          before: existing.join(", ") || "(ninguna)",
          after: after.join(", "),
        });
      }
      return {
        toolUseId: tu.id,
        action: tu.name,
        payload: tu.input,
        title: "Editar campo",
        subtitle: def?.name,
        rows,
      };
    },
    [dataset],
  );

  // Optimistic in-memory patch after a successful write, so the model sees a
  // consistent world in the same session without a full re-sync.
  const applyOptimisticPatch = useCallback(
    (pw: PendingWrite) => {
      const p = pw.payload as Record<string, unknown>;
      if (pw.action === "set_contact_fields" || pw.action === "set_opportunity_fields") {
        const isContact = pw.action === "set_contact_fields";
        const updates = Array.isArray(p.updates)
          ? (p.updates as Array<Record<string, unknown>>)
          : [];
        for (const u of updates) {
          const id = String(isContact ? u.contactId : u.opportunityId);
          const rec = isContact
            ? dataset.contacts.find((c) => c.id === id)
            : dataset.opportunities.find((o) => o.id === id);
          if (!rec) continue;
          rec.customFieldsResolved = rec.customFieldsResolved ?? {};
          const fields = (u.fields ?? {}) as Record<string, string | string[]>;
          for (const [name, val] of Object.entries(fields)) {
            rec.customFieldsResolved[name] = val;
          }
        }
      } else if (pw.action === "create_custom_field") {
        dataset.customFieldDefs.push({
          id: `optimistic-${Date.now()}`,
          name: String(p.name),
          objectKey: p.objectKey === "opportunity" ? "opportunity" : "contact",
          dataType: String(p.dataType),
          picklistOptions: Array.isArray(p.options) ? (p.options as string[]).map(String) : undefined,
        });
      } else if (pw.action === "update_custom_field") {
        const def = dataset.customFieldDefs.find((d) => d.id === p.fieldId);
        if (def) {
          if (typeof p.name === "string" && p.name) def.name = p.name;
          if (Array.isArray(p.addOptions)) {
            const present = new Set((def.picklistOptions ?? []).map((o) => o.toLowerCase()));
            def.picklistOptions = [
              ...(def.picklistOptions ?? []),
              ...(p.addOptions as string[])
                .map(String)
                .filter((o) => !present.has(o.toLowerCase())),
            ];
          }
        }
      }
    },
    [dataset],
  );

  const runWithMessages = useCallback(
    async (initialMessages: UIMessage[]) => {
      stopRef.current = false;
      setBusy(true);
      setError(null);
      let convo = [...initialMessages];

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          if (stopRef.current) break;
          setStatus(turn === 0 ? "Pensando…" : "Continuando…");

          const apiMessages: ApiMessage[] = convo.map((m) => ({
            role: m.role,
            content: m.blocks,
          }));

          const userTimezone =
            Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasetSummary, messages: apiMessages, userTimezone, writeEnabled }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(
              (errData as { error?: string }).error || `HTTP ${res.status}`
            );
          }

          const data = (await res.json()) as {
            stopReason: string;
            content: AnyBlock[];
            usage: TurnUsage;
          };

          setTotalCost((c) => c + estimateCost(data.usage));

          const assistantMsg: UIMessage = {
            role: "assistant",
            blocks: data.content,
          };
          convo = [...convo, assistantMsg];
          setMessages(convo);
          messagesRef.current = convo;

          const toolUses = data.content.filter(
            (b): b is ToolUseBlock => b.type === "tool_use"
          );

          if (toolUses.length === 0) {
            if (data.stopReason === "max_tokens") {
              convo = [
                ...convo,
                {
                  role: "user",
                  blocks: [{ type: "text", text: "Continúa." }],
                },
              ];
              setMessages(convo);
              messagesRef.current = convo;
              continue;
            }
            break;
          }

          setStatus(
            toolUses.length === 1
              ? `Ejecutando ${toolUses[0].name}…`
              : `Ejecutando ${toolUses.length} herramientas…`
          );

          // A clarifying question pauses the loop. Run any sibling tools so their
          // results are ready for the resume, but hold the request until the user
          // answers (the model is told to call ask_user alone, so toRun is usually
          // empty here).
          // Writes never execute here: they pause at the confirmation gate
          // below. ask_user also pauses. Everything else runs now.
          const askUse = toolUses.find((b) => b.name === "ask_user");
          const writeUses = toolUses.filter((b) => WRITE_TOOLS.has(b.name));
          const toRun = toolUses.filter(
            (b) => b.name !== "ask_user" && !WRITE_TOOLS.has(b.name),
          );

          const toolResults: ToolResultBlock[] = await Promise.all(
            toRun.map(async (tu): Promise<ToolResultBlock> => {
              try {
                let result: unknown;
                if (tu.name === "get_contact_messages") {
                  result = await fetchContactMessages(tu.input);
                } else if (tu.name === "search_conversations") {
                  result = await fetchConversationThreads(tu.input);
                } else if (tu.name === "get_contact_tasks") {
                  result = await fetchContactTasks(tu.input);
                } else if (tu.name === "get_contact_notes") {
                  result = await fetchContactNotes(tu.input);
                } else if (tu.name === "export_csv") {
                  const exportResult = executeExportCsv(tu.input, dataset);
                  if (exportResult.rowCount > 0)
                    triggerDownload({
                      content: exportResult.csvContent,
                      filename: exportResult.filename,
                      mimeType: "text/csv;charset=utf-8;",
                    });
                  result = {
                    success: exportResult.rowCount > 0,
                    filename: exportResult.filename,
                    rowCount: exportResult.rowCount,
                  };
                } else if (tu.name === "create_pdf") {
                  result = await downloadPdf(tu.input);
                } else if (
                  tu.name === "list_uploaded_files" ||
                  tu.name === "query_uploaded_table" ||
                  tu.name === "join_uploaded_table"
                ) {
                  result = executeUploadedTableTool(
                    tu.name,
                    tu.input,
                    uploadedTablesRef.current,
                    dataset
                  );
                } else {
                  result = executeTool(tu.name, tu.input, dataset);
                }

                onToolExecutedRef.current?.(tu.name, tu.input, result);

                return {
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: JSON.stringify(result),
                };
              } catch (err) {
                return {
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                  }),
                  is_error: true,
                };
              }
            })
          );

          setTotalTools((n) => n + toRun.length);

          if (askUse) {
            const aInput = askUse.input as Record<string, unknown>;
            const rawOptions = Array.isArray(aInput.options)
              ? (aInput.options as unknown[])
              : [];
            const options: QuestionOption[] = rawOptions
              .filter(
                (o): o is Record<string, unknown> =>
                  Boolean(o) && typeof o === "object",
              )
              .map((o) => ({
                label: String(o.label ?? ""),
                value: o.value !== undefined ? String(o.value) : undefined,
                hint: o.hint !== undefined ? String(o.hint) : undefined,
              }))
              .filter((o) => o.label);
            pauseStashRef.current = {
              convo,
              partialResults: toolResults,
              askToolUseId: askUse.id,
            };
            setPendingQuestion({
              toolUseId: askUse.id,
              question: String(aInput.question ?? ""),
              options,
              multiSelect: aInput.multiSelect === true,
              context:
                typeof aInput.context === "string" ? aInput.context : undefined,
            });
            setBusy(false);
            setStatus(null);
            return;
          }

          // The write gate: any write tool the model emitted pauses the loop
          // and surfaces a confirmation card with the diff read from the real
          // record. Nothing reaches GHL until the user approves. Writes are
          // handled one-at-a-time from a queue (see resolveWrite); the read
          // results ride along until the queue drains.
          if (writeUses.length > 0) {
            setStatus(null);
            writeStashRef.current = {
              convo,
              priorResults: toolResults,
              queue: writeUses,
            };
            setPendingWrite(buildPendingWrite(writeUses[0]));
            setBusy(false);
            return;
          }

          convo = [...convo, { role: "user", blocks: toolResults }];
          setMessages(convo);
          messagesRef.current = convo;
        }

        const lastAssistant = [...convo]
          .reverse()
          .find((m) => m.role === "assistant");
        const hasText = lastAssistant?.blocks.some(
          (b) => b.type === "text" && (b as TextBlock).text.trim()
        );
        if (!hasText) {
          const notice: UIMessage = {
            role: "assistant",
            blocks: [
              {
                type: "text",
                text: "⚠️ El agente alcanzó el límite de turnos sin producir una respuesta completa. Intenta hacer una pregunta más específica.",
              },
            ],
          };
          const final = [...convo, notice];
          setMessages(final);
          messagesRef.current = final;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [datasetSummary, dataset, writeEnabled, buildPendingWrite]
  );

  const resolveWrite = useCallback(
    async (decision: { approve: boolean }) => {
      const stash = writeStashRef.current;
      const pw = pendingWrite;
      if (!stash || !pw) return;
      const active = stash.queue[0];
      let resultForModel: unknown;
      let receipt: WriteReceipt;

      if (!decision.approve) {
        resultForModel = { cancelled: true };
        receipt = {
          status: "cancelled",
          title: pw.title,
          detail: pw.subtitle ?? pw.rows[0]?.label ?? "",
          at: new Date().toISOString(),
        };
      } else {
        try {
          const res = await fetch("/api/ghl-write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: pw.action, payload: pw.payload }),
          });
          const data = (await res.json()) as {
            ok?: number;
            failed?: number;
            failures?: Array<{ id: string; name?: string; error: string }>;
            error?: string;
          };
          resultForModel = data;
          const failed = data.failed ?? 0;
          const ok = data.ok ?? 0;
          const status: WriteReceipt["status"] =
            failed === 0 && ok > 0 ? "applied" : ok > 0 ? "partial" : "failed";
          receipt = {
            status,
            title: pw.title,
            detail:
              pw.subtitle ??
              (pw.rows[0] ? `${pw.rows[0].label} → ${pw.rows[0].after}` : data.error ?? ""),
            ok,
            failed,
            failures: data.failures ?? [],
            at: new Date().toISOString(),
          };
          if (status !== "failed") applyOptimisticPatch(pw);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          resultForModel = { error: msg };
          receipt = { status: "failed", title: pw.title, detail: msg, at: new Date().toISOString() };
        }
      }

      setWriteReceipts((r) => [...r, receipt]);
      const writeResult: ToolResultBlock = {
        type: "tool_result",
        tool_use_id: active.id,
        content: JSON.stringify(resultForModel),
        is_error: decision.approve && receipt.status === "failed",
      };
      const priorResults = [...stash.priorResults, writeResult];
      const rest = stash.queue.slice(1);

      setTotalTools((n) => n + 1);

      if (rest.length > 0) {
        writeStashRef.current = { convo: stash.convo, priorResults, queue: rest };
        setPendingWrite(buildPendingWrite(rest[0]));
        return; // siguiente tarjeta
      }
      // Cola vacía: emitir TODOS los tool_result y reanudar el loop.
      writeStashRef.current = null;
      setPendingWrite(null);
      const resumed: UIMessage[] = [
        ...stash.convo,
        { role: "user", blocks: priorResults },
      ];
      setMessages(resumed);
      messagesRef.current = resumed;
      void runWithMessages(resumed);
    },
    [pendingWrite, buildPendingWrite, applyOptimisticPatch, runWithMessages],
  );

  const answer = useCallback(
    (payload: AnswerPayload) => {
      const stash = pauseStashRef.current;
      if (!stash) return;

      const summary =
        "values" in payload
          ? (payload.labels ?? payload.values).join(", ")
          : payload.text;
      const askResult: ToolResultBlock = {
        type: "tool_result",
        tool_use_id: stash.askToolUseId,
        content:
          "values" in payload
            ? JSON.stringify({ answer: payload.values })
            : JSON.stringify({ answer: payload.text, freeText: true }),
      };

      // The user message carries the tool_result blocks (sibling results + the
      // ask_user answer) FIRST — the Anthropic API requires tool_result blocks to
      // precede any other content — followed by a visible text bubble with the
      // chosen answer. Every prior tool_use stays paired with a tool_result.
      const userMsg: UIMessage = {
        role: "user",
        blocks: [
          ...stash.partialResults,
          askResult,
          { type: "text", text: summary },
        ],
      };
      const resumed = [...stash.convo, userMsg];

      pauseStashRef.current = null;
      setPendingQuestion(null);
      setMessages(resumed);
      messagesRef.current = resumed;
      void runWithMessages(resumed);
    },
    [runWithMessages],
  );

  const send = useCallback(
    (text: string, attachments?: ReadyAttachment[]) => {
      if (busy) return;
      // If a clarifying question is open, route the typed text as its answer so
      // the pending ask_user tool_use gets a matching tool_result.
      if (pauseStashRef.current) {
        answer({ text });
        return;
      }
      // Register any tabular files so the query/join tools can see them.
      const newTables = (attachments ?? []).flatMap((a) => a.tables ?? []);
      if (newTables.length > 0) {
        uploadedTablesRef.current = [...uploadedTablesRef.current, ...newTables];
      }
      // Attachment blocks come FIRST, then the visible text.
      const attachmentBlocks = (attachments ?? []).flatMap((a) => a.blocks);
      const blocks: AnyBlock[] = [...attachmentBlocks];
      if (text) blocks.push({ type: "text", text });
      if (blocks.length === 0) return;

      const userMsg: UIMessage = { role: "user", blocks };
      const next = [...messagesRef.current, userMsg];
      setMessages(next);
      messagesRef.current = next;
      void runWithMessages(next);
    },
    [busy, runWithMessages, answer]
  );

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    messagesRef.current = [];
    setError(null);
    setStatus(null);
    setTotalCost(0);
    setTotalTools(0);
    setPendingQuestion(null);
    pauseStashRef.current = null;
    uploadedTablesRef.current = [];
    setPendingWrite(null);
    setWriteReceipts([]);
    writeStashRef.current = null;
  }, []);

  return {
    messages,
    busy,
    status,
    error,
    totalCost,
    totalTools,
    send,
    stop,
    reset,
    runWithMessages,
    pendingQuestion,
    answer,
    pendingWrite,
    resolveWrite,
    writeReceipts,
  };
}
