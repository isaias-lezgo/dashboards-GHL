"use client"

import { useMemo, type ReactNode } from "react"
import type { Opportunity, Contact, Appointment } from "@/lib/types"
import { isWonOpp } from "@/lib/opportunity-status"
import { platformLabel } from "@/lib/source-platform"
import {
  BRAND_AMBER,
  STRUCTURAL_NAVY,
  DashboardCard,
  ChartCardHeader,
  ChartCardContent,
  ChartEmpty,
  ChartHint,
} from "./dashboard-ui"

const MS_PER_DAY = 86_400_000
// Green marks the fastest close; navy the slowest — both self-evident, no legend.
const CYCLE_GREEN = "#10b981"

export interface DecisionCycleRow {
  opp: Opportunity
  cliente: string
  asesor: string
  llego: string          // ISO — opportunity creation
  visito: string | null  // ISO — contact's first appointment, or null
  aparto: string         // ISO — closedAt (fallback updatedAt)
  dias: number
  origen: string
}

export interface DecisionCycleStats {
  promedio: number
  fastest: DecisionCycleRow | null
  longest: DecisionCycleRow | null
}

/**
 * Pure builder shared by the panel and the PDF report. Walks the (already
 * date-filtered) opportunities, keeps the won ones, and measures the days from
 * opportunity creation (Llegó) to close (Apartó = closedAt, falling back to
 * updatedAt so stage-driven wins that carry no closedAt still appear). Contact
 * names and the "Visitó" date are resolved against the full lookup sets. A won
 * opportunity is excluded only when no Apartó date resolves or when it lands
 * before Llegó (inconsistent data). Rows come back ascending by días.
 */
export function buildDecisionCycle(
  opportunities: Opportunity[],
  contacts: Contact[],
  appointments: Appointment[],
): { rows: DecisionCycleRow[]; stats: DecisionCycleStats; excludedCount: number } {
  const contactName = new Map<string, string>()
  for (const c of contacts) contactName.set(c.id, c.name)

  // Earliest appointment start per contact, any status.
  const firstAppt = new Map<string, number>()
  for (const a of appointments) {
    if (!a.contactId || !a.startTime) continue
    const t = new Date(a.startTime).getTime()
    if (isNaN(t)) continue
    const prev = firstAppt.get(a.contactId)
    if (prev === undefined || t < prev) firstAppt.set(a.contactId, t)
  }

  const rows: DecisionCycleRow[] = []
  let excludedCount = 0
  for (const o of opportunities) {
    if (!isWonOpp(o)) continue
    const llegoMs = new Date(o.createdAt).getTime()
    const apartoIso = o.closedAt || o.updatedAt
    const apartoMs = apartoIso ? new Date(apartoIso).getTime() : NaN
    if (isNaN(llegoMs) || isNaN(apartoMs) || apartoMs < llegoMs) {
      excludedCount++
      continue
    }
    const dias = Math.max(0, Math.round((apartoMs - llegoMs) / MS_PER_DAY))
    const visitoMs = firstAppt.get(o.contactId)
    rows.push({
      opp: o,
      cliente: contactName.get(o.contactId) || o.contact?.name || o.name || "Sin nombre",
      asesor: o.assignedTo || "Sin asesor",
      llego: o.createdAt,
      visito: visitoMs !== undefined ? new Date(visitoMs).toISOString() : null,
      aparto: apartoIso as string,
      dias,
      origen: platformLabel(o),
    })
  }
  rows.sort((a, b) => a.dias - b.dias)

  const stats: DecisionCycleStats = { promedio: 0, fastest: null, longest: null }
  if (rows.length > 0) {
    const sum = rows.reduce((s, r) => s + r.dias, 0)
    stats.promedio = Math.round(sum / rows.length)
    stats.fastest = rows[0]                   // ascending → first is fastest
    stats.longest = rows[rows.length - 1]     // … last is longest
  }
  return { rows, stats, excludedCount }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
}

function diasLabel(n: number): string {
  return `${n.toLocaleString("es-MX")} ${n === 1 ? "día" : "días"}`
}

function SummaryCard({
  label,
  value,
  unit,
  sublabel,
  color,
  onClick,
}: {
  label: string
  value: string
  unit: string
  sublabel: ReactNode
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start rounded-lg border p-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ borderColor: color + "40", background: color + "0F" }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums tracking-tight" style={{ color }}>
          {value}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{unit}</span>
      </span>
      <span className="mt-0.5 max-w-full truncate text-[11px] text-muted-foreground">{sublabel}</span>
    </button>
  )
}

const TH = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"

export function DecisionCycleTable({
  opportunities,
  contacts,
  appointments,
  onOpenOpps,
}: {
  opportunities: Opportunity[]
  contacts: Contact[]
  appointments: Appointment[]
  onOpenOpps: (title: string, opps: Opportunity[], subtitle?: string) => void
}) {
  const { rows, stats } = useMemo(
    () => buildDecisionCycle(opportunities, contacts, appointments),
    [opportunities, contacts, appointments],
  )

  return (
    <DashboardCard>
      <ChartCardHeader title="Ciclo de decisión — días Lead→Apartado" total={rows.length} />
      <ChartCardContent>
        {rows.length === 0 ? (
          <ChartEmpty message="Sin oportunidades ganadas en el periodo" height={192} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard
                label="Promedio general"
                value={String(stats.promedio)}
                unit="días"
                sublabel="lead → apartado"
                color={BRAND_AMBER}
                onClick={() =>
                  onOpenOpps(
                    "Ciclo de decisión — oportunidades ganadas",
                    rows.map((r) => r.opp),
                    `Promedio ${diasLabel(stats.promedio)}`,
                  )
                }
              />
              <SummaryCard
                label="Más rápido"
                value={String(stats.fastest!.dias)}
                unit={stats.fastest!.dias === 1 ? "día" : "días"}
                sublabel={stats.fastest!.cliente}
                color={CYCLE_GREEN}
                onClick={() => onOpenOpps(stats.fastest!.cliente, [stats.fastest!.opp], "Cierre más rápido")}
              />
              <SummaryCard
                label="Más largo"
                value={String(stats.longest!.dias)}
                unit="días"
                sublabel={stats.longest!.cliente}
                color={STRUCTURAL_NAVY}
                onClick={() => onOpenOpps(stats.longest!.cliente, [stats.longest!.opp], "Cierre más largo")}
              />
            </div>

            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className={TH}>Cliente</th>
                    <th className={TH}>Asesor</th>
                    <th className={TH}>Llegó</th>
                    <th className={TH}>Visitó</th>
                    <th className={TH}>Apartó</th>
                    <th
                      className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: BRAND_AMBER + "1F", color: BRAND_AMBER }}
                    >
                      Días Lead→Apartado
                    </th>
                    <th className={TH}>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.opp.id}
                      onClick={() => onOpenOpps(r.cliente, [r.opp])}
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-3 py-2 font-medium text-foreground">{r.cliente}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.asesor}</td>
                      <td className="px-3 py-2 tabular-nums text-foreground">{fmtDate(r.llego)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtDate(r.visito)}</td>
                      <td className="px-3 py-2 tabular-nums text-foreground">{fmtDate(r.aparto)}</td>
                      <td
                        className="px-3 py-2 text-center font-semibold tabular-nums text-foreground"
                        style={{ background: BRAND_AMBER + "12" }}
                      >
                        {diasLabel(r.dias)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.origen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ChartHint>
              Solo oportunidades ganadas · Llegó = creación de la oportunidad · Apartó = cierre (ganado) ·
              Ordenado del cierre más rápido al más largo · Haz clic en una fila para ver la oportunidad
            </ChartHint>
          </>
        )}
      </ChartCardContent>
    </DashboardCard>
  )
}
