"use client"

// The grid cell of one widget, with the entrance it plays when it was JUST
// added (the copilot, an undo, another session's change). What counts as just
// added is useRecentlyAddedWidgets; the look lives in app/globals.css
// (.widget-enter/-scan/-edge).
import { useCallback, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { DashboardDoc } from "@/lib/widgets/spec"

/** Gap between the entrances of widgets added together, so a batch arrives one by one. */
export const ENTRANCE_STAGGER_MS = 90

/**
 * How long after it first appears in the panel a widget still enters animated
 * when it mounts. Covers the save's round trip: the copilot switches to the tab
 * it built only after the save returns.
 */
const FRESH_WINDOW_MS = 10_000

/**
 * Which widgets were just added, tracked over the WHOLE panel, not per tab.
 * The copilot usually builds into a new tab and switches to it afterwards; a
 * per-tab "what is new since the last render" saw that switch as an ordinary
 * tab change and never animated anything (shipped that way in 9746aba).
 * The first doc (page load) marks nothing. `forget` is called once a widget
 * has played, so switching tabs back and forth does not replay it.
 */
export function useRecentlyAddedWidgets(doc: DashboardDoc | null): {
  isFresh: (id: string) => boolean
  forget: (id: string) => void
} {
  const lastDoc = useRef<DashboardDoc | null>(null)
  const known = useRef<Set<string> | null>(null)
  const addedAt = useRef(new Map<string, number>())
  // During render, not in an effect: when widgets land on the tab on screen
  // they mount in this very render, and an effect would mark them too late.
  // Keyed on the doc's identity, so a repeated render of the same doc is a no-op.
  if (doc && doc !== lastDoc.current) {
    const ids = new Set(doc.tabs.flatMap((t) => t.widgets.map((w) => w.id)))
    if (known.current) {
      const now = Date.now()
      for (const id of ids) if (!known.current.has(id)) addedAt.current.set(id, now)
    }
    known.current = ids
    lastDoc.current = doc
  }
  const isFresh = useCallback((id: string) => {
    const t = addedAt.current.get(id)
    return t !== undefined && Date.now() - t <= FRESH_WINDOW_MS
  }, [])
  const forget = useCallback((id: string) => {
    addedAt.current.delete(id)
  }, [])
  return { isFresh, forget }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

export function WidgetEntrance({
  fresh,
  order,
  className,
  style,
  onClickCapture,
  onPlayed,
  children,
}: {
  fresh: boolean
  /** Position among the widgets that arrived in the same change. */
  order: number
  className?: string
  style?: CSSProperties
  onClickCapture?: () => void
  /** Called once the entrance has finished. */
  onPlayed?: () => void
  children: ReactNode
}) {
  // Both latched at mount: on its next render the grid no longer calls this
  // widget fresh (order falls back to 0), and changing either mid-animation
  // would cut it short or collapse the stagger.
  const [playing, setPlaying] = useState(() => fresh && !prefersReducedMotion())
  const [delayMs] = useState(() => order * ENTRANCE_STAGGER_MS)
  const done = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return
    setPlaying(false)
    onPlayed?.()
  }
  return (
    <div
      className={cn("relative", playing && "widget-enter", className)}
      style={{ ...style, "--enter-delay": `${delayMs}ms` } as CSSProperties}
      onClickCapture={onClickCapture}
    >
      {children}
      {playing && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <div className="widget-scan" />
          </div>
          {/* The longest of the three: when it ends, the entrance is over. */}
          <div aria-hidden className="widget-edge" onAnimationEnd={done} />
        </>
      )}
    </div>
  )
}
