"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MultiSelect } from "@/components/ui/multi-select"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Loader2,
  Mail,
  MessageSquare,
  MessagesSquare,
  Facebook,
  Instagram,
  Smartphone,
  Phone,
  Star,
  ClipboardList,
  Activity,
  Hash,
  Download,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ExternalLink,
  CalendarIcon,
  Clock,
  X,
  ArrowRight,
} from "lucide-react"
import type { Contact, Opportunity, Message, Pipeline } from "@/lib/types"

// ─── Channel display ─────────────────────────────────────────────────────────

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  sms: <Smartphone className="h-3 w-3" />,
  email: <Mail className="h-3 w-3" />,
  facebook: <Facebook className="h-3 w-3" />,
  instagram: <Instagram className="h-3 w-3" />,
  whatsapp: <MessageSquare className="h-3 w-3" />,
  google_chat: <MessageSquare className="h-3 w-3" />,
  call: <Phone className="h-3 w-3" />,
  webchat: <MessagesSquare className="h-3 w-3" />,
  live_chat: <MessagesSquare className="h-3 w-3" />,
  tiktok: <Hash className="h-3 w-3" />,
  review: <Star className="h-3 w-3" />,
  form_submission: <ClipboardList className="h-3 w-3" />,
  internal_comment: <MessageSquare className="h-3 w-3" />,
  other: <Hash className="h-3 w-3" />,
  system: <Activity className="h-3 w-3" />,
}

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_chat: "Google Chat",
  call: "Llamada",
  webchat: "Web Chat",
  live_chat: "Live Chat",
  tiktok: "TikTok",
  review: "Reseña",
  form_submission: "Formulario",
  internal_comment: "Nota interna",
  other: "Otro",
  system: "Sistema",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatPreviewTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
  })
}

function summarizeMulti(label: string, values: string[]): string | null {
  if (values.length === 0) return null
  if (values.length === 1) return `${label}: ${values[0]}`
  return `${label}: ${values.length}`
}

function buildFilterSummary(
  assignedTo: string[],
  tags: string[],
  pipelines: string[],
  stages: string[],
  createdFrom: Date | undefined,
  createdTo: Date | undefined,
  loadedCount: number
): string {
  const parts: string[] = []
  const u = summarizeMulti("Usuario", assignedTo)
  const t = summarizeMulti("Tag", tags)
  const p = summarizeMulti("Pipeline", pipelines)
  const s = summarizeMulti("Etapa", stages)
  if (u) parts.push(u)
  if (t) parts.push(t)
  if (p) parts.push(p)
  if (s) parts.push(s)
  if (createdFrom || createdTo) {
    const a = createdFrom
      ? format(createdFrom, "dd MMM", { locale: es })
      : "•"
    const b = createdTo ? format(createdTo, "dd MMM", { locale: es }) : "•"
    parts.push(`Creado: ${a} → ${b}`)
  }
  parts.push(`${loadedCount} contacto${loadedCount !== 1 ? "s" : ""}`)
  return parts.join(" · ")
}

function endOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

function formatUnrepliedDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hrs = minutes / 60
  if (hrs < 24) return `${hrs.toFixed(hrs < 10 ? 1 : 0)} h`
  return `${Math.floor(hrs / 24)} d`
}

function exportCSV(contacts: Contact[], threads: ThreadData[]) {
  const esc = (s: string) =>
    `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"`
  const header = [
    "Nombre",
    "Email",
    "Teléfono",
    "Tags",
    "Fecha",
    "Dirección",
    "Canal",
    "Mensaje",
  ]
  const rows: string[] = [header.join(",")]

  for (const thread of threads) {
    const contact = contacts.find((c) => c.id === thread.contactId)
    if (!contact) continue
    const base = [
      esc(contact.name),
      esc(contact.email),
      esc(contact.phone),
      esc(contact.tags.join(", ")),
    ]
    if (thread.messages.length === 0) {
      rows.push([...base, "", "", "", ""].join(","))
      continue
    }
    for (const msg of thread.messages) {
      rows.push(
        [
          ...base,
          esc(new Date(msg.createdAt).toLocaleString("es-MX")),
          msg.direction === "inbound" ? "Entrante" : "Saliente",
          CHANNEL_LABEL[msg.source] ?? msg.source,
          esc(msg.content ?? ""),
        ].join(",")
      )
    }
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `conversaciones-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardState = "idle" | "loading" | "loaded" | "exporting"

interface ThreadData {
  contactId: string
  messages: Message[]
}

export interface ConversationsDashboardProps {
  contacts: Contact[]
  opportunities: Opportunity[]
  pipelines: Pipeline[]
  members: string[]
  availableTags: string[]
}

const HOW_MANY_OPTIONS = [5, 10, 15, 50]
const LOAD_MORE_OPTIONS = [10, 25, 50]
const LOAD_MORE_MAX = 50
const MAX_BATCH_ANALYSIS = 20

// ─── Helpers: date picker button ──────────────────────────────────────────────

interface DateButtonProps {
  value: Date | undefined
  onChange: (d: Date | undefined) => void
  placeholder: string
  fromDate?: Date
  toDate?: Date
}

function DateButton({
  value,
  onChange,
  placeholder,
  fromDate,
  toDate,
}: DateButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`w-full justify-start font-normal ${
            value ? "" : "text-muted-foreground"
          }`}
        >
          <CalendarIcon className="mr-2 h-4 w-4 opacity-60" />
          <span className="flex-1 truncate text-left">
            {value ? format(value, "dd MMM yyyy", { locale: es }) : placeholder}
          </span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onChange(undefined)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange(undefined)
                }
              }}
              className="rounded-sm opacity-60 hover:opacity-100 hover:bg-muted p-0.5 ml-1"
              aria-label="Limpiar fecha"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d ?? undefined)
            setOpen(false)
          }}
          fromDate={fromDate}
          toDate={toDate}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsDashboard({
  contacts,
  opportunities,
  pipelines,
  members,
  availableTags,
}: ConversationsDashboardProps) {
  // Wizard state
  const [wizardState, setWizardState] = useState<WizardState>("idle")
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreDialogOpen, setLoadMoreDialogOpen] = useState(false)
  const [loadMoreCount, setLoadMoreCount] = useState(25)

  // Filter selections (empty array = no filter applied)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [createdFrom, setCreatedFrom] = useState<Date | undefined>(undefined)
  const [createdTo, setCreatedTo] = useState<Date | undefined>(undefined)
  const [howMany, setHowMany] = useState(10)

  // Post-load filters (applied to already-loaded threads)
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [unrepliedValue, setUnrepliedValue] = useState<string>("")
  const [unrepliedUnit, setUnrepliedUnit] = useState<"min" | "hr">("hr")

  // Loaded data
  const [loadedThreads, setLoadedThreads] = useState<ThreadData[]>([])
  const [filteredContactIds, setFilteredContactIds] = useState<string[]>([])
  const [loadedCount, setLoadedCount] = useState(0)
  const [selectedContactId, setSelectedContactId] = useState("")
  const [locationId, setLocationId] = useState("")

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selectedContactId])

  // AI analysis state
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisText, setAnalysisText] = useState("")
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisTitle, setAnalysisTitle] = useState("")
  const [analysisMode, setAnalysisMode] = useState<"single" | "batch">("single")

  // Union of stages across all selected pipelines (de-duped, original order)
  const pipelineStages = useMemo(() => {
    if (selectedPipelines.length === 0) return []
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of pipelines) {
      if (!selectedPipelines.includes(p.name)) continue
      for (const stage of p.stages) {
        if (!seen.has(stage)) {
          seen.add(stage)
          result.push(stage)
        }
      }
    }
    return result
  }, [pipelines, selectedPipelines])

  // Drop any selected stages that no longer exist after pipeline change
  useEffect(() => {
    if (selectedStages.length === 0) return
    const valid = new Set(pipelineStages)
    const pruned = selectedStages.filter((s) => valid.has(s))
    if (pruned.length !== selectedStages.length) setSelectedStages(pruned)
  }, [pipelineStages, selectedStages])

  // ANDs across fields, ORs within each field, to produce matching contactIds
  function computeFilteredIds(): string[] {
    let filtered = [...contacts]
    if (selectedUsers.length > 0)
      filtered = filtered.filter(
        (c) => !!c.assignedTo && selectedUsers.includes(c.assignedTo)
      )
    if (selectedTags.length > 0)
      filtered = filtered.filter((c) =>
        c.tags.some((t) => selectedTags.includes(t))
      )
    if (selectedPipelines.length > 0) {
      const matchingContactIds = new Set(
        opportunities
          .filter(
            (o) =>
              selectedPipelines.includes(o.pipelineName) &&
              (selectedStages.length === 0 ||
                selectedStages.includes(o.stage))
          )
          .map((o) => o.contactId)
      )
      filtered = filtered.filter((c) => matchingContactIds.has(c.id))
    }
    if (createdFrom) {
      const from = startOfDay(createdFrom)
      filtered = filtered.filter(
        (c) => new Date(c.createdAt).getTime() >= from
      )
    }
    if (createdTo) {
      const to = endOfDay(createdTo)
      filtered = filtered.filter(
        (c) => new Date(c.createdAt).getTime() <= to
      )
    }
    return filtered.map((c) => c.id)
  }

  async function fetchThreads(contactIds: string[], append: boolean) {
    if (contactIds.length === 0) return
    const resp = await fetch(
      `/api/conversations?contactIds=${encodeURIComponent(contactIds.join(","))}`
    )
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data: { threads: ThreadData[]; locationId?: string } = await resp.json()
    if (data.locationId) setLocationId(data.locationId)
    if (append) {
      setLoadedThreads((prev) => [...prev, ...data.threads])
    } else {
      setLoadedThreads(data.threads)
      setSelectedContactId(data.threads[0]?.contactId ?? "")
    }
  }

  async function handleLoad() {
    const ids = computeFilteredIds()
    setFilteredContactIds(ids)
    setLoadedCount(howMany)
    setSelectedChannels([])
    setUnrepliedValue("")
    setWizardState("loading")
    try {
      await fetchThreads(ids.slice(0, howMany), false)
    } finally {
      setWizardState("loaded")
    }
  }

  async function handleLoadMore(count: number) {
    const capped = Math.min(Math.max(1, count), LOAD_MORE_MAX)
    const batch = filteredContactIds.slice(loadedCount, loadedCount + capped)
    if (batch.length === 0) return
    setLoadedCount((prev) => prev + batch.length)
    setIsLoadingMore(true)
    try {
      await fetchThreads(batch, true)
    } finally {
      setIsLoadingMore(false)
    }
  }

  function handleExport() {
    setWizardState("exporting")
    const visibleIds = new Set(visibleContacts.map((c) => c.id))
    const visibleThreads = loadedThreads.filter((t) =>
      visibleIds.has(t.contactId)
    )
    exportCSV(contacts, visibleThreads)
    setWizardState("loaded")
  }

  function serializeMessages(messages: Message[]) {
    return messages.map((m) => ({
      direction: m.direction,
      source: CHANNEL_LABEL[m.source] ?? m.source,
      content: m.content,
      createdAt: m.createdAt,
    }))
  }

  async function runAnalysis(payload: object) {
    setAnalysisOpen(true)
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisText("")

    try {
      const resp = await fetch("/api/analyze-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${resp.status}`)
      }

      const data: { analysis: string } = await resp.json()
      setAnalysisText(data.analysis)
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "Error desconocido"
      )
    } finally {
      setAnalysisLoading(false)
    }
  }

  async function handleAnalyzeSelected() {
    if (!selectedContactId) return
    const contact = loadedContacts.find((c) => c.id === selectedContactId)
    const messages = threadMap[selectedContactId] ?? []
    if (!contact) return

    setAnalysisMode("single")
    setAnalysisTitle(`Conversación de ${contact.name}`)
    await runAnalysis({
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags,
      },
      messages: serializeMessages(messages),
    })
  }

  async function handleAnalyzeAll() {
    const conversations = visibleContacts
      .map((contact) => {
        const messages = threadMap[contact.id] ?? []
        if (messages.length === 0) return null
        return {
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            tags: contact.tags,
          },
          messages: serializeMessages(messages),
        }
      })
      .filter(Boolean)
      .slice(0, MAX_BATCH_ANALYSIS) as Array<{
        contact: { name: string; email?: string; phone?: string; tags?: string[] }
        messages: ReturnType<typeof serializeMessages>
      }>

    if (conversations.length === 0) return

    setAnalysisMode("batch")
    setAnalysisTitle(
      `Lote de ${conversations.length} conversaciones${
        visibleContacts.length > conversations.length
          ? ` (de ${visibleContacts.length} visibles)`
          : ""
      }`
    )
    await runAnalysis({ conversations })
  }

  async function handleAnalyze() {
    if (analysisMode === "batch") {
      await handleAnalyzeAll()
    } else {
      await handleAnalyzeSelected()
    }
  }

  function handleReset() {
    setWizardState("idle")
    setLoadedThreads([])
    setFilteredContactIds([])
    setLoadedCount(0)
    setSelectedContactId("")
    setSelectedUsers([])
    setSelectedTags([])
    setSelectedPipelines([])
    setSelectedStages([])
    setCreatedFrom(undefined)
    setCreatedTo(undefined)
    setHowMany(10)
    setSelectedChannels([])
    setUnrepliedValue("")
    setUnrepliedUnit("hr")
  }

  // Preserve original contact order from loadedThreads
  const loadedContacts = useMemo(
    () =>
      loadedThreads
        .map((t) => contacts.find((c) => c.id === t.contactId))
        .filter(Boolean) as Contact[],
    [contacts, loadedThreads]
  )

  const threadMap = useMemo(() => {
    const map: Record<string, Message[]> = {}
    for (const t of loadedThreads) map[t.contactId] = t.messages
    return map
  }, [loadedThreads])

  const lastMessageMap = useMemo(() => {
    const map: Record<string, Message> = {}
    for (const t of loadedThreads) {
      if (t.messages.length > 0)
        map[t.contactId] = t.messages[t.messages.length - 1]
    }
    return map
  }, [loadedThreads])

  // Last NON-activity message per contact — used for channel & "sin responder"
  const lastChatMap = useMemo(() => {
    const map: Record<string, Message> = {}
    for (const t of loadedThreads) {
      for (let i = t.messages.length - 1; i >= 0; i--) {
        const m = t.messages[i]
        if (m.kind !== "activity") {
          map[t.contactId] = m
          break
        }
      }
    }
    return map
  }, [loadedThreads])

  // Channels actually present in the loaded data — drives the Canal dropdown
  const availableChannels = useMemo(() => {
    const set = new Set<string>()
    for (const t of loadedThreads) {
      for (const m of t.messages) {
        if (m.kind === "activity") continue
        if (m.source && m.source !== "system") set.add(m.source)
      }
    }
    return Array.from(set).sort()
  }, [loadedThreads])

  // Parsed threshold in minutes (NaN/<=0 means filter is off)
  const unrepliedThresholdMin = useMemo(() => {
    const n = Number(unrepliedValue)
    if (!Number.isFinite(n) || n <= 0) return 0
    return n * (unrepliedUnit === "hr" ? 60 : 1)
  }, [unrepliedValue, unrepliedUnit])

  // Post-load filtered contacts (Canal + Sin responder)
  const visibleContacts = useMemo(() => {
    const now = Date.now()
    return loadedContacts.filter((c) => {
      const messages = threadMap[c.id] ?? []
      const chat = messages.filter((m) => m.kind !== "activity")

      if (selectedChannels.length > 0) {
        const has = chat.some((m) => selectedChannels.includes(m.source))
        if (!has) return false
      }

      if (unrepliedThresholdMin > 0) {
        const last = chat[chat.length - 1]
        if (!last || last.direction !== "inbound") return false
        const diffMin = (now - new Date(last.createdAt).getTime()) / 60000
        if (diffMin < unrepliedThresholdMin) return false
      }

      return true
    })
  }, [
    loadedContacts,
    threadMap,
    selectedChannels,
    unrepliedThresholdMin,
  ])

  // Keep selectedContactId valid when filters hide the current selection
  useEffect(() => {
    if (visibleContacts.length === 0) return
    if (!visibleContacts.some((c) => c.id === selectedContactId)) {
      setSelectedContactId(visibleContacts[0].id)
    }
  }, [visibleContacts, selectedContactId])

  const selectedContact = useMemo(
    () => loadedContacts.find((c) => c.id === selectedContactId),
    [loadedContacts, selectedContactId]
  )

  const selectedThread = useMemo(
    () => threadMap[selectedContactId] ?? [],
    [threadMap, selectedContactId]
  )

  const hasMore = loadedCount < filteredContactIds.length

  const conversationsWithMessages = useMemo(
    () =>
      visibleContacts.filter((c) => (threadMap[c.id]?.length ?? 0) > 0).length,
    [visibleContacts, threadMap]
  )
  const batchAnalyzeCount = Math.min(conversationsWithMessages, MAX_BATCH_ANALYSIS)

  const postLoadFilterCount =
    (selectedChannels.length > 0 ? 1 : 0) +
    (unrepliedThresholdMin > 0 ? 1 : 0)

  // ─── Idle / Loading: filter form ────────────────────────────────────────────

  if (wizardState === "idle" || wizardState === "loading") {
    const hasAnyFilter =
      selectedUsers.length > 0 ||
      selectedTags.length > 0 ||
      selectedPipelines.length > 0 ||
      selectedStages.length > 0 ||
      !!createdFrom ||
      !!createdTo

    function clearWizardFilters() {
      setSelectedUsers([])
      setSelectedTags([])
      setSelectedPipelines([])
      setSelectedStages([])
      setCreatedFrom(undefined)
      setCreatedTo(undefined)
    }

    return (
      <div className="px-6 py-10 flex items-start justify-center min-h-[calc(100vh-196px)]">
        <Card className="w-full max-w-3xl overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-7 pb-6">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Filtros de conversaciones
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Acota los contactos antes de cargar sus mensajes.
              <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-xs">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                <span className="tabular-nums font-medium text-foreground/80">
                  {contacts.length.toLocaleString("es-MX")}
                </span>
                <span>contactos disponibles</span>
              </span>
            </p>
          </div>

          {/* Sections */}
          <div className="px-8 pb-7 space-y-7">
            {/* Asignación */}
            <section>
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                Asignación
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Usuario asignado
                  </Label>
                  <MultiSelect
                    options={members}
                    value={selectedUsers}
                    onChange={setSelectedUsers}
                    placeholder="Todos los usuarios"
                    searchPlaceholder="Buscar usuario…"
                    formatLabel={(sel) =>
                      sel.length === 1 ? sel[0] : `${sel.length} usuarios`
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Tags</Label>
                  <MultiSelect
                    options={availableTags}
                    value={selectedTags}
                    onChange={setSelectedTags}
                    placeholder="Todos los tags"
                    searchPlaceholder="Buscar tag…"
                    formatLabel={(sel) =>
                      sel.length === 1 ? sel[0] : `${sel.length} tags`
                    }
                  />
                </div>
              </div>
            </section>

            {/* Pipeline */}
            <section>
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                Pipeline
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Pipelines
                  </Label>
                  <MultiSelect
                    options={pipelines.map((p) => p.name)}
                    value={selectedPipelines}
                    onChange={(next) => {
                      setSelectedPipelines(next)
                      if (next.length === 0) setSelectedStages([])
                    }}
                    placeholder="Todos los pipelines"
                    searchPlaceholder="Buscar pipeline…"
                    formatLabel={(sel) =>
                      sel.length === 1 ? sel[0] : `${sel.length} pipelines`
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    className={`text-xs text-muted-foreground ${
                      selectedPipelines.length === 0 ? "opacity-60" : ""
                    }`}
                  >
                    Etapas
                  </Label>
                  <MultiSelect
                    options={pipelineStages}
                    value={selectedStages}
                    onChange={setSelectedStages}
                    disabled={selectedPipelines.length === 0}
                    placeholder={
                      selectedPipelines.length === 0
                        ? "Selecciona un pipeline"
                        : "Todas las etapas"
                    }
                    searchPlaceholder="Buscar etapa…"
                    formatLabel={(sel) =>
                      sel.length === 1 ? sel[0] : `${sel.length} etapas`
                    }
                  />
                </div>
              </div>
            </section>

            {/* Periodo de creación */}
            <section>
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                Periodo de creación
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Desde</Label>
                  <DateButton
                    value={createdFrom}
                    onChange={setCreatedFrom}
                    placeholder="Cualquier fecha"
                    toDate={createdTo}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Hasta</Label>
                  <DateButton
                    value={createdTo}
                    onChange={setCreatedTo}
                    placeholder="Cualquier fecha"
                    fromDate={createdFrom}
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Footer: count + actions */}
          <div className="border-t border-border bg-muted/30 px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Cargar</span>
              <Select
                value={String(howMany)}
                onValueChange={(v) => setHowMany(Number(v))}
              >
                <SelectTrigger className="h-9 w-[72px] tabular-nums">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOW_MANY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)} className="tabular-nums">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>contactos</span>
            </div>

            <div className="flex items-center gap-2">
              {hasAnyFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-sm text-muted-foreground hover:text-foreground"
                  onClick={clearWizardFilters}
                  disabled={wizardState === "loading"}
                >
                  Limpiar filtros
                </Button>
              )}
              <Button
                onClick={handleLoad}
                disabled={wizardState === "loading"}
                className="h-9 gap-1.5 px-4"
              >
                {wizardState === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando…
                  </>
                ) : (
                  <>
                    Cargar
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // ─── Loaded / Exporting: two-panel view ─────────────────────────────────────

  return (
    <div className="px-6 py-3 flex flex-col gap-3 h-[calc(100vh-196px)]">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 flex-shrink-0"
            onClick={handleReset}
          >
            ← Cambiar filtros
          </Button>
          <span className="text-xs text-muted-foreground truncate">
            {buildFilterSummary(
              selectedUsers,
              selectedTags,
              selectedPipelines,
              selectedStages,
              createdFrom,
              createdTo,
              loadedContacts.length
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={isLoadingMore}
              onClick={() => setLoadMoreDialogOpen(true)}
            >
              {isLoadingMore ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Cargar más
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs gap-1.5 bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white border-0 shadow-sm"
            onClick={handleAnalyzeSelected}
            disabled={
              !selectedContactId ||
              analysisLoading ||
              (threadMap[selectedContactId]?.length ?? 0) === 0
            }
            title={
              !selectedContactId
                ? "Selecciona un contacto"
                : (threadMap[selectedContactId]?.length ?? 0) === 0
                  ? "El contacto seleccionado no tiene mensajes"
                  : "Analizar la conversación seleccionada con Claude Sonnet"
            }
          >
            {analysisLoading && analysisMode === "single" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Analizar esta conversación
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs gap-1.5 bg-gradient-to-r from-fuchsia-500 to-violet-500 hover:from-fuchsia-600 hover:to-violet-600 text-white border-0 shadow-sm"
            onClick={handleAnalyzeAll}
            disabled={analysisLoading || batchAnalyzeCount === 0}
            title={
              batchAnalyzeCount === 0
                ? "No hay conversaciones con mensajes para analizar"
                : `Analizar ${batchAnalyzeCount} conversación${
                    batchAnalyzeCount === 1 ? "" : "es"
                  } con Claude Sonnet (máx. ${MAX_BATCH_ANALYSIS})`
            }
          >
            {analysisLoading && analysisMode === "batch" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Analizar todas
            {batchAnalyzeCount > 0 && (
              <span className="opacity-80">({batchAnalyzeCount})</span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
            disabled={wizardState === "exporting"}
          >
            {wizardState === "exporting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Load more dialog */}
      <Dialog open={loadMoreDialogOpen} onOpenChange={setLoadMoreDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Cargar más conversaciones</DialogTitle>
            <DialogDescription className="text-xs">
              Quedan {filteredContactIds.length - loadedCount} contactos sin cargar
              · máximo {LOAD_MORE_MAX} por carga
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-muted-foreground">
              ¿Cuántos cargar?
            </Label>
            {(() => {
              const remaining = filteredContactIds.length - loadedCount
              const maxLoadable = Math.min(remaining, LOAD_MORE_MAX)
              const currentValue = String(Math.min(loadMoreCount, maxLoadable))
              const options = [
                ...LOAD_MORE_OPTIONS.filter((n) => n <= maxLoadable),
                ...(LOAD_MORE_OPTIONS.includes(maxLoadable)
                  ? []
                  : [maxLoadable]),
              ]
              return (
                <Select
                  value={currentValue}
                  onValueChange={(v) => setLoadMoreCount(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === remaining && n < LOAD_MORE_MAX
                          ? `${n} (todos los restantes)`
                          : n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            })()}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLoadMoreDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={isLoadingMore}
              onClick={async () => {
                const remaining = filteredContactIds.length - loadedCount
                const n = Math.min(
                  loadMoreCount,
                  Math.min(remaining, LOAD_MORE_MAX)
                )
                setLoadMoreDialogOpen(false)
                await handleLoadMore(n)
              }}
            >
              {isLoadingMore ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
              ) : null}
              Cargar{" "}
              {Math.min(
                loadMoreCount,
                Math.min(filteredContactIds.length - loadedCount, LOAD_MORE_MAX)
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Analysis Sheet */}
      <Sheet open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <SheetContent className="w-[560px] sm:max-w-[560px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {analysisMode === "batch"
                ? "Análisis agregado con IA"
                : "Análisis con IA"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {analysisTitle
                ? `${analysisTitle} · Claude Sonnet 4.6`
                : "Claude Sonnet 4.6"}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6">
            {analysisLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                <p className="text-sm text-muted-foreground">
                  Analizando la conversación…
                </p>
              </div>
            ) : analysisError ? (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">
                    Error al generar el análisis
                  </p>
                  <p className="text-xs text-red-700 mt-1">{analysisError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs mt-3"
                    onClick={handleAnalyze}
                  >
                    Reintentar
                  </Button>
                </div>
              </div>
            ) : (
              <article className="text-sm text-foreground leading-relaxed space-y-3">
                <ReactMarkdown
                  components={{
                    h2: ({ children }) => (
                      <h2 className="text-sm font-semibold text-foreground mt-5 mb-2 pb-1 border-b border-border first:mt-0">
                        {children}
                      </h2>
                    ),
                    p: ({ children }) => (
                      <p className="text-sm text-foreground leading-relaxed">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-sm text-foreground leading-relaxed">
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-foreground">
                        {children}
                      </strong>
                    ),
                  }}
                >
                  {analysisText}
                </ReactMarkdown>
              </article>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Two-panel layout */}
      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Contact list */}
        <Card className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contactos
              </p>
              <span className="text-[10px] text-muted-foreground">
                {postLoadFilterCount > 0
                  ? `${visibleContacts.length} de ${loadedContacts.length}`
                  : `${loadedContacts.length}`}
              </span>
            </div>
            <div className="flex gap-1.5">
              {/* Channel filter */}
              <MultiSelect
                options={availableChannels}
                value={selectedChannels.filter((c) =>
                  availableChannels.includes(c)
                )}
                onChange={setSelectedChannels}
                placeholder="Canal"
                searchPlaceholder="Buscar canal…"
                disabled={availableChannels.length === 0}
                className="h-7 text-xs px-2"
                renderLabel={(c) => CHANNEL_LABEL[c] ?? c}
                formatLabel={(sel) =>
                  sel.length === 1
                    ? (CHANNEL_LABEL[sel[0]] ?? sel[0])
                    : `${sel.length} canales`
                }
              />
              {/* Sin responder filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-7 text-xs px-2 flex-1 justify-start font-normal ${
                      unrepliedThresholdMin > 0
                        ? ""
                        : "text-muted-foreground"
                    }`}
                  >
                    <Clock className="h-3 w-3 mr-1.5 opacity-70" />
                    <span className="truncate">
                      {unrepliedThresholdMin > 0
                        ? `≥ ${unrepliedValue} ${unrepliedUnit === "hr" ? "h" : "min"}`
                        : "Sin responder"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Tiempo sin responder al cliente
                    </Label>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Mostrar conversaciones donde el cliente envió el último
                      mensaje y nadie ha respondido en al menos:
                    </p>
                    <div className="flex gap-1.5">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        placeholder="0"
                        value={unrepliedValue}
                        onChange={(e) => setUnrepliedValue(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Select
                        value={unrepliedUnit}
                        onValueChange={(v) =>
                          setUnrepliedUnit(v as "min" | "hr")
                        }
                      >
                        <SelectTrigger className="h-8 text-xs w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="min">Minutos</SelectItem>
                          <SelectItem value="hr">Horas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {unrepliedThresholdMin > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full h-7 text-xs"
                        onClick={() => setUnrepliedValue("")}
                      >
                        Quitar filtro
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <ul className="overflow-y-auto flex-1">
            {visibleContacts.length === 0 && loadedContacts.length > 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                Sin contactos que coincidan con los filtros
              </li>
            )}
            {visibleContacts.map((contact) => {
              const last = lastMessageMap[contact.id]
              const chatLast = lastChatMap[contact.id]
              const isSelected = contact.id === selectedContactId
              const unrepliedMin =
                chatLast && chatLast.direction === "inbound"
                  ? (Date.now() - new Date(chatLast.createdAt).getTime()) /
                    60000
                  : null
              return (
                <li
                  key={contact.id}
                  onClick={() => setSelectedContactId(contact.id)}
                  className={`flex items-start gap-3 px-3 py-3 cursor-pointer border-b last:border-0 transition-colors ${
                    isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {initials(contact.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-semibold truncate">
                        {contact.name}
                      </p>
                      {last && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatPreviewTime(last.createdAt)}
                        </span>
                      )}
                    </div>
                    {last && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-muted-foreground opacity-60">
                          {CHANNEL_ICON[last.source]}
                        </span>
                        <p className="text-xs text-muted-foreground truncate">
                          {last.content}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {unrepliedMin !== null && unrepliedMin >= 1 && (
                        <span className="inline-flex items-center gap-1 text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 leading-none border border-amber-200">
                          <Clock className="h-2.5 w-2.5" />
                          {formatUnrepliedDuration(unrepliedMin)}
                        </span>
                      )}
                      {contact.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground leading-none"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Thread panel */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          {selectedContact && (
            <div className="border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                {initials(selectedContact.name)}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{selectedContact.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {selectedContact.email} · {selectedContact.phone}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex flex-wrap gap-1 justify-end">
                  {selectedContact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {locationId && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 flex-shrink-0"
                  >
                    <a
                      href={`https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${selectedContact.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Ver en Lezgo Suite
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {selectedThread.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin mensajes para este contacto
              </div>
            ) : (
              selectedThread.map((msg) => {
                if (msg.kind === "activity") {
                  return (
                    <div
                      key={msg.id}
                      className="flex items-center gap-2 my-1"
                    >
                      <div className="flex-1 border-t border-dashed border-border" />
                      <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] text-muted-foreground">
                        <span className="opacity-70">
                          {CHANNEL_ICON[msg.source]}
                        </span>
                        <span>{msg.content}</span>
                        <span className="opacity-60">· {formatTime(msg.createdAt)}</span>
                      </div>
                      <div className="flex-1 border-t border-dashed border-border" />
                    </div>
                  )
                }
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.direction === "outbound" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[68%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        msg.direction === "outbound"
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-muted text-foreground rounded-tl-sm"
                      }`}
                    >
                      {msg.content}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 px-1">
                      <span className="text-muted-foreground opacity-50">
                        {CHANNEL_ICON[msg.source]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {CHANNEL_LABEL[msg.source]} · {formatTime(msg.createdAt)}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        </Card>
      </div>
    </div>
  )
}
