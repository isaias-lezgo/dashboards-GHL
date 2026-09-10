"use client"

import * as React from "react"
import { ChevronDown, Search, Workflow } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { pipelineFilterLabel, type PipelineFilter } from "@/lib/pipeline-filter"
import type { Pipeline } from "@/lib/types"
import { FilterGroupLabel } from "./filter-bar"

// Above this many pipelines the popover grows a search box. Sub-accounts run
// from 4 to 23 pipelines, and scanning 23 names for the one you want is the
// point at which a list stops being a list.
const SEARCH_THRESHOLD = 8

interface PipelineFilterControlProps {
  pipelines: Pipeline[]
  value: PipelineFilter
  onChange: (value: PipelineFilter) => void
  /**
   * Opportunities per pipeline id, over the WHOLE dataset rather than the active
   * date window. It answers "does this pipeline have anything in it at all",
   * which is a fact about the account, not about the window — and several
   * sub-accounts carry pipelines that have never held a single opportunity
   * (3 of stanza-residencial's 4). Showing the count is what keeps someone from
   * picking one and concluding the panel is broken.
   */
  counts?: Map<string, number>
}

export function PipelineFilterControl({
  pipelines,
  value,
  onChange,
  counts,
}: PipelineFilterControlProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const isActive = value.length > 0
  const selected = React.useMemo(() => new Set(value), [value])

  // Most-used pipelines first: with 23 of them, GHL's own order buries the
  // handful that actually hold the account's opportunities. The stage axis still
  // follows GHL's order — this ordering is the picker's alone.
  const ordered = React.useMemo(() => {
    return [...pipelines].sort((a, b) => {
      const diff = (counts?.get(b.id) ?? 0) - (counts?.get(a.id) ?? 0)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, "es")
    })
  }, [pipelines, counts])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((p) => p.name.toLowerCase().includes(q))
  }, [ordered, query])

  const toggle = React.useCallback(
    (id: string) => {
      onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
    },
    [onChange, value]
  )

  if (pipelines.length === 0) return null

  return (
    <>
      <FilterGroupLabel icon={Workflow}>Pipeline</FilterGroupLabel>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery("")
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={isActive ? "default" : "outline"}
            className="h-7 max-w-[15rem] gap-1.5 rounded-md px-2.5 text-[11px] font-medium"
            aria-pressed={isActive}
          >
            <span className="truncate">{pipelineFilterLabel(pipelines, value)}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[17rem] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isActive ? `${value.length} de ${pipelines.length}` : "Todos"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 rounded px-2 text-[11px]"
              disabled={!isActive}
              onClick={() => onChange([])}
            >
              Limpiar
            </Button>
          </div>

          {pipelines.length > SEARCH_THRESHOLD && (
            <div className="relative border-b border-border p-2">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pipeline…"
                aria-label="Buscar pipeline"
                className="h-7 pl-7 text-[12px]"
              />
            </div>
          )}

          {/* A plain overflow container, not ScrollArea: Radix's wrapper breaks
              `truncate` on the long pipeline names this list is full of. */}
          <div className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                Ningún pipeline coincide con «{query.trim()}»
              </p>
            ) : (
              visible.map((p) => {
                const count = counts?.get(p.id) ?? 0
                const checked = selected.has(p.id)

                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors",
                      "hover:bg-muted/60"
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className={cn("min-w-0 flex-1 truncate", checked && "font-medium")}>
                      {p.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums text-[11px]",
                        count === 0 ? "text-muted-foreground/50" : "text-muted-foreground"
                      )}
                    >
                      {count.toLocaleString("es-MX")}
                    </span>
                  </label>
                )
              })
            )}
          </div>

          <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-muted-foreground">
            Sin selección, el panel muestra todos los pipelines. El número es cuántas
            oportunidades tiene cada uno en todo el historial.
          </p>
        </PopoverContent>
      </Popover>
    </>
  )
}
