"use client";

import { useCallback, useRef, useState } from "react";
import {
  executeTool,
  executeExportCsv,
  type ChatDataset,
} from "@/lib/ai-tools";
import {
  fetchContactMessages,
  fetchConversationThreads,
  fetchContactTasks,
  fetchContactNotes,
} from "@/lib/ghl-fetchers";

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
export type AnyBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ApiMessage {
  role: "user" | "assistant";
  content: AnyBlock[];
}

export interface UIMessage {
  role: "user" | "assistant";
  blocks: AnyBlock[];
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

function triggerCsvDownload({
  csvContent,
  filename,
}: {
  csvContent: string;
  filename: string;
}): void {
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  datasetSummary: string;
  dataset: ChatDataset;
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
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
  runWithMessages: (msgs: UIMessage[]) => void;
}

export function useAgentLoop({
  datasetSummary,
  dataset,
  onToolExecuted,
}: AgentLoopOptions): AgentLoopReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTools, setTotalTools] = useState(0);

  const stopRef = useRef(false);
  const messagesRef = useRef<UIMessage[]>([]);
  // Always use the latest callback without re-creating runWithMessages
  const onToolExecutedRef = useRef(onToolExecuted);
  onToolExecutedRef.current = onToolExecuted;

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
            body: JSON.stringify({ datasetSummary, messages: apiMessages, userTimezone }),
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

          const toolResults: ToolResultBlock[] = await Promise.all(
            toolUses.map(async (tu): Promise<ToolResultBlock> => {
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
                  if (exportResult.rowCount > 0) triggerCsvDownload(exportResult);
                  result = {
                    success: exportResult.rowCount > 0,
                    filename: exportResult.filename,
                    rowCount: exportResult.rowCount,
                  };
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

          setTotalTools((n) => n + toolUses.length);

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
    [datasetSummary, dataset]
  );

  const send = useCallback(
    (text: string) => {
      if (busy) return;
      const userMsg: UIMessage = {
        role: "user",
        blocks: [{ type: "text", text }],
      };
      const next = [...messagesRef.current, userMsg];
      setMessages(next);
      messagesRef.current = next;
      void runWithMessages(next);
    },
    [busy, runWithMessages]
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
  };
}
