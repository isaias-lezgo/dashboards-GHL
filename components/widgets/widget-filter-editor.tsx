"use client"

// "Filtros y fechas" of one widget: its own period and date field, its own
// filters, cross-object filters ("contactos con alguna oportunidad…") and
// whether the panel's filters apply. Saving goes through the same validation
// the AI's edits do.
import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { describeClause } from "@/lib/widgets/describe"
import { ENTITY_NOUNS, RANGE_LABELS, SOURCE_LABELS, fieldLabel } from "@/lib/widgets/labels"
import { SOURCE_DEFS, type EngineContext } from "@/lib/widgets/semantic"
import { ENTITIES, RANGE_PRESETS, entityOf, type QuerySpec, type Widget, type WidgetSpec } from "@/lib/widgets/spec"
import { FilterFieldPicker } from "./filter-field-picker"

const selectClass = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"

export function WidgetFilterEditor({
  widget,
  ctx,
  onClose,
  onSave,
}: {
  widget: Widget | null
  ctx: EngineContext
  onClose: () => void
  onSave: (spec: WidgetSpec) => void
}) {
  const [draft, setDraft] = useState<QuerySpec | null>(null)
  const [picker, setPicker] = useState<"own" | "related" | null>(null)
  useEffect(() => setDraft(widget?.query ? structuredClone(widget.query) : null), [widget])

  if (!widget || !draft) return null
  const source = draft.source
  const isAds = source === "ads_daily"
  const sourceEntity = entityOf(source)
  const update = (patch: Partial<QuerySpec>) => setDraft({ ...draft, ...patch })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Filtros y fechas · {widget.title}</DialogTitle>
          <DialogDescription>{SOURCE_LABELS[source]}. Estos filtros son solo de esta gráfica.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          <section className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-foreground">Periodo</span>
              <select
                className={selectClass}
                value={draft.time.range === "absolute" ? "inherit" : draft.time.range}
                onChange={(e) => update({ time: { ...draft.time, range: e.target.value as QuerySpec["time"]["range"], from: null, to: null } })}
              >
                <option value="inherit">Heredar del panel</option>
                {RANGE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {RANGE_LABELS[p].charAt(0).toUpperCase() + RANGE_LABELS[p].slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium text-foreground">Fecha usada</span>
              <select className={selectClass} value={draft.time.field} onChange={(e) => update({ time: { ...draft.time, field: e.target.value } })}>
                {SOURCE_DEFS[source].dateFields.map((f) => (
                  <option key={f} value={f}>
                    {fieldLabel(f).charAt(0).toUpperCase() + fieldLabel(f).slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {isAds ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
              El gasto de Meta no tiene pipeline, asesor ni etapa: esta gráfica solo se filtra por fecha.
            </p>
          ) : (
            <>
              <section className="space-y-1.5">
                <p className="font-medium text-foreground">Filtros propios</p>
                {draft.filters.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                    <span className="truncate">{describeClause(sourceEntity, c)}</span>
                    <button type="button" aria-label="Quitar filtro" onClick={() => update({ filters: draft.filters.filter((_, j) => j !== i) })}>
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                <Popover open={picker === "own"} onOpenChange={(o) => setPicker(o ? "own" : null)}>
                  <PopoverTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Plus className="h-3 w-3" /> Filtro
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <FilterFieldPicker
                      ctx={ctx}
                      entityScope={sourceEntity ? [sourceEntity] : []}
                      allowQuantifier={false}
                      subjectLabel={SOURCE_LABELS[source]}
                      onPick={(p) => {
                        setPicker(null)
                        update({ filters: [...draft.filters, { anyOf: [{ field: p.field, op: "in", values: p.values }] }] })
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </section>

              <section className="space-y-1.5">
                <p className="font-medium text-foreground">Filtros de otros objetos</p>
                {draft.relatedFilters.map((rf, i) => {
                  const masc = rf.entity === "contact"
                  const lead = rf.quantifier === "any" ? `Con ${masc ? "algún" : "alguna"}` : `Sin ${masc ? "ningún" : "ninguna"}`
                  const cond = rf.conditions.map((c) => describeClause(rf.entity, c)).join(" y ")
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                      <span className="truncate">
                        {lead} {ENTITY_NOUNS[rf.entity]}
                        {cond ? ` con ${cond}` : ""}
                      </span>
                      <button type="button" aria-label="Quitar filtro" onClick={() => update({ relatedFilters: draft.relatedFilters.filter((_, j) => j !== i) })}>
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  )
                })}
                <Popover open={picker === "related"} onOpenChange={(o) => setPicker(o ? "related" : null)}>
                  <PopoverTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Plus className="h-3 w-3" /> Filtro de otro objeto
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <FilterFieldPicker
                      ctx={ctx}
                      entityScope={ENTITIES.filter((e) => e !== sourceEntity)}
                      allowQuantifier
                      subjectLabel={SOURCE_LABELS[source]}
                      onPick={(p) => {
                        setPicker(null)
                        update({
                          relatedFilters: [
                            ...draft.relatedFilters,
                            { entity: p.entity, quantifier: p.quantifier, conditions: [{ anyOf: [{ field: p.field, op: "in", values: p.values }] }] },
                          ],
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </section>

              <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <span>
                  <span className="block font-medium text-foreground">Ignorar los filtros del panel</span>
                  <span className="text-muted-foreground">El pipeline y los filtros agregados de la barra no aplican a esta gráfica.</span>
                </span>
                <Switch checked={draft.globalFilters === "ignore"} onCheckedChange={(v) => update({ globalFilters: v ? "ignore" : "inherit" })} />
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave({ ...widget, query: draft })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
