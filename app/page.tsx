"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { AnimatePresence } from "framer-motion"
import { MarketingDashboard } from "@/components/dashboard/marketing-dashboard"
import { DateRangeFilter } from "@/components/dashboard/date-range-filter"
import { FilterBar, FilterDivider } from "@/components/dashboard/filter-bar"
import { PipelineFilterControl } from "@/components/dashboard/pipeline-filter"
import { filterByDateRange, isLargeDataset, resolveDateRange, type DateFilter } from "@/lib/date-range"
import {
  contactIdsInPipelines,
  filterByContactIds,
  filterOpportunitiesByPipelines,
  pipelineFilterLabel,
  selectedPipelines,
  type PipelineFilter,
} from "@/lib/pipeline-filter"
import { format, formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { SalesDashboard } from "@/components/dashboard/sales-dashboard"
import { ConversationsChat } from "@/components/dashboard/conversations-chat"
import { LoadingScreen } from "@/components/dashboard/loading-screen"
import { useDashboardData } from "@/hooks/use-dashboard-data"
import { useConversationsData } from "@/hooks/use-conversations-data"
import {
  TrendingUp,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  Users,
  Target,
  ClipboardList,
  Sparkles,
  LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type DashboardTab = "marketing" | "sales" | "conversations"

// Browser-tab title per view. The app is a single route, so the title is set
// imperatively — `metadata` in layout.tsx can only give one static fallback.
const TAB_TITLES: Record<DashboardTab, string> = {
  marketing: "Marketing - Lezgo Suite CRM",
  sales: "Ventas - Lezgo Suite CRM",
  conversations: "Asistente IA - Lezgo Suite CRM",
}

export default function DashboardPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DashboardTab>("marketing")

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => { document.title = TAB_TITLES[activeTab] }, [activeTab])

  const { data, isLoading, showLoading, isError, progress, locationName, syncedAt, steps, refresh } = useDashboardData({})
  const { messages } = useConversationsData()

  const [dateFilter, setDateFilter] = useState<DateFilter>({ preset: "all" })
  const dateRange = useMemo(() => resolveDateRange(dateFilter), [dateFilter])

  // The panel's second global filter. Empty = todos, which is a strict
  // passthrough — see lib/pipeline-filter.ts.
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>([])

  const allPipelines = useMemo(() => data?.pipelines ?? [], [data?.pipelines])

  // Derived from the UNFILTERED opportunities, deliberately: pipeline membership
  // is a fact about a contact, not about the active date window. Deriving it from
  // the date-filtered slice would drop every contact whose only opportunity in
  // this pipeline predates the window — along with their pautas, citas and
  // mensajes — and understate exactly the accounts with the longest history.
  const pipelineContactIds = useMemo(
    () => contactIdsInPipelines(data?.opportunities ?? [], pipelineFilter),
    [data?.opportunities, pipelineFilter]
  )

  // Only the selected pipelines reach the dashboards, which is what makes their
  // stage axis the real pipeline in GHL's order instead of every stage name in
  // the account merged into one list.
  const visiblePipelines = useMemo(
    () => selectedPipelines(allPipelines, pipelineFilter),
    [allPipelines, pipelineFilter]
  )

  const pipelineLabel = useMemo(
    () => pipelineFilterLabel(allPipelines, pipelineFilter),
    [allPipelines, pipelineFilter]
  )

  // Opportunities per pipeline over the whole history, for the picker. Answers
  // "does this pipeline hold anything at all" — several sub-accounts carry
  // pipelines that have never held one.
  const pipelineCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of data?.opportunities ?? []) {
      counts.set(o.pipelineId, (counts.get(o.pipelineId) ?? 0) + 1)
    }
    return counts
  }, [data?.opportunities])

  // Accounts past LARGE_DATASET_THRESHOLD open on the last month instead of the
  // whole history. What this avoids is NOT the fetch — the cache answers that in
  // about a second — it is the browser rendering every chart over tens of
  // thousands of records, which pins the main thread and bogs down the whole
  // machine.
  //
  // Applied ONCE, when the data first lands, and never again: after that the
  // filter belongs to the user, and choosing "Todo" has to stick even though the
  // account is still big. The ref (not a piece of state) is what guarantees the
  // effect can never fight the user on a later render or a refresh().
  const autoScopedRef = useRef(false)
  const [autoScoped, setAutoScoped] = useState(false)
  useEffect(() => {
    if (autoScopedRef.current || !data) return
    autoScopedRef.current = true
    if (
      isLargeDataset({
        contacts: data.contacts.length,
        opportunities: data.opportunities.length,
      })
    ) {
      setDateFilter({ preset: "month" })
      setAutoScoped(true)
    }
  }, [data])

  // Human label of the active date filter, for the PDF report cover.
  const periodLabel = useMemo(() => {
    switch (dateFilter.preset) {
      case "week": return "Últimos 7 días"
      case "month": return "Últimos 30 días"
      case "3m": return "Últimos 3 meses"
      case "6m": return "Últimos 6 meses"
      case "custom":
        if (!dateRange) return "Todo el historial"
        return `${format(dateRange.from, "d MMM yyyy", { locale: es })} – ${format(dateRange.to, "d MMM yyyy", { locale: es })}`
      default: return "Todo el historial"
    }
  }, [dateFilter.preset, dateRange])

  // Every dataset carries BOTH global filters. The pipeline lives only on the
  // opportunity, so opportunities filter on it directly and everything else
  // follows its contact into (or out of) the selected pipelines.
  const contacts = useMemo(
    () =>
      filterByContactIds(
        filterByDateRange(data?.contacts ?? [], (c) => c.createdAt, dateRange),
        (c) => c.id,
        pipelineContactIds
      ),
    [data?.contacts, dateRange, pipelineContactIds]
  )
  const opportunities = useMemo(
    () =>
      filterOpportunitiesByPipelines(
        filterByDateRange(data?.opportunities ?? [], (o) => o.createdAt, dateRange),
        pipelineFilter
      ),
    [data?.opportunities, dateRange, pipelineFilter]
  )
  const calls = useMemo(
    () =>
      filterByContactIds(
        filterByDateRange(data?.calls ?? [], (c) => c.createdAt, dateRange),
        (c) => c.contactId,
        pipelineContactIds
      ),
    [data?.calls, dateRange, pipelineContactIds]
  )
  const appointments = useMemo(
    () =>
      filterByContactIds(
        filterByDateRange(data?.appointments ?? [], (a) => a.startTime, dateRange),
        (a) => a.contactId,
        pipelineContactIds
      ),
    [data?.appointments, dateRange, pipelineContactIds]
  )
  const tasks = useMemo(
    () =>
      filterByContactIds(
        filterByDateRange(data?.tasks ?? [], (t) => t.createdAt ?? t.dueDate, dateRange),
        (t) => t.contactId,
        pipelineContactIds
      ),
    [data?.tasks, dateRange, pipelineContactIds]
  )
  // Date-filtered but NOT pipeline-filtered. The Meta blocks divide spend by this
  // set, and Meta reports spend per ad account with no pipeline dimension — see
  // PipelineScopeNotice.
  const pautasAllPipelines = useMemo(
    () => filterByDateRange(data?.pautas ?? [], (p) => p.createdAt, dateRange),
    [data?.pautas, dateRange]
  )
  const pautas = useMemo(
    () => filterByContactIds(pautasAllPipelines, (p) => p.contactId, pipelineContactIds),
    [pautasAllPipelines, pipelineContactIds]
  )
  const opportunitiesAllPipelines = useMemo(
    () => filterByDateRange(data?.opportunities ?? [], (o) => o.createdAt, dateRange),
    [data?.opportunities, dateRange]
  )
  // Memoized as one object: it feeds a useMemo inside the dashboard, and a fresh
  // literal each render would re-filter ten thousand opportunities every time.
  const unscopedByPipeline = useMemo(
    () => ({
      opportunities: opportunitiesAllPipelines,
      pautas: pautasAllPipelines,
      allPautas: data?.pautas ?? [],
    }),
    [opportunitiesAllPipelines, pautasAllPipelines, data?.pautas]
  )
  const filteredMessages = useMemo(
    () =>
      filterByContactIds(
        filterByDateRange(messages, (m) => m.createdAt, dateRange),
        (m) => m.contactId,
        pipelineContactIds
      ),
    [messages, dateRange, pipelineContactIds]
  )

  // The date-unfiltered lookup tables the drill-downs join against. They carry
  // the pipeline filter too — otherwise a drawer opened from a pipeline-scoped
  // chart would resolve rows from pipelines the panel is not showing.
  const allContacts = useMemo(
    () => filterByContactIds(data?.contacts ?? [], (c) => c.id, pipelineContactIds),
    [data?.contacts, pipelineContactIds]
  )
  const allOpportunities = useMemo(
    () => filterOpportunitiesByPipelines(data?.opportunities ?? [], pipelineFilter),
    [data?.opportunities, pipelineFilter]
  )
  const allPautas = useMemo(
    () => filterByContactIds(data?.pautas ?? [], (p) => p.contactId, pipelineContactIds),
    [data?.pautas, pipelineContactIds]
  )
  const allAppointments = useMemo(
    () => filterByContactIds(data?.appointments ?? [], (a) => a.contactId, pipelineContactIds),
    [data?.appointments, pipelineContactIds]
  )
  const availableMembers = data?.members ?? []
  const availableTags = data?.tags ?? []

  // showLoading, not isLoading: a cached read answers in one frame and the
  // loading screen would only flash. See LOADING_SCREEN_DELAY_MS in the hook.
  const isInitialLoad = showLoading && !data

  // Re-render on a timer so "actualizado hace X" keeps counting up instead of
  // freezing at whatever it said when the payload landed.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
    <AnimatePresence>
      {isInitialLoad && <LoadingScreen key="loader" progress={progress} locationName={locationName} steps={steps} />}
    </AnimatePresence>
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-[#335577]/20 bg-[#0D172F] px-4 py-3 text-white shadow-none sm:px-6 sm:py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo-mark.png"
              alt="Lezgo Suite"
              width={2851}
              height={3371}
              priority
              className="h-9 w-auto shrink-0"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">Lezgo Suite Analíticas</h1>
              <p className="text-[11px] font-medium tracking-wide text-white/55">Marketing y Ventas</p>
            </div>
            {locationName && (
              <>
                <span aria-hidden className="hidden h-6 w-px shrink-0 bg-white/15 sm:block" />
                <span className="hidden min-w-0 max-w-[220px] truncate text-[13px] font-medium text-white/80 sm:inline-block">
                  {locationName}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {isError && (
              <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                Error al cargar datos
              </div>
            )}
            {!isLoading && data && (
              <TooltipProvider delayDuration={200}>
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/15 bg-white/[0.07] px-2 py-1 text-[11px] font-medium tabular-nums text-white">
                        <Users className="h-3 w-3 text-white/45" />
                        {data.contacts.length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Contactos cargados</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/15 bg-white/[0.07] px-2 py-1 text-[11px] font-medium tabular-nums text-white">
                        <Target className="h-3 w-3 text-white/45" />
                        {data.opportunities.length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Oportunidades cargadas</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/15 bg-white/[0.07] px-2 py-1 text-[11px] font-medium tabular-nums text-white">
                        <ClipboardList className="h-3 w-3 text-white/45" />
                        {(data?.pautas ?? []).length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Pautas cargadas</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            )}
            <span className="hidden text-[11px] tabular-nums text-white/55 sm:inline">
              {isLoading
                ? (progress || "Sincronizando…")
                : (syncedAt ?? data?.meta?.fetchedAt)
                  ? `Actualizado ${formatDistanceToNow(new Date((syncedAt ?? data!.meta.fetchedAt)!), { addSuffix: true, locale: es })}`
                  : ""}
            </span>
            
           
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 rounded-lg text-xs font-medium"
              onClick={() => refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
            
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-white/80" />}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Cambiar tema"
            >
              {mounted && resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" })
                // A full page load, not a router push: this drops all client-side
                // dashboard state, so the next client to log in on this browser
                // can't see the previous client's data behind a cached React tree.
                window.location.href = "/login"
              }}
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <nav className="border-b border-border bg-card px-4 sm:px-6" aria-label="Vistas del panel">
        <div className="flex gap-6 sm:gap-8">
          {(
            [
              { id: "marketing" as const, label: "Marketing", icon: TrendingUp },
              { id: "sales" as const, label: "Ventas", icon: BarChart3 },
              { id: "conversations" as const, label: "Asistente IA", icon: Sparkles },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  "relative flex items-center gap-2 py-3 text-sm font-medium transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {activeTab !== "conversations" && (
        <FilterBar
          // Showing a slice of the data without saying so would mislead by
          // omission — the same reason the header shows the cache's age.
          hint={
            autoScoped && dateFilter.preset === "month"
              ? "Cuenta grande: se abre en el último mes para que las gráficas no traben el navegador. Elige Todo para ver el historial completo."
              : undefined
          }
        >
          <DateRangeFilter
            value={dateFilter}
            onChange={(next) => {
              setAutoScoped(false)
              setDateFilter(next)
            }}
          />
          <FilterDivider />
          <PipelineFilterControl
            pipelines={allPipelines}
            value={pipelineFilter}
            onChange={setPipelineFilter}
            counts={pipelineCounts}
          />
        </FilterBar>
      )}

      {/* Dashboard Content */}
      <div className="flex-1 pt-2 pb-6">
        {activeTab === "marketing" && (
          <MarketingDashboard
            opportunities={opportunities}
            allOpportunities={allOpportunities}
            contacts={contacts}
            allContacts={allContacts}
            pautas={pautas}
            allPautas={allPautas}
            pipelines={visiblePipelines}
            tasks={tasks}
            calls={calls}
            appointments={appointments}
            allAppointments={allAppointments}
            locationId={data?.locationId ?? ""}
            locationName={locationName ?? undefined}
            periodLabel={periodLabel}
            pipelineLabel={pipelineLabel}
            pipelineScoped={pipelineFilter.length > 0}
            unscopedByPipeline={unscopedByPipeline}
            ads={data?.ads}
            dateRange={dateRange}
          />
        )}
        {activeTab === "sales" && (
          <SalesDashboard
            opportunities={opportunities}
            allOpportunities={allOpportunities}
            contacts={contacts}
            allContacts={allContacts}
            calls={calls}
            messages={filteredMessages}
            allMessages={messages}
            appointments={appointments}
            allAppointments={allAppointments}
            pipelines={visiblePipelines}
            tasks={tasks}
            pautas={pautas}
            members={availableMembers}
            locationId={data?.locationId ?? ""}
            locationName={locationName ?? undefined}
            periodLabel={periodLabel}
            // Undefined when the filter is off: the PDF only names a pipeline
            // when one is actually narrowing the report.
            pipelineLabel={pipelineFilter.length > 0 ? pipelineLabel : undefined}
          />
        )}
        {/* Kept permanently mounted (hidden when inactive) so the AI chat
            history survives switching to the Marketing/Ventas tabs. */}
        {/* The AI assistant always sees the full (unfiltered) dataset — the
            date filter bar is hidden on this tab. */}
        <div className={cn(activeTab !== "conversations" && "hidden")}>
          <ConversationsChat
            dataset={{
              contacts: data?.contacts ?? [],
              opportunities: data?.opportunities ?? [],
              pautas: data?.pautas ?? [],
              appointments: data?.appointments ?? [],
              messages,
              tasks: data?.tasks ?? [],
              calls: data?.calls ?? [],
            }}
            locationId={data?.locationId}
          />
        </div>
      </div>
    </div>
    </>
  )
}
