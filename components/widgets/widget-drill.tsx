"use client"

// Drill-down for AI-panel widgets: every bar, slice, row and point opens the
// records behind it in the same drawers the hand-built dashboards use.
import { useMemo } from "react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "@/components/dashboard/chart-drill-drawer"
import { AppointmentDrillDrawer, APPT_DRILL_CLOSED } from "@/components/dashboard/appointment-drill-drawer"
import type { Appointment, Contact, Opportunity, Pauta, Task } from "@/lib/types"
import type { SourceId } from "@/lib/widgets/spec"
import type { EngineContext } from "@/lib/widgets/semantic"

export interface WidgetDrillState {
  title: string
  source: SourceId
  records: Record<string, unknown>[]
}

export function WidgetDrill({
  drill,
  onClose,
  ctx,
}: {
  drill: WidgetDrillState | null
  onClose: () => void
  ctx: EngineContext
}) {
  const ds = ctx.dataset
  const contactById = useMemo(() => new Map(ds.contacts.map((c) => [c.id, c])), [ds.contacts])

  const state: DrillState = useMemo(() => {
    if (!drill || drill.source === "appointments" || drill.source === "ads_daily" || drill.source === "conversations") return DRILL_CLOSED
    const base = { open: true, title: drill.title, opportunities: [] as Opportunity[] }
    switch (drill.source) {
      case "opportunities":
        return { ...base, opportunities: drill.records as unknown as Opportunity[] }
      case "contacts":
        return { ...base, contactItems: drill.records as unknown as Contact[] }
      case "tasks": {
        const seen = new Set<string>()
        const contactItems: Contact[] = []
        for (const t of drill.records as unknown as Task[]) {
          const c = contactById.get(t.contactId)
          if (c && !seen.has(c.id)) {
            seen.add(c.id)
            contactItems.push(c)
          }
        }
        return { ...base, contactItems }
      }
      case "pautas":
        return {
          ...base,
          pautaItems: (drill.records as unknown as Pauta[]).map((pauta) => ({
            pauta,
            contact: pauta.contactId ? contactById.get(pauta.contactId) : undefined,
          })),
        }
    }
  }, [drill, contactById])

  const apptState =
    drill && drill.source === "appointments"
      ? { open: true, title: drill.title, appointments: drill.records as unknown as Appointment[] }
      : APPT_DRILL_CLOSED

  return (
    <>
      <ChartDrillDrawer
        drill={state}
        onDrillChange={(d) => {
          if (!d.open) onClose()
        }}
        contacts={ds.contacts}
        tasks={ds.tasks}
        calls={ds.calls}
        allOpportunities={ds.opportunities}
        allPautas={ds.pautas}
        appointments={ds.appointments}
        messages={ds.messages}
      />
      <AppointmentDrillDrawer
        drill={apptState}
        onDrillChange={(d) => {
          if (!d.open) onClose()
        }}
        contacts={ds.contacts}
      />
    </>
  )
}
