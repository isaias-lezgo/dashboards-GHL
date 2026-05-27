"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, Sparkles, RefreshCcw, Wrench, AlertCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { executeTool, executeExportCsv, type ChatDataset, type ExportCsvResult } from "@/lib/ai-tools";
import { buildDatasetSummary } from "@/lib/ai-context";

function triggerCsvDownload({ csvContent, filename }: ExportCsvResult): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: ChatDataset;
  locationId?: string;
}

// Minimal subset of Anthropic content-block shapes we deal with on the client.
interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
type AnyBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ApiMessage {
  role: "user" | "assistant";
  content: AnyBlock[];
}

interface UIMessage {
  role: "user" | "assistant";
  blocks: AnyBlock[];
}

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Sonnet 4.6 pricing per million tokens (USD)
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

const MAX_TURNS = 15; // agent-loop safety net

// Server-side tool: fetches live conversation messages for one contact from
// GHL, bypassing the dashboard's recent-sample. Returns a shape compatible with
// what the AI expects (rows + count).
async function fetchContactMessages(input: Record<string, unknown>): Promise<unknown> {
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  if (!contactId) return { error: "Missing contactId" };
  const limit = typeof input.limit === "number" ? Math.min(100, Math.max(1, Math.floor(input.limit))) : 50;

  const res = await fetch(
    `/api/conversations?contactIds=${encodeURIComponent(contactId)}`,
    { method: "GET" }
  );
  if (!res.ok) {
    return { error: `GHL fetch failed (HTTP ${res.status})` };
  }
  const data = (await res.json()) as {
    threads: Array<{ contactId: string; messages: Array<Record<string, unknown>> }>;
  };
  const thread = data.threads?.find((t) => t.contactId === contactId);
  const msgs = thread?.messages ?? [];
  // /api/conversations returns oldest→newest; flip to newest→oldest then cap.
  const sorted = [...msgs].sort(
    (a, b) =>
      new Date(String(b.createdAt ?? "")).getTime() -
      new Date(String(a.createdAt ?? "")).getTime()
  );
  const capped = sorted.slice(0, limit);
  return {
    contactId,
    returned: capped.length,
    totalAvailable: msgs.length,
    rows: capped.map((m) => ({
      id: m.id,
      direction: m.direction,
      source: m.source,
      content:
        typeof m.content === "string" && m.content.length > 500
          ? m.content.slice(0, 500) + "…"
          : m.content,
      createdAt: m.createdAt,
    })),
  };
}

export function AIChatPanel({ open, onOpenChange, dataset, locationId }: AIChatPanelProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTools, setTotalTools] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Rebuild summary whenever the dataset changes — cheap, ~few KB of text.
  const datasetSummary = useMemo(
    () => buildDatasetSummary(dataset, locationId),
    [dataset, locationId]
  );

  useEffect(() => {
    if (open) {
      // Focus input after open animation
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus(null);
    setTotalCost(0);
    setTotalTools(0);
  }, []);

  const runAgentLoop = useCallback(
    async (initialMessages: UIMessage[]) => {
      setBusy(true);
      setError(null);
      let convo = [...initialMessages];

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          setStatus(turn === 0 ? "Pensando…" : "Continuando…");

          const apiMessages: ApiMessage[] = convo.map((m) => ({
            role: m.role,
            content: m.blocks,
          }));

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              datasetSummary,
              messages: apiMessages,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}`);
          }

          const data = (await res.json()) as {
            stopReason: string;
            content: AnyBlock[];
            usage: TurnUsage;
          };

          setTotalCost((c) => c + estimateCost(data.usage));

          const assistantBlocks = data.content;
          const assistantMsg: UIMessage = {
            role: "assistant",
            blocks: assistantBlocks,
          };
          convo = [...convo, assistantMsg];
          setMessages(convo);

          const toolUses = assistantBlocks.filter(
            (b): b is ToolUseBlock => b.type === "tool_use"
          );

          if (toolUses.length === 0) {
            // Assistant produced a plain-text answer — we're done.
            break;
          }

          // Execute every tool_use locally and bundle the results into a
          // single user message (Anthropic requires this shape).
          setStatus(
            toolUses.length === 1
              ? `Ejecutando ${toolUses[0].name}…`
              : `Ejecutando ${toolUses.length} herramientas…`
          );

          const toolResults: ToolResultBlock[] = await Promise.all(
            toolUses.map(async (tu): Promise<ToolResultBlock> => {
              try {
                let result: unknown;
                if (tu.name === "get_contact_messages") {
                  result = await fetchContactMessages(tu.input);
                } else if (tu.name === "export_csv") {
                  const exportResult = executeExportCsv(tu.input, dataset);
                  if (exportResult.rowCount > 0) triggerCsvDownload(exportResult);
                  result = {
                    success: exportResult.rowCount > 0,
                    filename: exportResult.filename,
                    rowCount: exportResult.rowCount,
                  };
                } else {
                  result = executeTool(tu.name, tu.input, dataset);
                }
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
          setTotalTools((n) => n + toolUses.length);

          convo = [
            ...convo,
            { role: "user", blocks: toolResults },
          ];
          setMessages(convo);

          if (data.stopReason === "end_turn") {
            break;
          }

          // When the model hit the output token cap mid-thought, inject a
          // continuation prompt so the agent loop keeps going automatically.
          if (data.stopReason === "max_tokens") {
            convo = [
              ...convo,
              { role: "user", blocks: [{ type: "text", text: "Continúa." }] },
            ];
            setMessages(convo);
            continue;
          }

          if (data.stopReason !== "tool_use") {
            break;
          }
        }

        // If the loop ended but the last assistant turn had no text (only
        // tool calls), the AI never produced a visible answer. Show a notice.
        const lastAssistant = [...convo].reverse().find((m) => m.role === "assistant");
        const hasText = lastAssistant?.blocks.some((b) => b.type === "text" && (b as TextBlock).text.trim());
        if (!hasText) {
          const notice: UIMessage = {
            role: "assistant",
            blocks: [
              {
                type: "text",
                text: "⚠️ El agente alcanzó el límite de turnos sin producir una respuesta completa. Intenta hacer una pregunta más específica o dividir la tarea en pasos más pequeños.",
              },
            ],
          };
          setMessages([...convo, notice]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [datasetSummary, dataset]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: UIMessage = {
      role: "user",
      blocks: [{ type: "text", text }],
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    void runAgentLoop(next);
  }, [input, busy, messages, runAgentLoop]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl focus:outline-none"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Analizar con IA
          </SheetTitle>
          <SheetDescription className="text-xs">
            Pregúntame cualquier cosa sobre tus contactos, oportunidades, pautas o citas.
          </SheetDescription>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 && !busy && (
            <EmptyState onSuggest={(s) => setInput(s)} />
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {busy && status && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="¿Cuántos leads de Meta sin cita esta semana?"
            rows={2}
            className="min-h-[44px] w-full resize-none text-sm"
            disabled={busy}
          />
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Sonnet 4.6 · {totalTools} {totalTools === 1 ? "herramienta" : "herramientas"} · ~${totalCost.toFixed(4)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={busy || messages.length === 0}
                className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
              >
                <RefreshCcw className="h-3 w-3" />
                Reiniciar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={send}
                disabled={busy || !input.trim()}
                className="h-6 gap-1 px-2.5 text-[10px]"
                aria-label="Enviar"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {!busy && "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function EmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  const suggestions = [
    "¿Cuántos contactos de Meta tengo este mes?",
    "Dame un resumen del lead con más actividad.",
    "¿Qué pautas tipo Facebook tienen oportunidades abiertas?",
    "Top 5 asesores por valor de oportunidades cerradas.",
  ];
  return (
    <div className="space-y-3 py-2">
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Las preguntas se responden contra los datos ya cargados en el panel.
        Para conteos exactos uso aritmética determinista, no estimaciones.
      </div>
      <p className="text-xs font-medium text-muted-foreground">Sugerencias:</p>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="rounded-md border border-border/60 bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const textBlocks = message.blocks.filter((b): b is TextBlock => b.type === "text");
  const toolUseBlocks = message.blocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
  const toolResultBlocks = message.blocks.filter(
    (b): b is ToolResultBlock => b.type === "tool_result"
  );

  // A pure tool_result message (from the agent loop) — render single summary chip.
  if (message.role === "user" && toolResultBlocks.length > 0 && textBlocks.length === 0) {
    return <ToolResultsSummary blocks={toolResultBlocks} />;
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {textBlocks.map((b, i) => (
        <div
          key={`t-${i}`}
          className={cn(
            "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-foreground"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{b.text}</p>
          ) : (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold",
                "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
                "prose-table:my-2 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-th:bg-muted/50 prose-td:px-2 prose-td:py-1 prose-td:border-border/40 prose-th:border-border/40",
                "prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
                "prose-strong:text-foreground prose-a:text-primary"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
      {toolUseBlocks.length > 0 && <GroupedToolUseChips blocks={toolUseBlocks} />}
    </div>
  );
}

function GroupedToolUseChips({ blocks }: { blocks: ToolUseBlock[] }) {
  const groups = blocks.reduce<Record<string, ToolUseBlock[]>>((acc, b) => {
    (acc[b.name] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(groups).map(([name, group]) => (
        <div
          key={name}
          className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          <Wrench className="h-2.5 w-2.5 shrink-0" />
          <span className="font-medium text-foreground/70">{name}</span>
          {group.length > 1 && (
            <span className="rounded-full bg-border/70 px-1 font-mono leading-tight">
              ×{group.length}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolResultsSummary({ blocks }: { blocks: ToolResultBlock[] }) {
  const errors = blocks.filter((b) => b.is_error).length;
  const ok = blocks.length - errors;
  const preview = blocks.length === 1 ? previewResult(blocks[0].content) : null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[10px]",
        errors > 0
          ? "border-destructive/30 bg-destructive/8 text-destructive"
          : "border-border/40 bg-muted/25 text-muted-foreground"
      )}
    >
      <span className="opacity-50">↳</span>
      <span>
        {preview ??
          `${ok} resultado${ok !== 1 ? "s" : ""}${errors > 0 ? `, ${errors} error${errors !== 1 ? "es" : ""}` : ""}`}
      </span>
    </div>
  );
}


function previewResult(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.error) return `error: ${String(parsed.error).slice(0, 80)}`;
    if (typeof parsed?.filename === "string" && typeof parsed?.rowCount === "number") {
      return parsed.success
        ? `${parsed.rowCount} filas → ${parsed.filename}`
        : `sin filas — nada exportado`;
    }
    if (Array.isArray(parsed?.rows)) {
      return `${parsed.returned ?? parsed.rows.length} fila${(parsed.returned ?? parsed.rows.length) === 1 ? "" : "s"}${parsed.truncated ? " (truncado)" : ""}`;
    }
    if (Array.isArray(parsed?.groups)) {
      return `${parsed.groups.length} grupo${parsed.groups.length === 1 ? "" : "s"} · total ${parsed.total ?? "?"}`;
    }
    if (parsed?.id) return `id ${String(parsed.id).slice(0, 20)}`;
    return `${Object.keys(parsed ?? {}).length} campos`;
  } catch {
    return content.slice(0, 60);
  }
}
