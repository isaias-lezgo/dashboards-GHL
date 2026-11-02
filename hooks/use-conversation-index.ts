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
  state: ConversationState
  /** Resolves once the index covers at least `days` (or failed). Reuses a load already big enough. */
  ensure(days: number): Promise<ConversationState>
  /** Reloads after an error, with the same window. */
  retry(): void
}

export function useConversationIndex(): ConversationIndexApi {
  const [state, setState] = useState<ConversationState>({ status: "idle" })
  const stateRef = useRef<ConversationState>(state)
  const loadRef = useRef<Load | null>(null)

  const set = useCallback((next: ConversationState) => {
    stateRef.current = next
    setState(next)
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
      if (cur.status === "ready" && cur.days >= days) return Promise.resolve(cur)
      const running = loadRef.current
      if (cur.status === "loading" && running && running.days >= days) return running.promise
      // A failed load is retried only on purpose (retry), unless more days are asked.
      if (cur.status === "error" && cur.days >= days) return Promise.resolve(cur)
      return load(Math.max(days, cur.status === "ready" ? cur.days : 0))
    },
    [load]
  )

  const retry = useCallback(() => {
    const cur = stateRef.current
    void load(cur.status === "idle" ? 60 : cur.days)
  }, [load])

  return { state, ensure, retry }
}
