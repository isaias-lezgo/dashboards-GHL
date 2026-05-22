"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Legend,
  PieChart,
  Pie,
  Sector,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Pauta, Task, Call } from "@/lib/types"
import { Megaphone, Globe, BarChart3, Layers, TrendingDown, Tag, FileText } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]
  tasks?: Task[]
  calls?: Call[]
}

// Stage colors — consistent across all stacked charts
const STAGE_COLORS: Record<string, string> = {
  "Primera Cita": "#3b82f6",
  "Segunda Cita": "#8b5cf6",
  "Envío de propuesta": "#f59e0b",
  "Envío de liga de pago": "#06b6d4",
  "Proceso de Implementación": "#10b981",
  "Cliente Activo": "#22c55e",
  "Servicio Terminado": "#6b7280",
  "Prospecto Perdido": "#ef4444",
  Discovery: "#3b82f6",
  Proposal: "#8b5cf6",
  Negotiation: "#f59e0b",
  "Closed Won": "#22c55e",
  "Closed Lost": "#ef4444",
}

const BAR_PALETTE = [
  "#2563eb", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6",
  "#06b6d4", "#f97316", "#22c55e", "#6366f1", "#84cc16",
  "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6",
]

const LOST_REASON_PALETTE = [
  "#ef4444", "#f59e0b", "#f97316", "#dc2626", "#6b7280",
  "#8b5cf6", "#ec4899", "#0ea5e9", "#10b981", "#84cc16",
]

const AD_TYPE_COLORS: Record<string, string> = {
  Form: "#3b82f6",
  DM: "#06b6d4",
  Manual: "#10b981",
}

function adTypeColor(adType: string, index: number): string {
  return AD_TYPE_COLORS[adType] ?? BAR_PALETTE[index % BAR_PALETTE.length]
}

const FUNNEL_COLORS = [
  "#3b82f6", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#db2777",
]

const PAID_SOCIAL_SOURCES = ["meta", "facebook", "instagram", "tiktok", "fb", "snapchat", "pinterest"]
const PAID_SOCIAL_MEDIUMS = ["paid_social", "paidsocial", "paid social", "cpc", "cpm", "paid_search", "paid_ads"]

function isPaidSocial(opp: Opportunity): boolean {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  return PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) || PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m))
}

function isLostStage(stage: string): boolean {
  const s = stage.toLowerCase()
  return s.includes("perdido") || s.includes("lost") || s.includes("terminado")
}

function barColor(i: number) { return BAR_PALETTE[i % BAR_PALETTE.length] }
function stageColor(stage: string, index: number) { return STAGE_COLORS[stage] ?? BAR_PALETTE[index % BAR_PALETTE.length] }

function sourceLabel(opp: Opportunity): string {
  const parts: string[] = []
  if (opp.adType) parts.push(opp.adType)
  if (opp.source) parts.push(opp.source)
  return parts.length > 0 ? parts.join(" / ") : "Directo"
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

const iconCls = "h-4 w-4 shrink-0 text-muted-foreground"

export function MarketingDashboard({ opportunities, contacts, pautas, tasks = [], calls = [] }: MarketingDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const openPautaDrill = useCallback((title: string, pautaItems: Pauta[]) => {
    setDrill({ open: true, title, opportunities: [], pautas: pautaItems })
  }, [])

  // Derive ordered stage list from data
  const stageOrder = useMemo(() => {
    const preferred = [
      "Primera Cita", "Segunda Cita", "Envío de propuesta", "Envío de liga de pago",
      "Proceso de Implementación", "Cliente Activo", "Servicio Terminado", "Prospecto Perdido",
      "Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost",
    ]
    const actual = new Set(opportunities.map((o) => o.stage))
    const ordered = preferred.filter((s) => actual.has(s))
    for (const s of actual) if (!ordered.includes(s)) ordered.push(s)
    return ordered
  }, [opportunities])

  // 1. Leads por Campaña
  const leadsByCampaign = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.campaign || "Sin campaña"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([campaign, count]) => ({ campaign, count }))
  }, [opportunities])

  // 2. Leads por Fuente
  const leadsBySource = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = sourceLabel(o)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([source, count]) => ({ source, count }))
  }, [opportunities])

  // 3. Campaña por Etapa del Pipeline
  const campaignByStage = useMemo(() => {
    const campaigns = Array.from(new Set(opportunities.map((o) => o.campaign || "Sin campaña")))
    return campaigns
      .map((campaign) => {
        const row: Record<string, string | number> = { campaign }
        for (const stage of stageOrder) {
          row[stage] = opportunities.filter(
            (o) => (o.campaign || "Sin campaña") === campaign && o.stage === stage
          ).length
        }
        return row
      })
      .filter((row) => stageOrder.some((s) => (row[s] as number) > 0))
      .sort((a, b) => {
        const sumA = stageOrder.reduce((acc, s) => acc + ((a[s] as number) || 0), 0)
        const sumB = stageOrder.reduce((acc, s) => acc + ((b[s] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [opportunities, stageOrder])

  // 4. Fuente por Etapa del Pipeline
  const sourceByStage = useMemo(() => {
    const sources = Array.from(new Set(opportunities.map((o) => sourceLabel(o))))
    return sources
      .map((source) => {
        const row: Record<string, string | number> = { source }
        for (const stage of stageOrder) {
          row[stage] = opportunities.filter(
            (o) => sourceLabel(o) === source && o.stage === stage
          ).length
        }
        return row
      })
      .filter((row) => stageOrder.some((s) => (row[s] as number) > 0))
      .sort((a, b) => {
        const sumA = stageOrder.reduce((acc, s) => acc + ((a[s] as number) || 0), 0)
        const sumB = stageOrder.reduce((acc, s) => acc + ((b[s] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [opportunities, stageOrder])

  const stageChartConfig = Object.fromEntries(
    stageOrder.map((stage, i) => [stage, { label: stage, color: stageColor(stage, i) }])
  )

  // 5. Leads Perdidos por Campaña y Razón
  const lostOpps = useMemo(() => opportunities.filter((o) => o.status === "lost"), [opportunities])

  const lostReasons = useMemo(() => {
    const s = new Set(lostOpps.map((o) => o.lostReason || "Sin razón"))
    return Array.from(s).sort()
  }, [lostOpps])

  const lostByCampaignReason = useMemo(() => {
    const campaigns = Array.from(new Set(lostOpps.map((o) => o.campaign || "Sin campaña")))
    return campaigns
      .map((campaign) => {
        const row: Record<string, string | number> = { campaign }
        for (const reason of lostReasons) {
          row[reason] = lostOpps.filter(
            (o) => (o.campaign || "Sin campaña") === campaign && (o.lostReason || "Sin razón") === reason
          ).length
        }
        return row
      })
      .filter((row) => lostReasons.some((r) => (row[r] as number) > 0))
      .sort((a, b) => {
        const sumA = lostReasons.reduce((acc, r) => acc + ((a[r] as number) || 0), 0)
        const sumB = lostReasons.reduce((acc, r) => acc + ((b[r] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [lostOpps, lostReasons])

  const lostReasonConfig = Object.fromEntries(
    lostReasons.map((r, i) => [r, { label: r, color: LOST_REASON_PALETTE[i % LOST_REASON_PALETTE.length] }])
  )

  // 6. Leads por Tipo de Anuncio (donut)
  const leadsByAdType = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.adType || "Otro"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([adType, value], i) => ({ adType, value, color: adTypeColor(adType, i) }))
  }, [opportunities])

  // 7. Embudo Paid Social
  const paidSocialFunnel = useMemo(() => {
    const paid = opportunities.filter((o) => isPaidSocial(o) && !isLostStage(o.stage))
    const counts = new Map<string, number>()
    for (const o of paid) counts.set(o.stage, (counts.get(o.stage) ?? 0) + 1)
    return stageOrder
      .filter((s) => !isLostStage(s) && counts.has(s))
      .map((stage) => ({ stage, count: counts.get(stage)! }))
  }, [opportunities, stageOrder])

  const pautasByTipo = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pautas) counts.set(p.tipo, (counts.get(p.tipo) ?? 0) + 1)
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, count]) => ({ tipo, count }))
  }, [pautas])

  const pautasByNombre = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pautas) counts.set(p.nombrePauta, (counts.get(p.nombrePauta) ?? 0) + 1)
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([nombre, count]) => ({ nombre, count }))
  }, [pautas])

  return (
    <div className="flex flex-col gap-4 px-6 pb-6">

      {/* Row 1: Leads por Campaña + Leads por Fuente */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* 1. Leads por Campaña */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Megaphone className={iconCls} />
            <CardTitle className="text-sm font-semibold">Leads por Campaña</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: "Leads", color: "#2563eb" } }} className="h-[300px] aspect-auto">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadsByCampaign} margin={{ top: 5, right: 10, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="campaign" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={72} tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.campaign ?? String(_)} />} />
                  <Bar
                    dataKey="count"
                    radius={[6, 6, 0, 0]}
                    name="Leads"
                    maxBarSize={52}
                    cursor="pointer"
                    onClick={(data: any) => openDrill(
                      `Campaña: ${data.campaign}`,
                      opportunities.filter((o) => (o.campaign || "Sin campaña") === data.campaign)
                    )}
                  >
                    {leadsByCampaign.map((entry, i) => (
                      <Cell key={entry.campaign} fill={barColor(i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
          </CardContent>
        </Card>

        {/* 2. Leads por Fuente */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Globe className={iconCls} />
            <CardTitle className="text-sm font-semibold">Leads por Fuente</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: "Leads", color: "#2563eb" } }} className="h-[300px] aspect-auto">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadsBySource} margin={{ top: 5, right: 10, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="source" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={72} tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.source ?? String(_)} />} />
                  <Bar
                    dataKey="count"
                    radius={[6, 6, 0, 0]}
                    name="Leads"
                    maxBarSize={52}
                    cursor="pointer"
                    onClick={(data: any) => openDrill(
                      `Fuente: ${data.source}`,
                      opportunities.filter((o) => sourceLabel(o) === data.source)
                    )}
                  >
                    {leadsBySource.map((entry, i) => (
                      <Cell key={entry.source} fill={barColor(i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
          </CardContent>
        </Card>

      </div>

      {/* Row 2: Campaña por Etapa + Fuente por Etapa */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* 3. Campaña por Etapa del Pipeline */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <BarChart3 className={iconCls} />
            <CardTitle className="text-sm font-semibold">Campaña por Etapa del Pipeline</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            <ChartContainer config={stageChartConfig} className="h-[420px] aspect-auto">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={campaignByStage} margin={{ top: 5, right: 10, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="campaign" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={80} tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.campaign ?? String(_)} />} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10, paddingTop: 12 }} />
                  {stageOrder.map((stage, i) => (
                    <Bar
                      key={stage}
                      dataKey={stage}
                      stackId="a"
                      fill={stageColor(stage, i)}
                      radius={i === stageOrder.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const campaign = data.campaign as string
                        openDrill(
                          `${campaign} · ${stage}`,
                          opportunities.filter((o) => (o.campaign || "Sin campaña") === campaign && o.stage === stage)
                        )
                      }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los leads</p>
          </CardContent>
        </Card>

        {/* 4. Fuente por Etapa del Pipeline */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Layers className={iconCls} />
            <CardTitle className="text-sm font-semibold">Fuente por Etapa del Pipeline</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            <ChartContainer config={stageChartConfig} className="h-[420px] aspect-auto">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceByStage} margin={{ top: 5, right: 10, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="source" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={80} tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.source ?? String(_)} />} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10, paddingTop: 12 }} />
                  {stageOrder.map((stage, i) => (
                    <Bar
                      key={stage}
                      dataKey={stage}
                      stackId="a"
                      fill={stageColor(stage, i)}
                      radius={i === stageOrder.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const source = data.source as string
                        openDrill(
                          `${source} · ${stage}`,
                          opportunities.filter((o) => sourceLabel(o) === source && o.stage === stage)
                        )
                      }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los leads</p>
          </CardContent>
        </Card>

      </div>

      {/* Row 3: Leads Perdidos + Tipo de Anuncio */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* 5. Leads Perdidos por Campaña y Razón */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <TrendingDown className={iconCls} />
            <CardTitle className="text-sm font-semibold">Leads Perdidos por Campaña y Razón</CardTitle>
            <span className="ml-auto inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-destructive">
              Perdidos: {lostOpps.length}
            </span>
          </CardHeader>
          <CardContent>
            {lostByCampaignReason.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                Sin leads perdidos en el filtro actual.
              </div>
            ) : (
              <>
                <ChartContainer config={lostReasonConfig} className="h-[360px] aspect-auto">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lostByCampaignReason} margin={{ top: 5, right: 10, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="campaign" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={72} tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v} />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.campaign ?? String(_)} />} />
                      <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10, paddingTop: 12 }} />
                      {lostReasons.map((reason, i) => (
                        <Bar
                          key={reason}
                          dataKey={reason}
                          fill={LOST_REASON_PALETTE[i % LOST_REASON_PALETTE.length]}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={20}
                          cursor="pointer"
                          onClick={(data: any) => {
                            const campaign = data.campaign as string
                            openDrill(
                              `${campaign} · ${reason}`,
                              lostOpps.filter((o) => (o.campaign || "Sin campaña") === campaign && (o.lostReason || "Sin razón") === reason)
                            )
                          }}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* 6. Leads por Tipo de Anuncio — donut + bar breakdown */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Tag className={iconCls} />
            <CardTitle className="text-sm font-semibold">Leads por Tipo de Anuncio</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            {leadsByAdType.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de tipo de anuncio.
              </div>
            ) : (() => {
              const total = leadsByAdType.reduce((s, e) => s + e.value, 0)
              const maxVal = leadsByAdType[0].value
              return (
                <div className="flex items-center gap-4">
                  {/* Left: compact donut with absolutely-positioned center label */}
                  <div style={{ width: 160, height: 200, flexShrink: 0, position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leadsByAdType}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={72}
                          dataKey="value"
                          nameKey="adType"
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                          paddingAngle={2}
                          activeIndex={hoveredAdType}
                          activeShape={(props: any) => (
                            <Sector
                              cx={props.cx}
                              cy={props.cy}
                              innerRadius={props.innerRadius}
                              outerRadius={props.outerRadius + 5}
                              startAngle={props.startAngle}
                              endAngle={props.endAngle}
                              fill={props.fill}
                              stroke="none"
                            />
                          )}
                        >
                          {leadsByAdType.map((entry) => (
                            <Cell key={entry.adType} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center text overlay — absolute positioning is more reliable than SVG text children in Recharts */}
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        textAlign: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div style={{ color: "hsl(var(--foreground))", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{total}</div>
                      <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 9, marginTop: 2 }}>LEADS</div>
                    </div>
                  </div>

                  {/* Right: ranked bar list */}
                  <div className="flex flex-1 flex-col gap-y-2.5">
                    {leadsByAdType.map((entry, i) => {
                      const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                      const barWidth = maxVal > 0 ? (entry.value / maxVal) * 100 : 0
                      const label = entry.adType.length > 18 ? entry.adType.slice(0, 18) + "…" : entry.adType
                      return (
                        <div
                          key={entry.adType}
                          className="cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-accent/20 transition-colors"
                          onClick={() =>
                            openDrill(
                              `Tipo de Anuncio: ${entry.adType}`,
                              opportunities.filter((o) => (o.adType || "Otro") === entry.adType)
                            )
                          }
                          onMouseEnter={() => setHoveredAdType(i)}
                          onMouseLeave={() => setHoveredAdType(undefined)}
                        >
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-xs text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground tabular-nums ml-2 shrink-0">
                              {entry.value} · {pct}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded bg-muted overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{ width: `${barWidth}%`, backgroundColor: entry.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Haz clic en una fila para ver los leads
            </p>
          </CardContent>
        </Card>

      </div>

      {/* Row 4: Paid Social Funnel */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Layers className={iconCls} />
          <CardTitle className="text-sm font-semibold">Embudo Paid Social</CardTitle>
          <TotalBadge value={paidSocialFunnel.reduce((s, f) => s + f.count, 0)} />
        </CardHeader>
        <CardContent>
          {paidSocialFunnel.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              Sin datos Paid Social en el filtro actual.
            </div>
          ) : (
            <div className="flex flex-col gap-2 py-2">
              {paidSocialFunnel.map((item, i) => {
                const topCount = paidSocialFunnel[0].count
                const widthPct = (item.count / topCount) * 100
                const convFromPrev = i === 0 ? null : (item.count / paidSocialFunnel[i - 1].count) * 100
                return (
                  <div key={item.stage} className="flex items-center gap-4">
                    <span className="w-48 shrink-0 text-right text-xs font-medium text-muted-foreground truncate">
                      {item.stage}
                    </span>
                    <div className="flex flex-1 items-center justify-center h-9">
                      <button
                        type="button"
                        className="h-full rounded flex items-center justify-center transition-all hover:opacity-80 cursor-pointer"
                        style={{ width: `${widthPct}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}
                        onClick={() => openDrill(
                          `Paid Social · ${item.stage}`,
                          opportunities.filter((o) => isPaidSocial(o) && o.stage === item.stage)
                        )}
                      >
                        {widthPct > 15 && (
                          <span className="text-xs font-semibold text-white px-2 truncate">
                            {item.count} leads
                          </span>
                        )}
                      </button>
                    </div>
                    <div className="w-28 shrink-0 flex items-center gap-2 text-xs">
                      {widthPct <= 15 && <span className="font-semibold text-foreground tabular-nums">{item.count}</span>}
                      <span className="text-muted-foreground tabular-nums">{widthPct.toFixed(0)}%</span>
                      {convFromPrev !== null && <span className="text-destructive font-medium">↓{convFromPrev.toFixed(0)}%</span>}
                    </div>
                  </div>
                )
              })}
              <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 5: Pautas por Tipo + Pautas por Nombre */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Pautas por Tipo */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText className={iconCls} />
            <CardTitle className="text-sm font-semibold">Pautas por Tipo</CardTitle>
            <TotalBadge value={pautas.length} />
          </CardHeader>
          <CardContent>
            {pautasByTipo.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de Pautas.
              </div>
            ) : (
              <>
                <ChartContainer config={{ count: { label: "Pautas", color: "#2563eb" } }} className="aspect-auto" style={{ height: Math.max(220, pautasByTipo.length * 44 + 20) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={pautasByTipo} margin={{ top: 5, right: 30, left: 8, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="tipo" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={150} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.tipo ?? String(_)} />} />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Pautas"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) => openPautaDrill(
                          `Tipo: ${data.tipo}`,
                          pautas.filter((p) => p.tipo === data.tipo)
                        )}
                      >
                        {pautasByTipo.map((entry, i) => (
                          <Cell key={entry.tipo} fill={barColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver las pautas</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Pautas por Nombre Pauta */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText className={iconCls} />
            <CardTitle className="text-sm font-semibold">Pautas por Nombre (Top 30)</CardTitle>
            <TotalBadge value={pautas.length} />
          </CardHeader>
          <CardContent>
            {pautasByNombre.length === 0 ? (
              <div className="flex h-[520px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de Pautas.
              </div>
            ) : (
              <>
                <ChartContainer config={{ count: { label: "Pautas", color: "#2563eb" } }} className="aspect-auto" style={{ height: Math.max(300, pautasByNombre.length * 28 + 20) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={pautasByNombre} margin={{ top: 5, right: 30, left: 8, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={180} tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 26) + "…" : v} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.nombre ?? String(_)} />} />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Pautas"
                        maxBarSize={22}
                        cursor="pointer"
                        onClick={(data: any) => openPautaDrill(
                          `Pauta: ${data.nombre}`,
                          pautas.filter((p) => p.nombrePauta === data.nombre)
                        )}
                      >
                        {pautasByNombre.map((entry, i) => (
                          <Cell key={entry.nombre} fill={barColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver las pautas</p>
              </>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Drill-down drawer */}
      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={contacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={opportunities}
      />
    </div>
  )
}
