"use client"

// The grid cell of one widget, with the entrance it plays when it was JUST
// added (the copilot, an undo, another session's change). The grid decides
// what is fresh; the look lives in app/globals.css (.widget-enter/-scan/-edge).
import { useState, type AnimationEvent, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Gap between the entrances of widgets added together, so a batch arrives one by one. */
export const ENTRANCE_STAGGER_MS = 90

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
  children,
}: {
  fresh: boolean
  /** Position among the widgets that arrived in the same change. */
  order: number
  className?: string
  style?: CSSProperties
  onClickCapture?: () => void
  children: ReactNode
}) {
  // Both latched at mount: on its next render the grid no longer calls this
  // widget fresh (order falls back to 0), and changing either mid-animation
  // would cut it short or collapse the stagger.
  const [playing, setPlaying] = useState(() => fresh && !prefersReducedMotion())
  const [delayMs] = useState(() => order * ENTRANCE_STAGGER_MS)
  const done = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) setPlaying(false)
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
