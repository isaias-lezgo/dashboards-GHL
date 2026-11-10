"use client"

// Two-step picker shared by the panel's "+ Filtro" and the widget filter editor:
// 1) a field, grouped by object, with Spanish labels and the account's custom
// fields; 2) its values, with counts over the whole dataset. For a field of
// ANOTHER object it also asks "que tenga alguna / que no tenga ninguna" and
// reads the result back as a sentence before applying.
import { useMemo, useState } from "react"
import { ArrowLeft, Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ENTITY_FIELDS, knownCustomFields, listFieldValues, resolveCtx, ENTITY_SOURCE, type EngineContext } from "@/lib/widgets/semantic"
import { ENTITY_NOUNS, valueLabel } from "@/lib/widgets/labels"
import type { EntityId } from "@/lib/widgets/spec"

export interface PickedFilter {
  entity: EntityId
  field: string
  label: string
  values: string[]
  quantifier: "any" | "none"
  /** A combined field (glossary concept of kind field): the fields read after `field`. */
  fallbacks?: string[]
}

const ENTITY_TITLES: Record<EntityId, string> = {
  contact: "Contacto",
  opportunity: "Oportunidad",
  appointment: "Cita",
  task: "Tarea",
  pauta: "Pauta",
}

export function FilterFieldPicker({
  ctx,
  entityScope,
  allowQuantifier,
  subjectLabel,
  onPick,
  concepts = [],
}: {
  ctx: EngineContext
  /** Glossary concepts of kind "field", offered first: one chip over several fields. */
  concepts?: { label: string; entity: EntityId; fields: string[] }[]
  entityScope: EntityId[]
  allowQuantifier: boolean
  /** What is being filtered, for the confirmation sentence ("Contactos", "Registros"…). */
  subjectLabel: string
  onPick: (picked: PickedFilter) => void
}) {
  const [query, setQuery] = useState("")
  const [field, setField] = useState<{ entity: EntityId; field: string; label: string; fallbacks?: string[] } | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [quantifier, setQuantifier] = useState<"any" | "none">("any")
  const r = useMemo(() => resolveCtx(ctx), [ctx])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entityScope.map((entity) => {
      const source = ENTITY_SOURCE[entity]
      const cfs = source === "contacts" || source === "opportunities" ? [...knownCustomFields(source, ctx)].sort() : []
      const fields = [...ENTITY_FIELDS[entity], ...cfs.map((n) => ({ field: `cf:${n}`, label: n }))].filter(
        (f) => !q || f.label.toLowerCase().includes(q)
      )
      return { entity, fields }
    })
  }, [entityScope, ctx, query])

  const values = useMemo(() => (field ? listFieldValues(field.entity, field.field, r, field.fallbacks ?? []) : []), [field, r])
  const shownValues = values.filter((v) => !query.trim() || v.value.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200)

  if (!field) {
    return (
      <div className="w-72 space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar campo…" className="h-8 pl-7 text-xs" />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {concepts.some((c) => entityScope.includes(c.entity)) && (
            <div className="mb-2">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Conceptos</p>
              {concepts
                .filter((c) => entityScope.includes(c.entity) && (!query.trim() || c.label.toLowerCase().includes(query.trim().toLowerCase())))
                .map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    title={c.fields.join(" → ")}
                    onClick={() => {
                      setField({ entity: c.entity, field: c.fields[0], label: c.label, fallbacks: c.fields.slice(1) })
                      setQuery("")
                    }}
                    className="flex w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    {c.label}
                  </button>
                ))}
            </div>
          )}
          {groups.map((g) =>
            g.fields.length === 0 ? null : (
              <div key={g.entity} className="mb-2">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ENTITY_TITLES[g.entity]}</p>
                {g.fields.map((f) => (
                  <button
                    key={f.field}
                    type="button"
                    onClick={() => {
                      setField({ entity: g.entity, field: f.field, label: f.label })
                      setQuery("")
                    }}
                    className="flex w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    )
  }

  const noun = ENTITY_NOUNS[field.entity]
  const masc = field.entity === "contact"
  const shown = chosen.map((v) => valueLabel(field.entity, field.field, v)).join(" o ")
  const sentence = allowQuantifier
    ? `${subjectLabel} que ${quantifier === "any" ? `tengan ${masc ? "algún" : "alguna"}` : `no tengan ${masc ? "ningún" : "ninguna"}`} ${noun} con ${field.label} = ${shown || "…"}`
    : `${field.label} = ${shown || "…"}`

  return (
    <div className="w-80 space-y-2">
      <button type="button" onClick={() => setField(null)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> {ENTITY_TITLES[field.entity]} · {field.label}
      </button>
      {allowQuantifier && (
        <div className="flex gap-1">
          {(["any", "none"] as const).map((qn) => (
            <button
              key={qn}
              type="button"
              onClick={() => setQuantifier(qn)}
              className={cn("rounded-md border px-2 py-1 text-[11px]", quantifier === qn ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}
            >
              {qn === "any" ? `Que ${masc ? "tenga algún" : "tenga alguna"} ${noun}` : `Que no tenga ${masc ? "ningún" : "ninguna"} ${noun}`}
            </button>
          ))}
        </div>
      )}
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar valor…" className="h-8 text-xs" />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
        {shownValues.map((v) => {
          const active = chosen.includes(v.value)
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => setChosen((prev) => (active ? prev.filter((x) => x !== v.value) : [...prev, v.value]))}
              className={cn("flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-muted", active && "bg-primary/10")}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Check className={cn("h-3 w-3 shrink-0", active ? "opacity-100 text-primary" : "opacity-0")} />
                <span className="truncate">{valueLabel(field.entity, field.field, v.value).replace(/^«|»$/g, "")}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{v.count.toLocaleString("es-MX")}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{sentence}</p>
      <Button
        size="sm"
        className="h-7 w-full text-xs"
        disabled={chosen.length === 0}
        onClick={() => onPick({ entity: field.entity, field: field.field, label: field.label, values: chosen, quantifier, fallbacks: field.fallbacks })}
      >
        Aplicar
      </Button>
    </div>
  )
}
