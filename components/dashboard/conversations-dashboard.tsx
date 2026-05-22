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

// Sentinel used instead of empty string in shadcn Select to avoid quirks
const ALL = "_all_"

function buildFilterSummary(
  assignedTo: string,
  tag: string,
  pipeline: string,
  stage: string,
  loadedCount: number
): string {
  const parts: string[] = []
  if (assignedTo) parts.push(`Usuario: ${assignedTo}`)
  if (tag) parts.push(`Tag: ${tag}`)
  if (pipeline) parts.push(`Pipeline: ${pipeline}`)
  if (stage) parts.push(`Etapa: ${stage}`)
  parts.push(`${loadedCount} contacto${loadedCount !== 1 ? "s" : ""}`)
  return parts.join(" · ")
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

  // Filter selections (empty string = no filter applied)
  const [selectedUser, setSelectedUser] = useState("")
  const [selectedTag, setSelectedTag] = useState("")
  const [selectedPipeline, setSelectedPipeline] = useState("")
  const [selectedStage, setSelectedStage] = useState("")
  const [howMany, setHowMany] = useState(10)

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

  const pipelineStages = useMemo(
    () => pipelines.find((p) => p.name === selectedPipeline)?.stages ?? [],
    [pipelines, selectedPipeline]
  )

  // ANDs all active filters to produce a sorted list of matching contactIds
  function computeFilteredIds(): string[] {
    let filtered = [...contacts]
    if (selectedUser)
      filtered = filtered.filter((c) => c.assignedTo === selectedUser)
    if (selectedTag)
      filtered = filtered.filter((c) => c.tags.includes(selectedTag))
    if (selectedPipeline) {
      const matchingContactIds = new Set(
        opportunities
          .filter(
            (o) =>
              o.pipelineName === selectedPipeline &&
              (!selectedStage || o.stage === selectedStage)
          )
          .map((o) => o.contactId)
      )
      filtered = filtered.filter((c) => matchingContactIds.has(c.id))
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
    exportCSV(contacts, loadedThreads)
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
    const conversations = loadedContacts
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
        loadedContacts.length > conversations.length
          ? ` (de ${loadedContacts.length} cargadas)`
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
    setSelectedUser("")
    setSelectedTag("")
    setSelectedPipeline("")
    setSelectedStage("")
    setHowMany(10)
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
    () => loadedThreads.filter((t) => t.messages.length > 0).length,
    [loadedThreads]
  )
  const batchAnalyzeCount = Math.min(conversationsWithMessages, MAX_BATCH_ANALYSIS)

  // ─── Idle / Loading: filter form ────────────────────────────────────────────

  if (wizardState === "idle" || wizardState === "loading") {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-196px)] px-6">
        <Card className="w-full max-w-lg p-8">
          <h2 className="text-base font-semibold mb-6">
            Cargar conversaciones
          </h2>
          <div className="space-y-4">
            {/* Assigned user */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Usuario asignado
              </Label>
              <Select
                value={selectedUser || ALL}
                onValueChange={(v) => setSelectedUser(v === ALL ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los usuarios" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los usuarios</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tag */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tag</Label>
              <Select
                value={selectedTag || ALL}
                onValueChange={(v) => setSelectedTag(v === ALL ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los tags</SelectItem>
                  {availableTags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Pipeline */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Pipeline</Label>
              <Select
                value={selectedPipeline || ALL}
                onValueChange={(v) => {
                  setSelectedPipeline(v === ALL ? "" : v)
                  setSelectedStage("")
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los pipelines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los pipelines</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stage — disabled until a pipeline is selected */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Etapa</Label>
              <Select
                value={selectedStage || ALL}
                onValueChange={(v) => setSelectedStage(v === ALL ? "" : v)}
                disabled={!selectedPipeline}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      selectedPipeline
                        ? "Todas las etapas"
                        : "Selecciona un pipeline primero"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas las etapas</SelectItem>
                  {pipelineStages.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* How many */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Cuántos contactos
              </Label>
              <Select
                value={String(howMany)}
                onValueChange={(v) => setHowMany(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOW_MANY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full mt-2"
              onClick={handleLoad}
              disabled={wizardState === "loading"}
            >
              {wizardState === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cargando…
                </>
              ) : (
                "Cargar conversaciones"
              )}
            </Button>
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
              selectedUser,
              selectedTag,
              selectedPipeline,
              selectedStage,
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
                  : "Analizar la conversación seleccionada con Claude Haiku"
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
                  } con Claude Haiku (máx. ${MAX_BATCH_ANALYSIS})`
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
                ? `${analysisTitle} · Claude Haiku 4.5`
                : "Claude Haiku 4.5"}
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
          <div className="px-3 py-2.5 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contactos
            </p>
          </div>
          <ul className="overflow-y-auto flex-1">
            {loadedContacts.map((contact) => {
              const last = lastMessageMap[contact.id]
              const isSelected = contact.id === selectedContactId
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
                    <div className="flex flex-wrap gap-1 mt-1.5">
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
