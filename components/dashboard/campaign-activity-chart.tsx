"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Megaphone } from "lucide-react"

import type { Pauta } from "@/lib/types"
import {
  groupCampaignsByFamily,
  SIN_NOMBRE_CAMPAIGN,
  type CampaignGroup,
  type CampaignRow,
  type CampaignTally,
} from "@/lib/pauta"

import {
  ChartCardContent,
  ChartCardHeader,
  ChartEmpty,
  ChartHint,
  DashboardCard,
  chartPaletteColor,
} from "./dashboard-ui"

// How many leading tokens form the family key. "flat" keeps the detection (for
// color and prefix dimming) but drops the grouping, leaving one volume-ordered
// list — the escape hatch when automatic grouping cuts in the wrong place.
type GroupDepth = 1 | 2 | "flat"

const DEPTH_OPTIONS: { v: GroupDepth; label: string }[] = [
  { v: 1, label: "1" },
  { v: 2, label: "2" },
  { v: "flat", label: "PLANO" },
]

// The leftover buckets ("Sin patrón", "Sin nombre") never get a palette color —
// a color would imply we identified something.
const NEUTRAL_COLOR = "#94a3b8"

// Rows shown before the card asks to be expanded. A nested scroll container was
// the first attempt and it trapped the wheel: to reach the charts below, you had
// to scroll through every campaign first. The card now always renders at its
// natural height — collapsed short, or expanded long — so the page keeps the
// only scrollbar.
const COLLAPSED_ITEMS = 18
// Don't offer a "show more" that reveals a handful of rows; just render them.
const COLLAPSE_SLACK = 4

type RenderItem =
  | { kind: "group"; group: CampaignGroup }
  | { kind: "row"; row: CampaignRow; groupKey: string; indent: boolean }

const fmt = (n: number) => n.toLocaleString("es-MX")

function DepthToggle({ value, onChange }: { value: GroupDepth; onChange: (v: GroupDepth) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded border border-border/50 text-[10px] font-medium">
      {DEPTH_OPTIONS.map((opt, i) => (
        <button
          key={String(opt.v)}
          type="button"
          onClick={() => onChange(opt.v)}
          className={[
            "px-2 py-0.5 uppercase tracking-wide transition-colors",
            i > 0 ? "border-l border-border/50" : "",
            value === opt.v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function CampaignBarRow({
  row,
  max,
  color,
  indent,
  onClick,
}: {
  row: CampaignRow
  max: number
  color: string
  indent: boolean
  onClick: () => void
}) {
  const pct = max > 0 ? (row.pautas / max) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3 rounded py-1.5 pr-2 text-left transition-colors hover:bg-accent/40",
        indent ? "pl-6" : "pl-2",
      ].join(" ")}
    >
      {/*
        One tone, no dimming. The shared prefix was hoisted into the group header
        (see sharedPrefixCut in lib/pauta), so what's left here is exactly what
        distinguishes this campaign from its siblings. An earlier version printed
        the full name with the prefix greyed out — legible only to someone who
        knew what the grey meant, which a client never does. `title` keeps the
        full name one hover away.
      */}
      <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={row.name}>
        {row.name.slice(row.prefixLen)}
      </span>
      <span className="h-2 w-[30%] shrink-0 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
        {fmt(row.pautas)}
      </span>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {fmt(row.leads)}
      </span>
    </button>
  )
}

function FamilyHeaderRow({
  group,
  color,
  onClick,
}: {
  group: CampaignGroup
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors first:mt-0 hover:bg-accent/40"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide" title={group.label}>
        {group.label}
      </span>
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {fmt(group.campaigns.length)} {group.campaigns.length === 1 ? "campaña" : "campañas"} ·{" "}
        {fmt(group.pautas)} pautas · {fmt(group.leads)} leads
      </span>
    </button>
  )
}

export function CampaignActivityChart({
  pautas,
  isUniqueLead,
  onDrill,
}: {
  /** Already filtered by the global date range — the component never re-filters. */
  pautas: Pauta[]
  isUniqueLead: (p: Pauta) => boolean
  onDrill: (title: string, items: Pauta[]) => void
}) {
  const [depth, setDepth] = useState<GroupDepth>("flat")
  const [expanded, setExpanded] = useState(false)

  // One pass: the tallies that drive the bars and the record lists the drill
  // needs, keyed by the same campaign name so the drawer count always matches
  // the bar it came from.
  const { tallies, recordsByCampaign } = useMemo(() => {
    const recordsByCampaign = new Map<string, Pauta[]>()
    const counts = new Map<string, { pautas: number; leads: number }>()
    for (const p of pautas) {
      const name = p.nombrePauta?.trim() || SIN_NOMBRE_CAMPAIGN
      const list = recordsByCampaign.get(name) ?? []
      list.push(p)
      recordsByCampaign.set(name, list)
      const c = counts.get(name) ?? { pautas: 0, leads: 0 }
      c.pautas++
      // The contactId guard is required: pautaReingresoMap only indexes pautas
      // that have a contact, so isUniqueLead() returns true by default for an
      // orphan record and would inflate the lead count.
      if (p.contactId && isUniqueLead(p)) c.leads++
      counts.set(name, c)
    }
    const tallies: CampaignTally[] = [...counts.entries()].map(([name, c]) => ({ name, ...c }))
    return { tallies, recordsByCampaign }
  }, [pautas, isUniqueLead])

  // "flat" still detects at depth 1 so rows keep their family color and dimmed
  // prefix; only the grouping is dropped.
  const groups = useMemo(
    () => groupCampaignsByFamily(tallies, depth === "flat" ? 1 : depth),
    [tallies, depth],
  )

  const colorByGroup = useMemo(() => {
    const m = new Map<string, string>()
    let i = 0
    for (const g of groups) m.set(g.key, g.kind === "family" ? chartPaletteColor(i++) : NEUTRAL_COLOR)
    return m
  }, [groups])

  // Normalized against the largest campaign in the whole set, not per family,
  // so bar lengths are comparable across families.
  const maxPautas = useMemo(
    () => groups.reduce((m, g) => Math.max(m, ...g.campaigns.map((c) => c.pautas)), 0),
    [groups],
  )

  const flatRows = useMemo(
    () =>
      groups
        .flatMap((g) => g.campaigns.map((c) => ({ row: c, groupKey: g.key })))
        .sort((a, b) => b.row.pautas - a.row.pautas || a.row.name.localeCompare(b.row.name, "es")),
    [groups],
  )

  // Flatten headers and rows into one render list so collapsing is a slice.
  const items = useMemo<RenderItem[]>(() => {
    if (depth === "flat") {
      // No headers in flat mode, so nothing hoisted the prefix — rows show the
      // whole name.
      return flatRows.map(({ row, groupKey }) => ({
        kind: "row" as const,
        row: { ...row, prefixLen: 0 },
        groupKey,
        indent: false,
      }))
    }
    return groups.flatMap((g): RenderItem[] => [
      { kind: "group", group: g },
      ...g.campaigns.map((row) => ({ kind: "row" as const, row, groupKey: g.key, indent: true })),
    ])
  }, [depth, groups, flatRows])

  const collapsible = items.length > COLLAPSED_ITEMS + COLLAPSE_SLACK
  const visibleItems = collapsible && !expanded ? items.slice(0, COLLAPSED_ITEMS) : items

  const totalPautas = useMemo(() => groups.reduce((s, g) => s + g.pautas, 0), [groups])
  const campaignCount = tallies.length
  const familyCount = groups.filter((g) => g.kind === "family").length

  const drillCampaign = (row: CampaignRow) =>
    onDrill(row.name, recordsByCampaign.get(row.name) ?? [])

  const drillFamily = (group: CampaignGroup) =>
    onDrill(
      group.key,
      group.campaigns.flatMap((c) => recordsByCampaign.get(c.name) ?? []),
    )

  return (
    <DashboardCard>
      <ChartCardHeader
        title="Campañas activas por pauta"
        total={totalPautas}
        icon={Megaphone}
        actions={<DepthToggle value={depth} onChange={setDepth} />}
      />
      <ChartCardContent>
        {campaignCount === 0 ? (
          <ChartEmpty message="Sin pautas en el periodo seleccionado." height={220} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border/50 px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="min-w-0 flex-1">
                {fmt(campaignCount)} {campaignCount === 1 ? "campaña" : "campañas"}
                {depth !== "flat" && familyCount > 0 && (
                  <> · {fmt(familyCount)} {familyCount === 1 ? "familia" : "familias"}</>
                )}
              </span>
              <span className="w-[30%] shrink-0" />
              <span className="w-12 shrink-0 text-right">Pautas</span>
              <span className="w-12 shrink-0 text-right">Leads</span>
            </div>

            <div className="mt-1">
              {visibleItems.map((item) =>
                item.kind === "group" ? (
                  <FamilyHeaderRow
                    key={`g:${item.group.key}`}
                    group={item.group}
                    color={colorByGroup.get(item.group.key) ?? NEUTRAL_COLOR}
                    onClick={() => drillFamily(item.group)}
                  />
                ) : (
                  <CampaignBarRow
                    key={`r:${item.row.name}`}
                    row={item.row}
                    max={maxPautas}
                    indent={item.indent}
                    color={colorByGroup.get(item.groupKey) ?? NEUTRAL_COLOR}
                    onClick={() => drillCampaign(item.row)}
                  />
                ),
              )}
            </div>

            {collapsible && (
              // Reads as a control, not as a footnote: solid fill, full-weight
              // text and a chevron. The muted-text-on-hairline-border version it
              // replaces disappeared into the row list.
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/60 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
              >
                {expanded ? "Mostrar menos" : `Mostrar las ${fmt(campaignCount)} campañas`}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            )}

            <ChartHint>
              Activa = con al menos una pauta en el periodo · la barra mide pautas (incluye
              reingresos), &ldquo;Leads&rdquo; cuenta el primer ingreso de cada contacto · haz clic
              en una fila para ver los registros
            </ChartHint>
          </>
        )}
      </ChartCardContent>
    </DashboardCard>
  )
}
