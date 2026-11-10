"use client"

// The AI panel's global filters in the browser (spec §6.6). Date and pipeline
// stay owned by app/page.tsx — the classic Marketing/Ventas tabs share them —
// and this hook owns the added controls, the session choices, and the commands
// that change the saved defaults.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DateFilter } from "@/lib/date-range"
import type { FilterControl } from "@/lib/widgets/spec"
import { setPanelFilters, randomId } from "@/lib/widgets/doc-ops"
import { initialFilterState, stateAsDefaults, type PanelFilterState } from "@/lib/widgets/filter-state"
import type { CommitResult, DashboardDocApi } from "./use-dashboard-doc"

export interface PanelFiltersApi {
  state: PanelFilterState
  setValues(controlId: string, values: string[]): void
  setOn(controlId: string, on: boolean): void
  addTemporary(control: Omit<FilterControl, "id">): void
  removeTemporary(index: number): void
  pinTemporary(index: number): Promise<CommitResult>
  /** Saves a new control; `sessionValues` are applied for this session once it appears (its default stays "todos"). */
  addControl(control: Omit<FilterControl, "id">, sessionValues?: string[]): Promise<CommitResult>
  removeControl(controlId: string): Promise<CommitResult>
  reset(): void
  saveAsDefault(): Promise<CommitResult>
  replaceState(next: PanelFilterState): void
}

export function usePanelFilters({
  docApi,
  now,
  date,
  setDate,
  pipelines,
  setPipelines,
}: {
  docApi: DashboardDocApi
  now: Date
  date: DateFilter
  setDate: (d: DateFilter) => void
  pipelines: string[]
  setPipelines: (p: string[]) => void
}): PanelFiltersApi {
  const doc = docApi.doc
  const filters = doc?.filters ?? null
  const [values, setValuesMap] = useState<Record<string, string[]>>({})
  const [on, setOnMap] = useState<Record<string, boolean>>({})
  const [temporary, setTemporary] = useState<Omit<FilterControl, "id">[]>([])

  // Defaults apply ONCE, when the doc first arrives; after that the bar belongs
  // to the user for the session.
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || docApi.enabled !== true || !filters) return
    initialized.current = true
    const init = initialFilterState(filters, now)
    setValuesMap(init.values)
    setOnMap(init.on)
    if (filters.defaultDate !== null) setDate(init.date)
    if (filters.defaultPipelines.length) setPipelines(init.pipelines)
  }, [docApi.enabled, filters, now, setDate, setPipelines])

  // Controls added or removed (here, by the AI, or by an undo) keep the other
  // controls' current choices; a new control starts at its default.
  const controls = filters?.controls
  const pending = useRef(new Map<string, string[]>())
  useEffect(() => {
    if (!controls) return
    // Snapshot outside the updater: React may run an updater twice (StrictMode),
    // so it must stay pure — consuming `pending` inside it lost the values.
    const waiting = new Map(pending.current)
    for (const c of controls) if (c.kind === "field") pending.current.delete(`${c.entity}.${c.field}`)
    setValuesMap((prev) => {
      const next: Record<string, string[]> = {}
      for (const c of controls) {
        if (c.kind !== "field") continue
        next[c.id] = prev[c.id] ?? waiting.get(`${c.entity}.${c.field}`) ?? [...c.defaultValues]
      }
      return next
    })
    setOnMap((prev) => {
      const next: Record<string, boolean> = {}
      for (const c of controls) if (c.kind === "condition") next[c.id] = prev[c.id] ?? c.defaultOn
      return next
    })
  }, [controls])

  const state = useMemo<PanelFilterState>(() => ({ date, pipelines, values, on, temporary }), [date, pipelines, values, on, temporary])

  const commitFilters = useCallback(
    (input: ReturnType<typeof stateAsDefaults>, change: string) =>
      docApi.commit((d) => setPanelFilters(d, input, randomId), change, "user"),
    [docApi]
  )

  const currentInput = useCallback(() => {
    if (!filters) return null
    return { defaultDate: filters.defaultDate, defaultPipelines: [...filters.defaultPipelines], controls: filters.controls.map(({ id: _id, ...rest }) => rest) }
  }, [filters])

  const disabled = (): CommitResult => ({ ok: false, reason: "disabled", message: "El panel no está activado para esta cuenta." })

  return {
    state,
    setValues: (id, v) => setValuesMap((prev) => ({ ...prev, [id]: v })),
    setOn: (id, value) => setOnMap((prev) => ({ ...prev, [id]: value })),
    addTemporary: (control) =>
      setTemporary((prev) => [...prev.filter((t) => !(t.entity === control.entity && t.field === control.field && t.label === control.label)), control]),
    removeTemporary: (index) => setTemporary((prev) => prev.filter((_, i) => i !== index)),
    pinTemporary: async (index) => {
      const input = currentInput()
      const t = temporary[index]
      if (!input || !t) return disabled()
      const res = await commitFilters({ ...input, controls: [...input.controls, t] }, `Fijó el filtro «${t.label}»`)
      if (res.ok) setTemporary((prev) => prev.filter((_, i) => i !== index))
      return res
    },
    addControl: async (control, sessionValues) => {
      const input = currentInput()
      if (!input) return disabled()
      if (sessionValues?.length && control.kind === "field") pending.current.set(`${control.entity}.${control.field}`, sessionValues)
      return commitFilters({ ...input, controls: [...input.controls, control] }, `Agregó el filtro «${control.label}»`)
    },
    removeControl: async (controlId) => {
      const input = currentInput()
      if (!input || !filters) return disabled()
      const c = filters.controls.find((x) => x.id === controlId)
      return commitFilters(
        { ...input, controls: filters.controls.filter((x) => x.id !== controlId).map(({ id: _id, ...rest }) => rest) },
        `Quitó el filtro «${c?.label ?? ""}»`
      )
    },
    reset: () => {
      if (!filters) return
      const init = initialFilterState(filters, now)
      setValuesMap(init.values)
      setOnMap(init.on)
      setTemporary([])
      setDate(init.date)
      setPipelines(init.pipelines)
    },
    saveAsDefault: async () => {
      if (!filters) return disabled()
      const res = await commitFilters(stateAsDefaults(state, filters), "Guardó los filtros como predeterminados")
      if (res.ok) setTemporary([])
      return res
    },
    replaceState: (next) => {
      setValuesMap(next.values)
      setOnMap(next.on)
      setTemporary(next.temporary)
      setDate(next.date)
      setPipelines(next.pipelines)
    },
  }
}
