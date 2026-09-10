"use client"

import * as React from "react"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"

interface FilterBarProps {
  children: React.ReactNode
  className?: string
  // Optional explanation of why the current filters are what they are — shown
  // when the dashboard picked them instead of the user. Wraps to its own line on
  // narrow screens rather than squeezing the controls.
  hint?: string
}

/**
 * The panel's sticky filter bar. It owns only the chrome — the controls
 * themselves (`DateRangeFilter`, `PipelineFilter`) are children.
 *
 * Split out of `date-range-filter.tsx` when the pipeline filter arrived: two
 * self-contained filter components would each bring their own `sticky top-0`
 * section, which stacks into two bars that fight for the same offset. One
 * container, many controls.
 */
export function FilterBar({ children, className, hint }: FilterBarProps) {
  return (
    <section
      aria-label="Filtros del panel"
      className={cn(
        "sticky top-0 z-40 border-b border-border/60",
        "bg-[hsl(214_30%_92%)]/80 backdrop-blur-md",
        "dark:bg-[hsl(222_15%_16%)]/75",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
        {children}

        {hint && (
          <p className="flex w-full items-start gap-1.5 text-[11px] leading-snug text-muted-foreground sm:w-auto sm:flex-1 sm:basis-0 sm:min-w-[16rem]">
            <Info className="mt-px h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
            <span>{hint}</span>
          </p>
        )}
      </div>
    </section>
  )
}

/** The "FECHA" / "PIPELINE" caption that precedes each group of controls. */
export function FilterGroupLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="mr-1 flex shrink-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
    </div>
  )
}

/** Vertical hairline between two groups of controls. */
export function FilterDivider() {
  return <span aria-hidden className="mx-1 hidden h-5 w-px bg-border/70 sm:block" />
}
