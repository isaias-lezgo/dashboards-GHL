"use client"

// Loads the conversation index on demand (spec 2026-11-02 §3.8): only when a
// card on screen, or the copilot, reads conversations. One load serves every
// card — the widest window anyone asked for — and lives for the session; it is
// never written to the sync cache.
//
// The window never widens on its own: the panel's date filter does not move it
// (owner's decision). Only a card that saved a wider `conversationDays` asks
// for more, and that card warns about the wait.
import { useCallback, useRef, useState } from "react"
import { contactMessageDates, type ConversationRow, type ConversationState } from "@/lib/conversation-index"

interface Load {
  days: number
  promise: Promise<ConversationState>
  abort: AbortController
}

interface DataFrame {
  rows: ConversationRow[]
  truncated?: boolean
  threadErrors?: number
}

export interface ConversationIndexApi {
  /** Everything, progress counters included: for the loading notices. */
  state: ConversationState
  /** What the engine reads: the same object for the whole of one load, so progress frames do not recompute every card. */
  engineState: ConversationState
  /** Resolves once the index covers at least `days` (or failed). Reuses a load already big enough. */
  ensure(days: number): Promise<ConversationState>
  /** Reloads after an error, with the same window. */
  retry(): void
  /** Forgets the index (the dashboard data was refreshed): the next ensure loads again. */
  reset(): void
}

/** Whether `ensure(days)` can answer with what is held or running, or must load. */
export function planEnsure(cur: ConversationState, runningDays: number | null, days: number): { kind: "reuse" } | { kind: "load"; days: number } {
  if (cur.status === "ready" && cur.days >= days) return { kind: "reuse" }
  if (cur.status === "loading" && runningDays !== null && runningDays >= days) return { kind: "reuse" }
  // A failed load is retried only on purpose (retry), unless more days are asked.
  if (cur.status === "error" && cur.days >= days) return { kind: "reuse" }
  return { kind: "load", days: Math.max(days, cur.status === "ready" ? cur.days : 0) }
}

/** The engine's view: one "loading" object per load (counters stripped), the state itself otherwise. */
export function stableForEngine(prev: ConversationState, next: ConversationState): ConversationState {
  if (next.status !== "loading") return next
  if (prev.status === "loading" && prev.days === next.days) return prev
  return { status: "loading", days: next.days, scanned: 0, threads: 0 }
}

export function useConversationIndex(): ConversationIndexApi {
  const [state, setState] = useState<ConversationState>({ status: "idle" })
  const [engineState, setEngineState] = useState<ConversationState>(state)
  const stateRef = useRef<ConversationState>(state)
  const engineRef = useRef<ConversationState>(state)
  const loadRef = useRef<Load | null>(null)

  const set = useCallback((next: ConversationState) => {
    stateRef.current = next
    setState(next)
    const view = stableForEngine(engineRef.current, next)
    if (view !== engineRef.current) {
      engineRef.current = view
      setEngineState(view)
    }
  }, [])

  const load = useCallback(
    (days: number): Promise<ConversationState> => {
      loadRef.current?.abort.abort()
      const abort = new AbortController()
      const current = () => loadRef.current?.abort === abort
      set({ status: "loading", days, scanned: 0, threads: 0 })
      const promise = (async (): Promise<ConversationState> => {
        try {
          const res = await fetch(`/api/conversation-index?days=${days}`, { signal: abort.signal })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          let data: DataFrame | null = null
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              if (!line.trim()) continue
              const msg = JSON.parse(line) as { type: string; message?: string; scanned?: number; threads?: number } & Partial<DataFrame>
              if (msg.type === "progress" && current()) set({ status: "loading", days, scanned: msg.scanned ?? 0, threads: msg.threads ?? 0 })
              else if (msg.type === "data") data = { rows: msg.rows ?? [], truncated: msg.truncated, threadErrors: msg.threadErrors }
              else if (msg.type === "error") throw new Error(msg.message || "La carga de conversaciones falló")
            }
          }
          if (!data) throw new Error("La carga de conversaciones terminó sin datos")
          const next: ConversationState = {
            status: "ready",
            days,
            rows: data.rows,
            byContact: contactMessageDates(data.rows),
            truncated: !!data.truncated,
            threadErrors: data.threadErrors ?? 0,
          }
          if (current()) set(next)
          return next
        } catch (err) {
          // Superseded by a wider load: answer with that one instead.
          if (abort.signal.aborted && loadRef.current && !current()) return loadRef.current.promise
          const next: ConversationState = { status: "error", days, message: err instanceof Error ? err.message : String(err) }
          if (current()) set(next)
          return next
        }
      })()
      loadRef.current = { days, promise, abort }
      return promise
    },
    [set]
  )

  const ensure = useCallback(
    (days: number): Promise<ConversationState> => {
      const cur = stateRef.current
      const running = cur.status === "loading" ? loadRef.current : null
      const plan = planEnsure(cur, running?.days ?? null, days)
      if (plan.kind === "load") return load(plan.days)
      return running ? running.promise : Promise.resolve(cur)
    },
    [load]
  )

  const reset = useCallback(() => {
    loadRef.current?.abort.abort()
    loadRef.current = null
    set({ status: "idle" })
  }, [set])

  const retry = useCallback(() => {
    const cur = stateRef.current
    void load(cur.status === "idle" ? 60 : cur.days)
  }, [load])

  return { state, engineState, ensure, retry, reset }
}
