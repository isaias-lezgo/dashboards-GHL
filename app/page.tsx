"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
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
import { PanelTabs, EMPTY_TAB_ID } from "@/components/widgets/panel-tabs"
import { WidgetGrid } from "@/components/widgets/widget-grid"
import { panelSettled, useDashboardDoc, type CommitResult } from "@/hooks/use-dashboard-doc"
import { deleteTab, deleteWidgets, findWidget, randomId, updateWidget, upsertTab } from "@/lib/widgets/doc-ops"
import { usePanelFilters } from "@/hooks/use-panel-filters"
import { useConversationIndex } from "@/hooks/use-conversation-index"
import { conversationDaysNeeded } from "@/lib/widgets/engine"
import { PanelFilterBar } from "@/components/widgets/panel-filter-bar"
import { WidgetFilterEditor } from "@/components/widgets/widget-filter-editor"
import { EmptyPanel } from "@/components/widgets/empty-panel"
import { CopilotDock } from "@/components/widgets/copilot-dock"
import { useRecentlyAddedWidgets } from "@/components/widgets/widget-entrance"
import { buildSuggestions } from "@/lib/widgets/suggestions"
import { activeGlobalFilters } from "@/lib/widgets/filter-state"
import { buildCatalog, validateWidget } from "@/lib/widgets/validate"
import { widgetSpecObject, widgetSpecSchema, type WidgetSpec } from "@/lib/widgets/spec"
import type { EngineContext } from "@/lib/widgets/semantic"
import { toast } from "sonner"
import { LoadingScreen } from "@/components/dashboard/loading-screen"
import { useDashboardData } from "@/hooks/use-dashboard-data"
import { useConversationsData } from "@/hooks/use-conversations-data"
import {
  TrendingUp,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
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

// "marketing" | "sales" | "conversations", or — with the AI panel on — the id of
// one of the client's own tabs, or EMPTY_TAB_ID when the panel has none yet.
type DashboardTab = string

const FIXED_TABS = new Set(["marketing", "sales", "conversations"])

// Long enough to actually reach the button: sonner's default 4 s is not.
const UNDO_TOAST_MS = 10_000

// Browser-tab title per view. The app is a single route, so the title is set
// imperatively — `metadata` in layout.tsx can only give one static fallback.
const TAB_TITLES: Record<string, string> = {
  marketing: "Marketing - Lezgo Suite CRM",
  sales: "Ventas - Lezgo Suite CRM",
  conversations: "Asistente IA - Lezgo Suite CRM",
}

export default function DashboardPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DashboardTab>("marketing")

  useEffect(() => { setMounted(true) }, [])

  // The AI-managed panel. `enabled` is null until the server answers, then the
  // client's dashboard_installation.ai_panel flag; when it is not true the page
  // below is exactly today's Marketing / Ventas / Asistente IA.
  const docApi = useDashboardDoc()
  const panelEnabled = docApi.enabled === true
  const docTabs = useMemo(() => docApi.doc?.tabs ?? [], [docApi.doc])
  // Widgets just added to the panel (copilot, undo, another session) play an
  // entrance when they first mount — tracked over the whole doc, since the
  // copilot builds into a new tab and switches to it after the save.
  const recentWidgets = useRecentlyAddedWidgets(docApi.doc)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  // The copilot: open/closed, and the text the empty panel hands it.
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [copilotPrompt, setCopilotPrompt] = useState<string | null>(null)
  const askCopilot = useCallback((text: string) => {
    setCopilotPrompt(text)
    setCopilotOpen(true)
  }, [])
  const clearCopilotPrompt = useCallback(() => setCopilotPrompt(null), [])

  // Land on the panel once, when it first loads: its first tab, or the empty
  // panel. After that the tab belongs to the user.
  const landedRef = useRef(false)
  useEffect(() => {
    if (landedRef.current || !panelEnabled || !docApi.doc) return
    landedRef.current = true
    setActiveTab(docApi.doc.tabs[0]?.id ?? EMPTY_TAB_ID)
  }, [panelEnabled, docApi.doc])

  // A tab deleted elsewhere (another session, an undo) must not leave the page
  // pointing at nothing.
  useEffect(() => {
    if (!panelEnabled || FIXED_TABS.has(activeTab)) return
    if (activeTab === EMPTY_TAB_ID) {
      if (docTabs.length > 0) setActiveTab(docTabs[0].id)
      return
    }
    if (!docTabs.some((t) => t.id === activeTab)) setActiveTab(docTabs[0]?.id ?? EMPTY_TAB_ID)
  }, [panelEnabled, docTabs, activeTab])

  useEffect(() => {
    const own = docTabs.find((t) => t.id === activeTab)
    document.title = own ? `${own.title} - Lezgo Suite CRM` : (TAB_TITLES[activeTab] ?? TAB_TITLES.marketing)
  }, [activeTab, docTabs])

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
    // Wait until we know whether the AI panel is on: a panel with a saved
    // default date owns the initial date filter, and the auto-scope must not
    // overwrite it. A failed panel read counts as an answer (panelSettled).
    if (autoScopedRef.current || !data || !panelSettled(docApi)) return
    if (docApi.enabled && docApi.doc?.filters.defaultDate != null) {
      autoScopedRef.current = true
      return
    }
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
  }, [data, docApi.enabled, docApi.error, docApi.doc])

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

  // The engine reads the FULL dataset (joins and cross-object filters resolve
  // against everything) and applies the panel's filters itself. `now` moves once
  // a minute so relative ranges ("últimos 30 días") stay current.
  const nowMinute = Math.floor(Date.now() / 60_000)
  const panelNow = useMemo(() => new Date(nowMinute * 60_000), [nowMinute])
  const setDateFromPanel = useCallback((next: DateFilter) => {
    setAutoScoped(false)
    setDateFilter(next)
  }, [])
  const panelFilters = usePanelFilters({
    docApi,
    now: panelNow,
    date: dateFilter,
    setDate: setDateFromPanel,
    pipelines: pipelineFilter,
    setPipelines: setPipelineFilter,
  })
  const conversationIndex = useConversationIndex()
  const globalFilters = useMemo(
    () => (panelEnabled && docApi.doc ? activeGlobalFilters(panelFilters.state, docApi.doc.filters) : []),
    [panelEnabled, docApi.doc, panelFilters.state]
  )
  const engineCtx: EngineContext = useMemo(
    () => ({
      dataset: {
        contacts: data?.contacts ?? [],
        opportunities: data?.opportunities ?? [],
        pautas: data?.pautas ?? [],
        appointments: data?.appointments ?? [],
        messages,
        tasks: data?.tasks ?? [],
        calls: data?.calls ?? [],
      },
      pipelines: allPipelines,
      ads: data?.ads,
      dateRange,
      pipelineFilter,
      globalFilters,
      now: panelNow,
      customFieldTypes: data?.customFieldTypes ?? null,
      // The stable view: progress frames must not recompute every card.
      conversations: conversationIndex.engineState,
    }),
    [data, messages, allPipelines, dateRange, pipelineFilter, globalFilters, panelNow, conversationIndex.engineState]
  )

  // Computed over the whole account, not the filtered slice: a suggestion is a
  // promise about what the data can answer, whatever the date picker says.
  const suggestions = useMemo(
    () => (data ? buildSuggestions({ ...engineCtx, dateRange: null, pipelineFilter: [], globalFilters: [] }) : []),
    [data, engineCtx]
  )

  // "Filtros y fechas" of one widget: same validation as the AI's edits.
  const [filterEditorId, setFilterEditorId] = useState<string | null>(null)
  const filterEditorWidget = docApi.doc && filterEditorId ? findWidget(docApi.doc, filterEditorId)?.widget ?? null : null
  const saveWidgetFilters = async (spec: WidgetSpec) => {
    const clean = Object.fromEntries(Object.keys(widgetSpecObject.shape).map((k) => [k, spec[k as keyof WidgetSpec]])) as unknown as WidgetSpec
    const shape = widgetSpecSchema.safeParse(clean)
    const issues = shape.success ? validateWidget(clean, buildCatalog(engineCtx)) : [{ message: shape.error.issues[0]?.message ?? "Filtro inválido" }]
    if (issues.length) {
      toast.error(issues[0].message)
      return
    }
    const id = filterEditorId!
    setFilterEditorId(null)
    const res = await docApi.commit(
      (d) => updateWidget(d, id, clean, { now: new Date().toISOString(), by: "user", id: randomId }),
      `Cambió los filtros de «${clean.title}»`,
      "user"
    )
    if (res.ok) toast(`Filtros de «${clean.title}» guardados`, { duration: UNDO_TOAST_MS, action: { label: "Deshacer", onClick: () => void undoChange() } })
    else reportFailure(res)
  }

  const reportFailure = (res: CommitResult) => {
    if (!res.ok) toast.error(res.message)
  }
  const undoChange = async () => reportFailure(await docApi.undo())

  const removeWidget = async (id: string) => {
    if (!docApi.doc) return
    const title = findWidget(docApi.doc, id)?.widget.title ?? "la gráfica"
    const res = await docApi.commit((d) => deleteWidgets(d, [id]), `Eliminó «${title}»`, "user")
    if (res.ok) toast(`Se eliminó «${title}»`, { duration: UNDO_TOAST_MS, action: { label: "Deshacer", onClick: () => void undoChange() } })
    else reportFailure(res)
  }
  const addTab = async () => {
    let tabId = ""
    const res = await docApi.commit(
      (d) => {
        const out = upsertTab(d, { tabId: null, title: "Nueva pestaña", position: null }, randomId)
        tabId = out.tabId
        return out.doc
      },
      "Creó una pestaña",
      "user"
    )
    if (res.ok) setActiveTab(tabId)
    else reportFailure(res)
  }
  const renameTab = async (id: string, title: string) =>
    reportFailure(await docApi.commit((d) => upsertTab(d, { tabId: id, title, position: d.tabs.findIndex((t) => t.id === id) }, randomId).doc, `Renombró una pestaña a «${title}»`, "user"))
  const removeTab = async (id: string) => {
    const title = docTabs.find((t) => t.id === id)?.title ?? "la pestaña"
    const res = await docApi.commit((d) => deleteTab(d, id), `Eliminó la pestaña «${title}»`, "user")
    if (res.ok) toast(`Se eliminó la pestaña «${title}»`, { duration: UNDO_TOAST_MS, action: { label: "Deshacer", onClick: () => void undoChange() } })
    else reportFailure(res)
  }
  const activeDocTab = docTabs.find((t) => t.id === activeTab) ?? null

  // Conversations load only when a card on screen reads them, for the widest
  // window any of those cards asked for (60 days unless one asked for more).
  const conversationDays = useMemo(() => {
    let max = 0
    for (const w of activeDocTab?.widgets ?? []) {
      const d = w.query ? conversationDaysNeeded(w.query) : null
      if (d !== null && d > max) max = d
    }
    return max
  }, [activeDocTab])
  const ensureConversations = conversationIndex.ensure
  // "Actualizar" brings fresh CRM data: the conversations read before it would be
  // stale with no sign of it, so they are forgotten and load again.
  const resetConversations = conversationIndex.reset
  const conversationsData = useRef(data)
  useEffect(() => {
    if (conversationsData.current && data && conversationsData.current !== data) resetConversations()
    conversationsData.current = data
  }, [data, resetConversations])
  useEffect(() => {
    if (panelEnabled && data && conversationDays > 0) void ensureConversations(conversationDays)
  }, [panelEnabled, data, conversationDays, ensureConversations])
  // Only on the client's own tabs (or the empty panel): Marketing, Ventas and
  // the Asistente IA tab are not the copilot's to edit. Hidden, never unmounted.
  const copilotVisible = panelEnabled && copilotOpen && !FIXED_TABS.has(activeTab)

  // An empty tab of the client's own has only one thing to do — ask the
  // copilot — so it opens by itself: on arriving at one (a new tab, a switch,
  // the first landing) and when the last widget goes. It fires on those
  // transitions only, never on `copilotOpen`, so closing it sticks until the
  // user leaves and comes back. Waits for the data, since the dock does too.
  // Not on EMPTY_TAB_ID: EmptyPanel already has its own question box.
  const activeTabEmpty = panelEnabled && !!data && activeDocTab !== null && activeDocTab.widgets.length === 0
  useEffect(() => {
    if (activeTabEmpty) setCopilotOpen(true)
  }, [activeTab, activeTabEmpty])

  const selectedWidget =docApi.doc && selectedWidgetId ? findWidget(docApi.doc, selectedWidgetId)?.widget ?? null : null

  const syncedAtIso = syncedAt ?? data?.meta?.fetchedAt
  const syncLabel = isLoading
    ? (progress || "Sincronizando…")
    : syncedAtIso
      ? `Actualizado ${formatDistanceToNow(new Date(syncedAtIso), { addSuffix: true, locale: es })}`
      : ""

  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark")

  // Embedded only (GHL's iframe hides the header): the header's controls that
  // still matter there. Rendered by both tab rows — PanelTabs and the classic
  // nav. The cache's age stays visible for the same reason it is in the header,
  // and the assistant points users at "Actualizar". No logout: GHL's SSO owns
  // this session, and /login inside the frame is a dead end.
  const embedControls = (
    <div className="hidden shrink-0 items-center gap-1.5 embed:flex sm:gap-2">
      {isError && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Error al cargar datos</span>
        </div>
      )}
      <span className="hidden text-[11px] tabular-nums text-muted-foreground md:inline">
        {syncLabel}
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
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
        onClick={toggleTheme}
        aria-label="Cambiar tema"
      >
        {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  )

  return (
    <>
    <AnimatePresence>
      {isInitialLoad && <LoadingScreen key="loader" progress={progress} locationName={locationName} steps={steps} />}
    </AnimatePresence>
    <div className={cn("flex min-h-screen flex-col bg-background", copilotVisible && "lg:pr-[380px]")}>
      {/* Header — hidden inside GHL's iframe (`embed:`), where the CRM already
          frames the page and names the sub-account. Its controls that still
          matter there are repeated in the tab row below; keep the two in sync. */}
      <header className="border-b border-[#335577]/20 bg-[#0D172F] px-4 py-3 text-white shadow-none embed:hidden sm:px-6 sm:py-3.5">
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
              {syncLabel}
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
              onClick={toggleTheme}
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

      {panelEnabled ? (
        <PanelTabs
          tabs={docTabs}
          activeId={activeTab}
          onSelect={setActiveTab}
          onRename={renameTab}
          onDelete={removeTab}
          onAdd={addTab}
          trailing={
            <div className="flex items-center gap-2">
              {!FIXED_TABS.has(activeTab) && !copilotOpen && (
                <button
                  type="button"
                  onClick={() => setCopilotOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Copiloto
                </button>
              )}
              {embedControls}
            </div>
          }
        />
      ) : (
      <nav
        className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6"
        aria-label="Vistas del panel"
      >
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

        {embedControls}
      </nav>
      )}

      {/* The panel read failed (after its retry): say so instead of silently
          showing the classic tabs to a client whose own panel is missing. */}
      {docApi.enabled === null && docApi.error !== null && !docApi.loading && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          No se pudo cargar la configuración del panel.
          <button type="button" onClick={() => void docApi.reload()} className="font-medium text-foreground underline-offset-2 hover:underline">
            Reintentar
          </button>
        </div>
      )}

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
          {/* The added controls apply to the panel's own tabs; Marketing and
              Ventas keep receiving only date and pipeline, as today. */}
          {panelEnabled && docApi.doc && !FIXED_TABS.has(activeTab) && (
            <>
              <FilterDivider />
              <PanelFilterBar ctx={engineCtx} filters={docApi.doc.filters} glossary={docApi.doc.glossary} api={panelFilters} now={panelNow} onUndo={() => void undoChange()} />
            </>
          )}
        </FilterBar>
      )}

      {/* Dashboard Content */}
      <div className="flex-1 pt-2 pb-6">
        {/* Until the dataset lands, a widget would compute over empty arrays and
            show 0 — a number the data never said. */}
        {panelEnabled && activeDocTab && !data && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Cargando datos…</p>
        )}
        {panelEnabled && activeDocTab && data && (
          <WidgetGrid
            tab={activeDocTab}
            ctx={engineCtx}
            selectedWidgetId={selectedWidgetId}
            onSelect={setSelectedWidgetId}
            onEditWithAi={(id) => {
              setSelectedWidgetId(id)
              setCopilotOpen(true)
            }}
            onEditFilters={(id) => setFilterEditorId(id)}
            onDelete={removeWidget}
            onRetryConversations={conversationIndex.retry}
            conversationProgress={conversationIndex.state.status === "loading" ? conversationIndex.state : null}
            isFresh={recentWidgets.isFresh}
            onEntrancePlayed={recentWidgets.forget}
          />
        )}
        <WidgetFilterEditor widget={filterEditorWidget} ctx={engineCtx} onClose={() => setFilterEditorId(null)} onSave={saveWidgetFilters} />
        {panelEnabled && activeTab === EMPTY_TAB_ID && (
          <EmptyPanel suggestions={suggestions} onSubmit={askCopilot} />
        )}
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
            syncedAt={syncedAt ?? data?.meta?.fetchedAt}
          />
        </div>
      </div>
    </div>
    {/* Mounted once the panel and the data exist, then never unmounted: the
        conversation survives closing it and switching tabs. */}
    {panelEnabled && docApi.doc && data && (
      <CopilotDock
        open={copilotVisible}
        onClose={() => setCopilotOpen(false)}
        engineCtx={engineCtx}
        docApi={docApi}
        activeTabId={activeDocTab?.id ?? null}
        setActiveTabId={setActiveTab}
        selectedWidget={selectedWidget}
        clearSelection={() => setSelectedWidgetId(null)}
        filters={panelFilters}
        locationId={data.locationId}
        syncedAt={syncedAt ?? data.meta?.fetchedAt}
        initialPrompt={copilotPrompt}
        onPromptConsumed={clearCopilotPrompt}
        ensureConversations={ensureConversations}
      />
    )}
    </>
  )
}
