"use client"

// The panel's copilot (spec §4.2): the assistant's agent loop in panel mode,
// docked to the right on desktop and as a bottom sheet on phones. It stays
// MOUNTED while hidden — like the Asistente IA tab — so closing it never loses
// the conversation. Each user message carries the panel snapshot as a second,
// hidden text block: the model sees the panel as it is now, and the cached
// system prefix stays untouched.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ArrowUp, RefreshCcw, Sparkles, Square, Undo2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ConvMessageBubble } from "@/components/dashboard/conversations-chat"
import { ChatQuestion } from "@/components/dashboard/chat-question"
import { useAgentLoop, type UIMessage } from "@/hooks/use-agent-loop"
import type { DashboardDocApi } from "@/hooks/use-dashboard-doc"
import type { PanelFiltersApi } from "@/hooks/use-panel-filters"
import { buildDatasetSummary } from "@/lib/ai-context"
import { PANEL_SNAPSHOT_MARKER, buildPanelCatalogSummary, buildPanelSnapshot } from "@/lib/widgets/describe"
import { describeFilterState, type PanelFilterState } from "@/lib/widgets/filter-state"
import { executePanelTool, isPanelTool, type PanelToolDeps } from "@/lib/widgets/tools"
import { randomId } from "@/lib/widgets/doc-ops"
import { emptyDoc, type Widget } from "@/lib/widgets/spec"
import type { EngineContext } from "@/lib/widgets/semantic"

const isSnapshot = (text: string) => text.startsWith(PANEL_SNAPSHOT_MARKER)

/**
 * One request of the user and everything the AI did for it: from a user text
 * message to the next one (ask_user answers continue the same run).
 */
interface Run {
  lastAssistant: number
  versions: number[]
}

function splitRuns(messages: UIMessage[], versionOf: (input: object) => number | undefined): Run[] {
  const runs: Run[] = []
  let cur: Run | null = null
  messages.forEach((m, i) => {
    if (m.role === "user" && !m.blocks.some((b) => b.type === "tool_result")) {
      cur = { lastAssistant: -1, versions: [] }
      runs.push(cur)
      return
    }
    if (!cur || m.role !== "assistant") return
    cur.lastAssistant = i
    for (const b of m.blocks) {
      if (b.type !== "tool_use") continue
      const v = versionOf(b.input)
      if (v !== undefined) cur.versions.push(v)
    }
  })
  return runs
}

export function CopilotDock({
  open,
  onClose,
  engineCtx,
  docApi,
  activeTabId,
  setActiveTabId,
  selectedWidget,
  clearSelection,
  filters,
  locationId,
  syncedAt,
  initialPrompt,
  onPromptConsumed,
}: {
  open: boolean
  onClose: () => void
  engineCtx: EngineContext
  docApi: DashboardDocApi
  /** The open tab of the client's own panel; null on the empty panel. */
  activeTabId: string | null
  setActiveTabId: (id: string) => void
  selectedWidget: Widget | null
  clearSelection: () => void
  filters: PanelFiltersApi
  locationId: string
  syncedAt?: string
  /** Text to send as soon as the copilot is free (the empty panel, a suggestion). */
  initialPrompt: string | null
  onPromptConsumed: () => void
}) {
  // Tools run long after the render that started them: they read everything
  // through this ref so they always see the current panel.
  const latest = useRef({ engineCtx, docApi, activeTabId, setActiveTabId, selectedWidget, filters })
  latest.current = { engineCtx, docApi, activeTabId, setActiveTabId, selectedWidget, filters }

  // A filter change reaches `filters.state` only on the next render; two filter
  // tools in one turn must still build on each other.
  const pendingFilters = useRef<PanelFilterState | null>(null)
  useEffect(() => {
    pendingFilters.current = null
  }, [filters.state])

  const ds = engineCtx.dataset
  // Keyed on the dataset's ARRAYS, not on engineCtx: the context object changes
  // every minute and with every filter, and a new summary would break the
  // cached prefix of every turn.
  const dataset = useMemo(() => ds, [ds.contacts, ds.opportunities, ds.pautas, ds.appointments, ds.messages, ds.tasks, ds.calls]) // eslint-disable-line react-hooks/exhaustive-deps
  const datasetSummary = useMemo(
    () => `${buildDatasetSummary(dataset, locationId, syncedAt)}\n\n${buildPanelCatalogSummary({ ...engineCtx, dataset })}`,
    [dataset, engineCtx.pipelines, engineCtx.ads, locationId, syncedAt] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const deps = useMemo<PanelToolDeps>(
    () => ({
      getDoc: () => latest.current.docApi.doc ?? emptyDoc(),
      commit: (mutate, change, source) => latest.current.docApi.commit(mutate, change, source),
      engineCtx: () => latest.current.engineCtx,
      activeTabId: () => latest.current.activeTabId,
      selectedWidgetId: () => latest.current.selectedWidget?.id ?? null,
      setActiveTab: (id) => latest.current.setActiveTabId(id),
      getFilterState: () => pendingFilters.current ?? latest.current.filters.state,
      applyFilterState: (next) => {
        pendingFilters.current = next
        latest.current.filters.replaceState(next)
      },
      now: () => new Date().toISOString(),
      newId: randomId,
    }),
    []
  )

  // Which tool calls changed the saved panel, and to which version: keyed by
  // the tool_use input object, which the loop keeps by reference in `messages`.
  const mutations = useRef(new WeakMap<object, number>())
  const onToolExecuted = useCallback((name: string, input: Record<string, unknown>, result: unknown) => {
    if (!isPanelTool(name) || !result || typeof result !== "object") return
    const r = result as { ok?: unknown; version?: unknown }
    if (r.ok === true && typeof r.version === "number") mutations.current.set(input, r.version)
  }, [])

  const executeExtra = useCallback(
    (name: string, input: Record<string, unknown>) => (isPanelTool(name) ? executePanelTool(name, input, deps) : undefined),
    [deps]
  )

  const decorateUserText = useCallback(() => {
    const { docApi: api, activeTabId: tabId, selectedWidget: sel, filters: f, engineCtx: ctx } = latest.current
    if (!api.doc) return null
    return buildPanelSnapshot(api.doc, tabId, sel?.id ?? null, describeFilterState(f.state, api.doc.filters, ctx.pipelines))
  }, [])

  const { messages, busy, status, error, totalCost, totalTools, send, stop, reset, pendingQuestion, answer } = useAgentLoop({
    datasetSummary,
    dataset,
    mode: "panel",
    executeExtra,
    decorateUserText,
    onToolExecuted,
  })

  useEffect(() => {
    if (!initialPrompt || busy) return
    send(initialPrompt)
    onPromptConsumed()
  }, [initialPrompt, busy, send, onPromptConsumed])

  const [input, setInput] = useState("")
  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    send(text)
    setInput("")
  }

  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy, pendingQuestion])

  // "Deshacer" sits under the last answer of a request that changed the panel,
  // and only while nothing else has changed it since (undo is a stack).
  const runs = useMemo(() => splitRuns(messages, (i) => mutations.current.get(i)), [messages])
  const undoRun = runs.findLast((r) => r.versions.length > 0)
  const undoAt = undoRun && !busy && Math.max(...undoRun.versions) === docApi.version ? undoRun.lastAssistant : -1
  const [undoing, setUndoing] = useState(false)
  const undoLastRun = async () => {
    if (!undoRun) return
    setUndoing(true)
    try {
      for (let i = 0; i < undoRun.versions.length; i++) {
        const res = await docApi.undo()
        if (!res.ok) {
          toast.error(res.message)
          return
        }
      }
      toast("Se deshizo el último cambio de la IA")
    } finally {
      setUndoing(false)
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Copiloto del panel"
        className={cn(
          "fixed z-40 flex flex-col bg-card",
          "inset-x-0 bottom-0 h-[80vh] rounded-t-2xl border-t border-border",
          "lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[380px] lg:rounded-none lg:border-l lg:border-t-0",
          !open && "hidden"
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Copiloto</p>
            <p className="truncate text-[10px] text-muted-foreground/70 tabular-nums">
              {totalTools} {totalTools === 1 ? "herramienta" : "herramientas"} · ~${totalCost.toFixed(4)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Reiniciar conversación"
              title="Reiniciar conversación"
              disabled={busy || messages.length === 0}
              onClick={reset}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cerrar copiloto" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !busy && (
            <p className="py-6 text-center text-xs leading-relaxed text-muted-foreground">
              Pídele una gráfica, una pestaña nueva o un filtro. Para cambiar una gráfica, tócala con{" "}
              <Sparkles className="inline h-3 w-3 text-primary" aria-label="Editar con IA" /> y dile qué cambiar.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <ConvMessageBubble message={m} hideText={isSnapshot} />
              {i === undoAt && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={undoing}
                  onClick={() => void undoLastRun()}
                  className="h-7 gap-1.5 self-start px-2.5 text-[11px]"
                >
                  <Undo2 className="h-3 w-3" />
                  Deshacer
                </Button>
              )}
            </div>
          ))}
          {pendingQuestion && !busy && <ChatQuestion question={pendingQuestion} onAnswer={answer} />}
          {busy && status && (
            <div className="flex items-center gap-2.5 py-1 text-xs text-muted-foreground">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: `${i * 0.15}s` }} />
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

        <div className="border-t border-border px-4 py-3">
          {selectedWidget && (
            <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-foreground">
              <span className="truncate">Editando: {selectedWidget.title}</span>
              <button type="button" onClick={clearSelection} aria-label="Quitar selección" className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={selectedWidget ? "¿Qué le cambio a esta gráfica?" : "¿Qué quieres ver?"}
              rows={2}
              aria-label="Mensaje para el copiloto"
              className="min-h-[52px] resize-none pr-12 text-sm"
            />
            {busy ? (
              <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Detener" className="absolute right-2 bottom-2 h-8 w-8">
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Enviar" className="absolute right-2 bottom-2 h-8 w-8">
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </aside>
    </>
  )
}
