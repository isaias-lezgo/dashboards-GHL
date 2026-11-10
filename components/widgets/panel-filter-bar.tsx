"use client"

// The added part of the panel's filter bar (spec §4.2): one chip per saved
// control, dashed chips for session-only filters, "+ Filtro", and Restablecer /
// Guardar como predeterminado when the choices differ from the defaults. Date
// and pipeline are the existing controls, rendered before this by the page.
import { useMemo, useState } from "react"
import { Pin, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { describeClause } from "@/lib/widgets/describe"
import { isDefaultState, staleValues } from "@/lib/widgets/filter-state"
import { ENTITIES, glossaryKind, type FilterControl, type GlossaryEntry, type PanelFilters } from "@/lib/widgets/spec"
import { listFieldValues, resolveCtx, type EngineContext } from "@/lib/widgets/semantic"
import { valueLabel } from "@/lib/widgets/labels"
import type { CommitResult } from "@/hooks/use-dashboard-doc"
import type { PanelFiltersApi } from "@/hooks/use-panel-filters"
import { FilterFieldPicker } from "./filter-field-picker"


function ValuesEditor({
  ctx,
  control,
  chosen,
  stale,
  onChange,
}: {
  ctx: EngineContext
  control: Omit<FilterControl, "id">
  chosen: string[]
  stale: string[]
  onChange: (values: string[]) => void
}) {
  const r = useMemo(() => resolveCtx(ctx), [ctx])
  const values = useMemo(() => (control.field ? listFieldValues(control.entity, control.field, r, control.fallbacks ?? []) : []), [control, r])
  const all = [...stale.map((value) => ({ value, count: 0 })), ...values]
  return (
    <div className="w-64 space-y-1">
      <button type="button" onClick={() => onChange([])} className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
        Todos
      </button>
      <div className="max-h-64 overflow-y-auto">
        {all.slice(0, 200).map((v) => {
          const active = chosen.includes(v.value)
          const isStale = stale.includes(v.value)
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => onChange(active ? chosen.filter((x) => x !== v.value) : [...chosen, v.value])}
              className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted", active && "bg-primary/10")}
            >
              <span className={cn("truncate", isStale && "line-through text-muted-foreground")}>
                {valueLabel(control.entity, control.field ?? "", v.value).replace(/^«|»$/g, "")}
                {isStale && " (sin datos)"}
              </span>
              <span className="tabular-nums text-muted-foreground">{v.count.toLocaleString("es-MX")}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function chipText(c: Omit<FilterControl, "id">, chosen: string[]): string {
  if (chosen.length === 0) return `${c.label}: todos`
  const shown = chosen.map((v) => valueLabel(c.entity, c.field ?? "", v).replace(/^«|»$/g, ""))
  return `${c.label}: ${shown.length > 2 ? `${shown.slice(0, 2).join(", ")} +${shown.length - 2}` : shown.join(", ")}`
}

export function PanelFilterBar({
  ctx,
  filters,
  glossary = [],
  api,
  now,
  onUndo,
}: {
  ctx: EngineContext
  filters: PanelFilters
  /** The client's concepts: those of kind "field" can become a combined-field control. */
  glossary?: GlossaryEntry[]
  api: PanelFiltersApi
  now: Date
  /** Undo of the last saved change (the page's docApi.undo with its toasts). */
  onUndo: () => void
}) {
  // Every change that is SAVED (controls, defaults) can be undone; session-only
  // choices need no undo — "Restablecer" covers them.
  const report = (res: CommitResult, done?: string) => {
    if (!res.ok) toast.error(res.message)
    else if (done) toast(done, { duration: 10_000, action: { label: "Deshacer", onClick: onUndo } })
  }
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const state = api.state
  // With no data loaded yet every value would look stale; say nothing until it is.
  const loaded = ctx.dataset.contacts.length > 0 || ctx.dataset.opportunities.length > 0
  const stale = useMemo(() => (loaded ? staleValues(state, filters, resolveCtx(ctx)) : {}), [loaded, state, filters, ctx])
  const dirty = !isDefaultState(state, filters, now)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.controls.map((c) =>
        c.kind === "field" ? (
          <Popover key={c.id} open={editing === c.id} onOpenChange={(o) => setEditing(o ? c.id : null)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs",
                  (state.values[c.id] ?? []).length ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                  stale[c.id] && "border-dashed"
                )}
              >
                {chipText(c, state.values[c.id] ?? [])}
                {stale[c.id] && <span className="text-[10px] text-muted-foreground line-through">(sin datos)</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <ValuesEditor ctx={ctx} control={c} chosen={state.values[c.id] ?? []} stale={stale[c.id] ?? []} onChange={(v) => api.setValues(c.id, v)} />
              <button
                type="button"
                className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-muted"
                onClick={async () => {
                  setEditing(null)
                  report(await api.removeControl(c.id), `Se quitó el filtro «${c.label}»`)
                }}
              >
                Quitar filtro
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <TooltipProvider key={c.id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => api.setOn(c.id, !state.on[c.id])}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs",
                    state.on[c.id] ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground"
                  )}
                >
                  {c.label}
                  {state.on[c.id] ? " · activo" : ""}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                {c.clause ? describeClause(c.entity, c.clause) : c.label}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      )}
      {state.temporary.map((t, i) => (
        <span key={`${t.entity}.${t.field}.${t.label}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-primary/50 px-2.5 text-xs text-foreground">
          {t.kind === "field" ? chipText(t, t.defaultValues) : t.label} <span className="text-[10px] text-muted-foreground">(temporal)</span>
          <button type="button" aria-label="Fijar filtro" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={async () => report(await api.pinTemporary(i), `Se fijó el filtro «${t.label}»`)}>
            <Pin className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Quitar filtro temporal" className="text-muted-foreground hover:text-foreground" onClick={() => api.removeTemporary(i)}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Filtro
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <FilterFieldPicker
            ctx={ctx}
            entityScope={[...ENTITIES]}
            allowQuantifier={false}
            subjectLabel="Registros"
            concepts={glossary
              .filter((g) => glossaryKind(g) === "field" && (g.fields?.length ?? 0) >= 2)
              .map((g) => ({ label: g.term.charAt(0).toUpperCase() + g.term.slice(1), entity: g.entity, fields: g.fields! }))}
            onPick={async (p) => {
              setAdding(false)
              const existing = filters.controls.find((c) => c.kind === "field" && c.entity === p.entity && c.field === p.field)
              if (existing) {
                api.setValues(existing.id, p.values)
                return
              }
              // Saved as a control (default "todos"); the values just picked apply for this session.
              report(
                await api.addControl(
                  { kind: "field", entity: p.entity, label: p.label, field: p.field, defaultValues: [], clause: null, defaultOn: false, fallbacks: p.fallbacks?.length ? p.fallbacks : null },
                  p.values
                ),
                `Se agregó el filtro «${p.label}» a la barra`
              )
            }}
          />
        </PopoverContent>
      </Popover>
      {dirty && (
        <>
          <button type="button" onClick={api.reset} className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground">
            Restablecer
          </button>
          <button type="button" onClick={async () => report(await api.saveAsDefault(), "Filtros guardados como predeterminados")} className="h-8 rounded-lg px-2 text-xs font-medium text-primary hover:underline">
            Guardar como predeterminado
          </button>
        </>
      )}
    </div>
  )
}
