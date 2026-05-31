"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  Sparkles,
  RefreshCcw,
  Square,
  AlertCircle,
  ArrowUpRight,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatDataset } from "@/lib/ai-tools";
import { buildDatasetSummary, CONVERSATIONS_SYSTEM_PROMPT } from "@/lib/ai-context";
import {
  useAgentLoop,
  type UIMessage,
  type TextBlock,
  type ToolUseBlock,
  type ToolResultBlock,
} from "@/hooks/use-agent-loop";
import {
  ConversationsContextPanel,
  type PanelState,
  type PanelContact,
  type PanelOpportunity,
  type PanelAppointment,
  type PanelTask,
  type PanelNote,
  type PanelLastMessage,
} from "@/components/dashboard/conversations-context-panel";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConversationsChatProps {
  dataset: ChatDataset;
  locationId?: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildPanelContact(row: Record<string, unknown>): PanelContact {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    source: row.source ? String(row.source) : undefined,
    assignedTo: row.assignedTo ? String(row.assignedTo) : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
    lastActivity: row.lastActivity ? String(row.lastActivity) : undefined,
  };
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "¿Qué leads de Meta no han respondido en más de 24h?",
  "Dame el perfil completo de [nombre del contacto]",
  "¿Quién tiene tareas vencidas hoy?",
  "Redacta un follow-up para el lead más urgente.",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsChat({
  dataset,
  locationId,
}: ConversationsChatProps) {
  const [input, setInput] = useState("");
  const [panelState, setPanelState] = useState<PanelState>({ mode: "idle" });
  const prevSummaryRef = useRef<Extract<PanelState, { mode: "summary" }> | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Inject the conversations-focused system prompt into the cached system block
  const datasetSummary = useMemo(() => {
    const base = buildDatasetSummary(dataset, locationId);
    return `${CONVERSATIONS_SYSTEM_PROMPT}\n\n${base}`;
  }, [dataset, locationId]);

  // ─── Panel updater ──────────────────────────────────────────────────────────

  const onToolExecuted = useCallback(
    (name: string, _input: Record<string, unknown>, result: unknown) => {
      const r = result as Record<string, unknown>;

      if (name === "search_contacts") {
        const rows = Array.isArray(r?.rows)
          ? (r.rows as Record<string, unknown>[])
          : [];
        if (rows.length > 1) {
          const contacts = rows.map(buildPanelContact);
          const summary: Extract<PanelState, { mode: "summary" }> = {
            mode: "summary",
            contacts,
            total:
              typeof r.returned === "number" ? r.returned : rows.length,
          };
          prevSummaryRef.current = summary;
          setPanelState(summary);
        } else if (rows.length === 1) {
          const c = buildPanelContact(rows[0]);
          setPanelState((prev) => ({
            mode: "contact",
            contact: {
              ...c,
              email: rows[0].email ? String(rows[0].email) : undefined,
              phone: rows[0].phone ? String(rows[0].phone) : undefined,
            },
            opportunities: [],
            appointments: [],
            tasks: [],
            notes: [],
            lastMessage: null,
            prevSummary:
              prev.mode === "summary" ? prev : prevSummaryRef.current ?? undefined,
          }));
        }
        return;
      }

      if (name === "aggregate") {
        const groups = Array.isArray(r?.groups)
          ? (r.groups as Record<string, unknown>[])
          : [];
        const summary: Extract<PanelState, { mode: "summary" }> = {
          mode: "summary",
          contacts: [],
          total: typeof r.total === "number" ? r.total : 0,
          groups: groups.map((g) => ({
            key: String(g.key ?? ""),
            count: typeof g.count === "number" ? g.count : 0,
            sum: typeof g.sum === "number" ? g.sum : undefined,
          })),
        };
        prevSummaryRef.current = summary;
        setPanelState(summary);
        return;
      }

      if (name === "search_conversations") {
        const threads = Array.isArray(r?.threads)
          ? (r.threads as Record<string, unknown>[])
          : [];
        const contacts: PanelContact[] = threads.map((t) => ({
          id: String(t.contactId ?? ""),
          name: String(t.contactId ?? ""),
        }));
        const summary: Extract<PanelState, { mode: "summary" }> = {
          mode: "summary",
          contacts,
          total: typeof r.returned === "number" ? r.returned : threads.length,
        };
        prevSummaryRef.current = summary;
        setPanelState(summary);
        return;
      }

      if (name === "get_contact") {
        const c = r as Record<string, unknown>;
        setPanelState((prev) => ({
          mode: "contact",
          contact: {
            id: String(c.id ?? ""),
            name: String(c.name ?? ""),
            email: c.email ? String(c.email) : undefined,
            phone: c.phone ? String(c.phone) : undefined,
            source: c.source ? String(c.source) : undefined,
            assignedTo: c.assignedTo ? String(c.assignedTo) : undefined,
            companyName: c.companyName ? String(c.companyName) : undefined,
            tags: Array.isArray(c.tags) ? (c.tags as string[]) : undefined,
          },
          opportunities: [],
          appointments: [],
          tasks: [],
          notes: [],
          lastMessage: null,
          prevSummary:
            prev.mode === "summary"
              ? prev
              : prevSummaryRef.current ?? undefined,
        }));
        return;
      }

      if (name === "get_contact_related") {
        const opps = Array.isArray(r?.opportunities)
          ? (r.opportunities as Record<string, unknown>[])
          : [];
        const appts = Array.isArray(r?.appointments)
          ? (r.appointments as Record<string, unknown>[])
          : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            opportunities: opps.map(
              (o): PanelOpportunity => ({
                id: String(o.id ?? ""),
                name: String(o.name ?? ""),
                pipelineName: String(o.pipeline ?? ""),
                stage: String(o.stage ?? ""),
                status: String(o.status ?? "open"),
                value: typeof o.value === "number" ? o.value : 0,
                currency: o.currency ? String(o.currency) : undefined,
              })
            ),
            appointments: appts.map(
              (a): PanelAppointment => ({
                id: String(a.id ?? ""),
                title: a.title ? String(a.title) : undefined,
                startTime: String(a.startTime ?? ""),
                status: String(a.status ?? ""),
              })
            ),
          };
        });
        return;
      }

      if (name === "get_contact_messages") {
        const rows = Array.isArray(r?.rows)
          ? (r.rows as Record<string, unknown>[])
          : [];
        const last = rows[0];
        if (last) {
          const lastMessage: PanelLastMessage = {
            direction:
              (last.direction as "inbound" | "outbound") ?? "inbound",
            source: String(last.source ?? ""),
            content: last.content ? String(last.content) : undefined,
            createdAt: String(last.createdAt ?? ""),
          };
          setPanelState((prev) => {
            if (prev.mode !== "contact") return prev;
            return { ...prev, lastMessage };
          });
        }
        return;
      }

      if (name === "get_contact_tasks") {
        const tasks = Array.isArray(r?.tasks)
          ? (r.tasks as Record<string, unknown>[])
          : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            tasks: tasks.map(
              (t): PanelTask => ({
                id: String(t.id ?? ""),
                title: String(t.title ?? ""),
                status:
                  (t.status as "pending" | "completed") ?? "pending",
                dueDate: t.dueDate ? String(t.dueDate) : undefined,
              })
            ),
          };
        });
        return;
      }

      if (name === "get_contact_notes") {
        const notes = Array.isArray(r?.notes)
          ? (r.notes as Record<string, unknown>[])
          : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            notes: notes.map(
              (n): PanelNote => ({
                id: String(n.id ?? ""),
                body: String(n.body ?? ""),
                userId: n.userId ? String(n.userId) : undefined,
                dateAdded: String(n.dateAdded ?? ""),
              })
            ),
          };
        });
      }
    },
    []
  );

  const {
    messages,
    busy,
    status,
    error,
    totalCost,
    totalTools,
    send,
    stop,
    reset,
  } = useAgentLoop({ datasetSummary, dataset, onToolExecuted });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    send(text);
  }, [input, busy, send]);

  const handleReset = useCallback(() => {
    reset();
    setPanelState({ mode: "idle" });
    prevSummaryRef.current = null;
  }, [reset]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleContactClick = useCallback((contact: PanelContact) => {
    setPanelState((prev) => ({
      mode: "contact",
      contact: { ...contact, email: undefined, phone: undefined },
      opportunities: [],
      appointments: [],
      tasks: [],
      notes: [],
      lastMessage: null,
      prevSummary: prev.mode === "summary" ? prev : undefined,
    }));
  }, []);

  const handleBack = useCallback(() => {
    if (prevSummaryRef.current) {
      setPanelState(prevSummaryRef.current);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-112px)] overflow-hidden">
      {/* Left: Adaptive context panel */}
      <ConversationsContextPanel
        state={panelState}
        locationId={locationId}
        onContactClick={handleContactClick}
        onBack={handleBack}
      />

      {/* Right: Chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Chat de Conversaciones</p>
            <p className="text-[10px] text-muted-foreground">
              Pregunta sobre contactos, conversaciones, tareas y notas en vivo.
            </p>
          </div>
          <div className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
            Sonnet 4.6 · {totalTools}{" "}
            {totalTools === 1 ? "herramienta" : "herramientas"} · ~$
            {totalCost.toFixed(4)}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          {messages.length === 0 && !busy && (
            <ConvEmptyState onSuggest={(s) => setInput(s)} />
          )}

          {messages.map((m, i) => (
            <ConvMessageBubble key={i} message={m} />
          ))}

          {busy && status && (
            <div className="flex items-center gap-2.5 py-1 text-xs text-muted-foreground">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              {status}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-border px-5 py-4">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="¿Qué leads de Meta no han respondido en más de 24h?"
            rows={2}
            className="min-h-[52px] w-full resize-none text-sm"
            disabled={busy}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={busy || messages.length === 0}
              className="h-7 gap-1.5 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCcw className="h-3 w-3" />
              Reiniciar
            </Button>
            <div className="flex items-center gap-1.5">
              {busy && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stop}
                  className="h-7 gap-1.5 px-3 text-[10px]"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Detener
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={busy || !input.trim()}
                className="h-7 gap-1.5 px-3 text-[10px]"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {!busy && "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ConvEmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sugerencias
        </p>
        <div className="flex flex-col gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="group flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/15 px-3.5 py-2.5 text-left text-sm text-foreground/70 transition-all hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
            >
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/40 group-hover:text-primary/80" />
              <span className="leading-snug">{s}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/40">
        Tareas y notas se obtienen en vivo de GoHighLevel. Conversaciones
        reales, no muestras.
      </p>
    </div>
  );
}

function ConvMessageBubble({ message }: { message: UIMessage }) {
  const textBlocks = message.blocks.filter(
    (b): b is TextBlock => b.type === "text"
  );
  const toolUseBlocks = message.blocks.filter(
    (b): b is ToolUseBlock => b.type === "tool_use"
  );
  const toolResultBlocks = message.blocks.filter(
    (b): b is ToolResultBlock => b.type === "tool_result"
  );

  if (
    message.role === "user" &&
    toolResultBlocks.length > 0 &&
    textBlocks.length === 0
  ) {
    const errors = toolResultBlocks.filter((b) => b.is_error).length;
    const ok = toolResultBlocks.length - errors;
    return (
      <div className="flex items-center gap-1 self-start rounded-full border border-border/40 bg-muted/25 px-2 py-0.5 text-[10px] text-muted-foreground">
        <span className="opacity-50">↳</span>
        <span>
          {ok} resultado{ok !== 1 ? "s" : ""}
          {errors > 0 ? `, ${errors} error${errors !== 1 ? "es" : ""}` : ""}
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isUser ? "items-end" : "items-start"
      )}
    >
      {textBlocks.map((b, i) => (
        <div
          key={`t-${i}`}
          className={cn(
            "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
            isUser
              ? "bg-primary/90 text-primary-foreground"
              : "bg-muted/40 text-foreground ring-1 ring-inset ring-border/25"
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
                "prose-table:my-2 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-th:bg-muted/50 prose-td:px-2 prose-td:py-1",
                "prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
                "prose-strong:text-foreground prose-a:text-primary"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
      {toolUseBlocks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(
            toolUseBlocks.reduce<Record<string, number>>((acc, b) => {
              acc[b.name] = (acc[b.name] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([name, count]) => (
            <div
              key={name}
              className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <Wrench className="h-2.5 w-2.5 shrink-0" />
              <span className="font-medium text-foreground/70">{name}</span>
              {count > 1 && (
                <span className="rounded-full bg-border/70 px-1 font-mono leading-tight">
                  ×{count}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
