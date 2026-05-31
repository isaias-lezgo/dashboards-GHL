"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  Sparkles,
  RefreshCcw,
  Wrench,
  AlertCircle,
  Square,
  ArrowUpRight,
} from "lucide-react";
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
import type { ChatDataset } from "@/lib/ai-tools";
import { buildDatasetSummary } from "@/lib/ai-context";
import {
  useAgentLoop,
  type UIMessage,
  type TextBlock,
  type ToolUseBlock,
  type ToolResultBlock,
} from "@/hooks/use-agent-loop";

interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: ChatDataset;
  locationId?: string;
  initialMessage?: string;
}

export function AIChatPanel({
  open,
  onOpenChange,
  dataset,
  locationId,
  initialMessage,
}: AIChatPanelProps) {
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const processedInitialMessageRef = useRef<string | null>(null);

  const datasetSummary = useMemo(
    () => buildDatasetSummary(dataset, locationId),
    [dataset, locationId]
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
    runWithMessages,
  } = useAgentLoop({ datasetSummary, dataset });

  useEffect(() => {
    if (!open) {
      processedInitialMessageRef.current = null;
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !initialMessage) return;
    if (processedInitialMessageRef.current === initialMessage) return;
    processedInitialMessageRef.current = initialMessage;
    reset();
    const userMsg: UIMessage = {
      role: "user",
      blocks: [{ type: "text", text: initialMessage }],
    };
    void runWithMessages([userMsg]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMessage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    send(text);
  }, [input, busy, send]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl focus:outline-none"
      >
        <div className="h-px w-full shrink-0 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <SheetTitle className="text-base font-semibold">
              Analizar con IA
            </SheetTitle>
          </div>
          <SheetDescription className="mt-0.5 text-xs text-muted-foreground/80">
            Pregúntame sobre contactos, oportunidades, pautas o citas.
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

        <div className="border-t border-border px-5 py-3.5">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="¿Cuántos leads de Meta sin cita esta semana?"
            rows={2}
            className="min-h-[52px] w-full resize-none text-sm"
            disabled={busy}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <span className="tabular-nums text-[10px] text-muted-foreground/60">
              Sonnet 4.6 · {totalTools}{" "}
              {totalTools === 1 ? "herramienta" : "herramientas"} · ~$
              {totalCost.toFixed(4)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={busy || messages.length === 0}
                className="h-7 gap-1.5 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <RefreshCcw className="h-3 w-3" />
                Reiniciar
              </Button>
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
    <div className="flex flex-col gap-5 py-1">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sugerencias
        </p>
        <div className="flex flex-col gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="group flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/15 px-3.5 py-2.5 text-left text-sm text-foreground/70 transition-all duration-150 hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
            >
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/40 transition-colors duration-150 group-hover:text-primary/80" />
              <span className="leading-snug">{s}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/40">
        Respuestas basadas en los datos cargados en el panel. Conteos exactos,
        no estimaciones.
      </p>
    </div>
  );
}

export function MessageBubble({ message }: { message: UIMessage }) {
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
    return <ToolResultsSummary blocks={toolResultBlocks} />;
  }

  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}
    >
      {textBlocks.map((b, i) => (
        <div
          key={`t-${i}`}
          className={cn(
            "max-w-[92%] rounded-2xl px-4 py-3 text-sm",
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
      {toolUseBlocks.length > 0 && (
        <GroupedToolUseChips blocks={toolUseBlocks} />
      )}
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
    if (
      typeof parsed?.filename === "string" &&
      typeof parsed?.rowCount === "number"
    ) {
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
