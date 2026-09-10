"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  AlertTriangle,
  Banknote,
  Clock,
  Coins,
  Megaphone,
  MousePointerClick,
  Users2,
} from "lucide-react"
import type { AdsReport, AdStat, Opportunity, Pauta } from "@/lib/types"
import type { ResolvedDateRange } from "@/lib/date-range"
import {
  adsWindow,
  daysInWindow,
  sumAdDays,
  costPer,
  isWindowClipped,
  toDayKey,
  joinPautasToAds,
  campaignsFromAds,
} from "@/lib/ads"
import {
  BRAND_AMBER,
  STRUCTURAL_NAVY,
  CHART_GRID_STROKE,
  CHART_TICK,
  DashboardCard,
  ChartCardHeader,
  ChartCardContent,
  ChartEmpty,
  ChartHint,
  ScopePill,
  SectionHeader,
  NonZeroTooltipContent,
  PipelineScopeNotice,
} from "./dashboard-ui"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface AdsSectionProps {
  ads?: AdsReport
  /** The active global date filter, already resolved. Null means "todo". */
  dateRange: ResolvedDateRange | null
  /**
   * Opportunities the CRM classifies as coming from paid advertising, already
   * date-filtered. Classification stays with lib/pauta in the parent — this
   * component must never re-derive "es de pauta".
   */
  pautaOpportunities: Opportunity[]
  /**
   * Pauta records for the active window. These carry `id_de_pauta` — the Meta ad
   * id — which is the ONLY key that joins CRM leads to ad spend. Without them the
   * campaign table can only show GHL's CDP attribution, which is empty.
   */
  pautas: Pauta[]
  /**
   * Per-ad Meta rows for the active window, fetched by the parent. Owned there
   * rather than here because the pauta chart needs the same rows — two hooks
   * would mean two N+1 fetches of identical data.
   */
  adRows: AdStat[]
  adRowsLoading: boolean
  adRowsError: string | null
  /** Opens the parent's drill-down drawer. */
  onDrill?: (drill: { title: string; subtitle?: string; opportunities: Opportunity[] }) => void
  /**
   * Label of the active pipeline filter, when one is on. Its presence means the
   * `pautas` and `pautaOpportunities` above are deliberately NOT pipeline-filtered:
   * Meta reports spend per ad account, with no pipeline dimension, so a
   * pipeline-scoped denominator against an account-wide numerator would multiply
   * every cost figure here. The notice says so instead of hiding it.
   */
  pipelineNotice?: string
}

// ---------------------------------------------------------------------------
// The "not connected" banner — the common case, not an error
// ---------------------------------------------------------------------------

// What the user can actually DO about each state. The status message from the
// server says what happened; this says who fixes it, which is the part that
// decides whether the reader closes the tab or acts.
const STATUS_ACTION: Record<string, string> = {
  disconnected:
    "Para verla, el cliente debe vincular su cuenta publicitaria de Meta en GHL → Ajustes → Integraciones → Facebook.",
  expired:
    "Los datos se reanudan en cuanto se vuelva a autorizar la conexión; no se pierde el histórico.",
  unauthorized:
    "Es un ajuste de nuestro lado: basta con activar el permiso en el token de la subcuenta.",
  error: "Si persiste, revisa el estado de la integración de Facebook en GHL.",
}

/**
 * `ads` is absent, which is NOT the same as "not connected".
 *
 * The cache is disposable and unversioned, so a row written before this feature
 * shipped simply has no `ads` field. Rendering the disconnected notice for it
 * states a fact we do not have — and it is the wrong fact for any client who
 * does have Meta linked. Say what is actually true: we have not looked yet.
 */
function AdsPendingNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-[13px] font-semibold leading-snug text-foreground">
          Inversión de Meta aún no sincronizada
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Estos datos se agregaron después de la última sincronización de esta subcuenta. Aparecerán
          en la próxima actualización automática, o al pulsar «Actualizar».
        </p>
      </div>
    </div>
  )
}

function AdsNotice({ ads }: { ads: AdsReport }) {
  const action = STATUS_ACTION[ads.status] ?? STATUS_ACTION.error
  // Amber, not red: nothing is broken. An account with no ads linked is a
  // perfectly normal account, and a red banner would send the client chasing an
  // outage that does not exist.
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-[13px] font-semibold leading-snug text-foreground">
          Sin datos de inversión en Meta
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {ads.message ?? "No se pudo leer el reporte de Meta."} {action}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat tiles — a headline number is not a chart
// ---------------------------------------------------------------------------

function AdStat({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof Banknote
  accent?: boolean
}) {
  return (
    <div
      className={
        "flex flex-col rounded-xl border px-4 py-3.5 " +
        (accent ? "border-primary/25 bg-primary/[0.05]" : "border-border bg-card")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </p>
        <Icon
          className={"h-4 w-4 shrink-0 " + (accent ? "text-primary/70" : "text-muted-foreground/45")}
          aria-hidden
        />
      </div>
      <p
        className={
          "mt-2 text-[24px] font-bold leading-none tabular-nums " +
          (accent ? "text-primary" : "text-foreground")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-[11px] leading-snug tabular-nums text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

type Granularity = "day" | "week" | "month"

/**
 * Bucket size from the window length, so a bar chart never has 300 bars or 3.
 * Chosen by span rather than exposed as a control: it is a legibility decision,
 * not a preference, and the date filter above already owns the period.
 */
function pickGranularity(days: number): Granularity {
  if (days <= 31) return "day"
  if (days <= 120) return "week"
  return "month"
}

/** ISO-ish week start (Monday) as YYYY-MM-DD. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return toDayKey(d)
}

function bucketKey(iso: string, g: Granularity): string {
  if (g === "day") return iso
  if (g === "month") return iso.slice(0, 7)
  return weekStart(iso)
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-")
    return `${MONTHS_ES[Number(m) - 1]} ${y.slice(2)}`
  }
  const [, m, d] = key.split("-")
  return `${Number(d)} ${MONTHS_ES[Number(m) - 1]}`
}

/** "2 sep 2025" — used where the window may span a year boundary. */
function longDayLabel(key: string): string {
  const [y, m, d] = key.split("-")
  return `${Number(d)} ${MONTHS_ES[Number(m) - 1]} ${y}`
}

/**
 * La tabla por campana esta apagada mientras se arregla el join por ad id.
 * El resto de la seccion (inversion, clics, CPL, graficas) no depende de ella.
 */
const SHOW_CAMPAIGN_TABLE = false

// ---------------------------------------------------------------------------

export function AdsSection({
  ads,
  dateRange,
  pautaOpportunities,
  pautas,
  adRows,
  adRowsLoading: campaignsLoading,
  adRowsError: campaignsError,
  onDrill,
  pipelineNotice,
}: AdsSectionProps) {
  // The window the ad numbers actually describe: the active filter clipped to
  // the days fetched from Meta. Everything below — spend AND the lead count it
  // is divided by — is scoped to this, so the two halves of every cost figure
  // always cover the same days.
  const adWindow = useMemo(() => adsWindow(ads, dateRange), [ads, dateRange])
  const clipped = useMemo(() => isWindowClipped(ads, dateRange), [ads, dateRange])

  const days = useMemo(() => daysInWindow(ads?.daily ?? [], adWindow), [ads?.daily, adWindow])
  const totals = useMemo(() => sumAdDays(days), [days])

  // CRM leads inside the SAME window. This — not Meta's action counts — is the
  // CPL denominator: Meta's action types overlap and which one means "lead"
  // depends on the campaign objective, whereas the CRM has one unambiguous
  // record per lead.
  const leadsInWindow = useMemo(() => {
    if (!adWindow) return []
    return pautaOpportunities.filter((o) => {
      const d = (o.createdAt ?? "").slice(0, 10)
      return d >= adWindow.from && d <= adWindow.to
    })
  }, [pautaOpportunities, adWindow])

  const money = useMemo(() => {
    const currency = ads?.currency
    const fmt = new Intl.NumberFormat("es-MX", {
      ...(currency ? { style: "currency" as const, currency } : {}),
      maximumFractionDigits: 0,
    })
    const fmtPrecise = new Intl.NumberFormat("es-MX", {
      ...(currency ? { style: "currency" as const, currency } : {}),
      maximumFractionDigits: 2,
    })
    return {
      round: (n: number) => fmt.format(n),
      precise: (n: number) => fmtPrecise.format(n),
    }
  }, [ads?.currency])

  const granularity = useMemo<Granularity>(() => {
    if (!adWindow) return "month"
    const span =
      (new Date(`${adWindow.to}T00:00:00`).getTime() -
        new Date(`${adWindow.from}T00:00:00`).getTime()) /
        86_400_000 +
      1
    return pickGranularity(span)
  }, [adWindow])

  // One row per bucket, carrying spend, CRM leads, and the cost per lead the two
  // imply. Built together so the CPL of a bucket can never be computed from a
  // different bucket's numbers.
  const buckets = useMemo(() => {
    const map = new Map<string, { key: string; spend: number; leads: number }>()
    for (const d of days) {
      const key = bucketKey(d.date, granularity)
      const row = map.get(key) ?? { key, spend: 0, leads: 0 }
      row.spend += d.spend
      map.set(key, row)
    }
    for (const o of leadsInWindow) {
      const iso = (o.createdAt ?? "").slice(0, 10)
      if (!iso) continue
      const key = bucketKey(iso, granularity)
      // Only into buckets that already exist: a lead on a day with no delivery
      // belongs to no spend bucket, and inventing one would draw a bar of
      // infinite efficiency.
      const row = map.get(key)
      if (row) row.leads += 1
    }
    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({
        ...r,
        label: bucketLabel(r.key, granularity),
        cpl: r.leads > 0 ? r.spend / r.leads : 0,
      }))
  }, [days, leadsInWindow, granularity])

  const cpl = costPer(totals.spend, leadsInWindow.length)

  // Pautas inside the same clipped window, joined to Meta ads by ad id.
  const pautasInWindow = useMemo(() => {
    if (!adWindow) return []
    return pautas.filter((p) => {
      const d = (p.createdAt ?? "").slice(0, 10)
      return d >= adWindow.from && d <= adWindow.to
    })
  }, [pautas, adWindow])

  const adIds = useMemo(() => new Set(adRows.map((a) => a.adId)), [adRows])
  const join = useMemo(() => joinPautasToAds(pautasInWindow, adIds), [pautasInWindow, adIds])
  const campaigns = useMemo(
    () => campaignsFromAds(adRows, join.leadsByAdId),
    [adRows, join.leadsByAdId]
  )

  if (!ads || ads.status !== "connected") {
    return (
      <div className="flex flex-col gap-3">
        <SectionHeader title="Inversión en pauta (Meta)" />
        {ads ? <AdsNotice ads={ads} /> : <AdsPendingNotice />}
      </div>
    )
  }

  // Includes the year: the clipped window routinely spans a year boundary, and
  // "2 sep – 1 sep" reads as a single day rather than twelve months.
  const windowLabel = adWindow
    ? `${longDayLabel(adWindow.from)} – ${longDayLabel(adWindow.to)}`
    : "sin datos en el periodo"

  const drillBucket = (row: { key: string; label: string; leads: number }) => {
    if (!onDrill || row.leads === 0) return
    onDrill({
      title: `Leads de pauta · ${row.label}`,
      subtitle: "Oportunidades de pauta creadas en el periodo",
      opportunities: leadsInWindow.filter(
        (o) => bucketKey((o.createdAt ?? "").slice(0, 10), granularity) === row.key
      ),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Inversión en pauta (Meta)" />

      {pipelineNotice && <PipelineScopeNotice label={pipelineNotice} />}

      {/* The window the ad numbers cover is stated whenever it is narrower than
          the filter. A CPL computed over a shorter period than the leads beside
          it looks like a win; saying so is the difference between a metric and
          a misreading. */}
      {(clipped || !adWindow) && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {adWindow ? (
              <>
                Meta solo entrega los últimos 365 días de inversión, así que estas cifras cubren{" "}
                <span className="font-semibold text-foreground">{windowLabel}</span> aunque el filtro
                de fechas abarque más. El resto del tablero sí usa el periodo completo.
              </>
            ) : (
              <>
                No hay inversión registrada en el periodo seleccionado. Meta solo entrega los últimos
                365 días.
              </>
            )}
          </p>
        </div>
      )}

      {adWindow && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <AdStat
              label="Inversión"
              value={money.round(totals.spend)}
              sub={ads.adAccountName ? `Cuenta ${ads.adAccountName}` : undefined}
              icon={Banknote}
            />
            <AdStat
              label="Costo por lead"
              value={cpl === null ? "—" : money.precise(cpl)}
              sub={`${leadsInWindow.length.toLocaleString("es-MX")} leads de pauta en el CRM`}
              icon={Coins}
              accent
            />
            <AdStat
              label="Costo por clic"
              value={totals.cpc > 0 ? money.precise(totals.cpc) : "—"}
              sub={`${totals.clicks.toLocaleString("es-MX")} clics`}
              icon={MousePointerClick}
            />
            <AdStat
              label="CTR"
              value={`${totals.ctr.toFixed(2)}%`}
              sub={`${totals.impressions.toLocaleString("es-MX")} impresiones`}
              icon={Megaphone}
            />
            <AdStat
              label="Alcance"
              value={totals.reach.toLocaleString("es-MX")}
              sub={
                totals.reachIsSum
                  ? "Suma diaria — una misma persona puede contarse varios días"
                  : undefined
              }
              icon={Users2}
            />
          </div>

          {/* Two charts, never one with two y-axes: spend and cost-per-lead are
              different scales and a shared axis would make one of them a flat
              line at zero. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DashboardCard>
              <ChartCardHeader
                title="Inversión por periodo"
                total={money.round(totals.spend)}
                icon={Banknote}
                actions={
                  <ScopePill
                    label={ads.currency ?? "Meta"}
                    tooltip={
                      <>
                        Gasto reportado por Meta para la cuenta publicitaria vinculada
                        {ads.currency ? `, en ${ads.currency}` : ""}. Los días sin entrega no
                        aparecen.
                      </>
                    }
                  />
                }
              />
              <ChartCardContent>
                {buckets.length === 0 ? (
                  <ChartEmpty message="Sin inversión en el periodo." height={240} />
                ) : (
                  <ChartContainer
                    config={{ spend: { label: "Inversión", color: BRAND_AMBER } }}
                    className="aspect-auto"
                    style={{ height: 240 }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={buckets}
                        margin={{ top: 5, right: 16, left: 8, bottom: 16 }}
                        barCategoryGap="20%"
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          angle={-45}
                          textAnchor="end"
                        />
                        <YAxis
                          tick={{ ...CHART_TICK }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => money.round(v)}
                          width={72}
                        />
                        <ChartTooltip
                          content={
                            <NonZeroTooltipContent
                              formatter={(value) => (
                                <span className="tabular-nums">{money.precise(Number(value))}</span>
                              )}
                            />
                          }
                        />
                        <Bar
                          dataKey="spend"
                          name="Inversión"
                          fill={BRAND_AMBER}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={40}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                )}
                <ChartHint>
                  {granularity === "day" ? "Por día" : granularity === "week" ? "Por semana" : "Por mes"} ·
                  cuenta {ads.adAccountName ?? ads.adAccountId}
                </ChartHint>
              </ChartCardContent>
            </DashboardCard>

            <DashboardCard>
              <ChartCardHeader
                title="Costo por lead"
                total={cpl === null ? "—" : money.precise(cpl)}
                icon={Coins}
                actions={
                  <ScopePill
                    label="CRM"
                    tooltip={
                      <>
                        Inversión de Meta dividida entre las oportunidades que el CRM clasifica como
                        de pauta en el mismo periodo. Usamos el conteo del CRM y no el de Meta porque
                        los tipos de acción de Meta se traslapan entre sí. Meta corta los días en el
                        huso de la cuenta publicitaria y el CRM en UTC, así que por día un lead
                        puede caer en la barra vecina; por semana o mes no afecta.
                      </>
                    }
                  />
                }
              />
              <ChartCardContent>
                {buckets.every((b) => b.cpl === 0) ? (
                  <ChartEmpty
                    message="Sin leads de pauta en los periodos con inversión."
                    height={240}
                  />
                ) : (
                  <ChartContainer
                    config={{ cpl: { label: "Costo por lead", color: STRUCTURAL_NAVY } }}
                    className="aspect-auto"
                    style={{ height: 240 }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={buckets}
                        margin={{ top: 5, right: 16, left: 8, bottom: 16 }}
                        barCategoryGap="20%"
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          angle={-45}
                          textAnchor="end"
                        />
                        <YAxis
                          tick={{ ...CHART_TICK }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => money.round(v)}
                          width={72}
                        />
                        <ChartTooltip
                          content={
                            <NonZeroTooltipContent
                              formatter={(value) => (
                                <span className="tabular-nums">{money.precise(Number(value))}</span>
                              )}
                            />
                          }
                        />
                        <Bar
                          dataKey="cpl"
                          name="Costo por lead"
                          fill={STRUCTURAL_NAVY}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={40}
                          cursor={onDrill ? "pointer" : undefined}
                          onClick={(data: unknown) =>
                            drillBucket(data as { key: string; label: string; leads: number })
                          }
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                )}
                <ChartHint>
                  Solo aparecen los periodos con inversión registrada, así que la suma de las barras
                  puede no cuadrar con el costo por lead de arriba, que sí cubre todo el periodo ·
                  haz clic en una barra para ver las oportunidades
                </ChartHint>
              </ChartCardContent>
            </DashboardCard>
          </div>

          {/* Oculto a proposito: en amir-cherit la tabla se quedo en «Cargando
              campanas» y reporto 3 764 de 3 764 pautas como inalcanzables.
              Se vuelve a encender poniendo SHOW_CAMPAIGN_TABLE en true. */}
          {SHOW_CAMPAIGN_TABLE && (
          <DashboardCard>
            <ChartCardHeader
              title="Campañas de Meta"
              total={campaigns.length}
              icon={Megaphone}
              actions={
                <ScopePill
                  label="Pautas"
                  tooltip={
                    <>
                      Los leads son registros del objeto Pauta, unidos a cada anuncio por el id de
                      Meta que guardan en «id_de_pauta». Es un cruce exacto por id, no por nombre —
                      el nombre del anuncio en Meta y el de la pauta casi nunca coinciden.
                    </>
                  }
                />
              }
            />
            <ChartCardContent>
              {campaignsLoading ? (
                <ChartEmpty message="Cargando campañas…" height={160} />
              ) : campaignsError ? (
                <ChartEmpty message={campaignsError} height={160} />
              ) : campaigns.length === 0 ? (
                <ChartEmpty message="Sin campañas con datos en el periodo." height={160} />
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[42%]">Campaña</TableHead>
                        <TableHead className="text-right">Inversión</TableHead>
                        <TableHead className="text-right">Clics</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Costo/lead</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaigns.map((c) => {
                        const campaignCpl = costPer(c.spend, c.leads)
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="max-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={
                                    "h-1.5 w-1.5 shrink-0 rounded-full " +
                                    (c.status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/40")
                                  }
                                  aria-hidden
                                />
                                <span className="truncate text-[12px]" title={c.name}>
                                  {c.name}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {money.round(c.spend)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.clicks.toLocaleString("es-MX")}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.leads.toLocaleString("es-MX")}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {campaignCpl === null ? "—" : money.precise(campaignCpl)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <ChartHint>
                Ordenadas por inversión · el punto verde marca las campañas activas
                {join.unmatched > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">
                      {join.unmatched.toLocaleString("es-MX")} de{" "}
                      {(join.matched + join.unmatched).toLocaleString("es-MX")} pautas
                    </span>{" "}
                    no aparecen aquí
                    {join.unlinkedAccount > 0 && (
                      <>
                        {" "}
                        ({join.unlinkedAccount.toLocaleString("es-MX")} de anuncios que no están en
                        la cuenta publicitaria vinculada en GHL
                        {join.noAdId > 0 && `, ${join.noAdId.toLocaleString("es-MX")} sin id de anuncio`}
                        )
                      </>
                    )}
                    : su inversión no es visible desde aquí, no es cero.
                  </>
                )}
              </ChartHint>
            </ChartCardContent>
          </DashboardCard>
          )}
        </>
      )}
    </div>
  )
}
