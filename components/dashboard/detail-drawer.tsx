"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { Opportunity, Contact, Task, Call, Appointment, Message } from "@/lib/types"
import {
  Phone,
  Clock,
  Mail,
  MessageSquare,
  Calendar,
  DollarSign,
  User,
  ExternalLink,
  Sparkles,
  Loader2,
  CalendarCheck,
  CalendarX,
  CalendarClock,
  ArrowDownLeft,
  ArrowUpRight,
  Smartphone,
  Facebook,
  Instagram,
  Globe,
} from "lucide-react"

interface DetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string | null
  opportunities: Opportunity[]
  contacts: Contact[]
  tasks: Task[]
  calls: Call[]
  appointments?: Appointment[]
  messages?: Message[]
  locationId?: string
}

const TAG_COLORS: Record<string, string> = {
  "Hot Lead": "bg-red-100 text-red-700 border-red-200",
  "Warm Lead": "bg-amber-100 text-amber-700 border-amber-200",
  "Cold Lead": "bg-gray-100 text-gray-600 border-gray-200",
  "Enterprise": "bg-blue-100 text-blue-700 border-blue-200",
  "Mid-Market": "bg-teal-100 text-teal-700 border-teal-200",
  "SMB": "bg-orange-100 text-orange-700 border-orange-200",
  "Decision Maker": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "Referral": "bg-emerald-100 text-emerald-700 border-emerald-200",
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  won: "bg-emerald-100 text-emerald-700 border-emerald-200",
  lost: "bg-red-100 text-red-700 border-red-200",
}

const CHANNEL_LABELS: Record<string, string> = {
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
  other: "Otro",
}

function ChannelIcon({ source }: { source: string }) {
  const cls = "h-3 w-3"
  if (source === "whatsapp" || source === "sms") return <Smartphone className={cls} />
  if (source === "email") return <Mail className={cls} />
  if (source === "facebook") return <Facebook className={cls} />
  if (source === "instagram") return <Instagram className={cls} />
  if (source === "call") return <Phone className={cls} />
  return <Globe className={cls} />
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "ahora"
  if (diffMins < 60) return `hace ${diffMins} min`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `hace ${diffHrs}h`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `hace ${diffDays}d`
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </p>
  )
}

export function DetailDrawer({
  open,
  onOpenChange,
  opportunityId,
  opportunities,
  contacts,
  tasks: _tasks,
  calls: _calls,
  appointments = [],
  messages = [],
  locationId = "",
}: DetailDrawerProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)

  const opportunity = opportunities.find((o) => o.id === opportunityId)
  if (!opportunity) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Sin selección</SheetTitle>
            <SheetDescription>Selecciona un registro de la lista para ver los detalles.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
  }

  const contact = contacts.find((c) => c.id === opportunity.contactId)
  const contactAppointments = appointments
    .filter((a) => a.contactId === opportunity.contactId)
    .slice()
    .sort((a, b) => b.startTime.localeCompare(a.startTime))

  const contactMessages = messages
    .filter((m) => m.contactId === opportunity.contactId && m.kind !== "activity")
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const lastInbound = contactMessages.find((m) => m.direction === "inbound")
  const lastOutbound = contactMessages.find((m) => m.direction === "outbound")
  const latestMessage = contactMessages[0]
  const hasConversation = contactMessages.length > 0

  async function handleAnalyze() {
    if (!opportunity || !contact) return
    setIsAnalyzing(true)
    setAnalysisError(null)
    try {
      // Reuse the data already loaded in the drawer instead of forcing the
      // server to re-fetch: appointments (contact-scoped) and the recent
      // conversation (chronological, capped) enrich the analysis.
      const appointmentsPayload = contactAppointments.map((a) => ({
        title: a.title,
        startTime: a.startTime,
        endTime: a.endTime,
        status: a.status,
        notes: a.notes,
      }))
      const messagesPayload = contactMessages
        .slice(0, 30)
        .reverse()
        .map((m) => ({
          direction: m.direction,
          source: m.source,
          content: m.content,
          createdAt: m.createdAt,
        }))
      const res = await fetch("/api/analyze-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          contact,
          opportunity,
          appointments: appointmentsPayload,
          messages: messagesPayload,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAnalysisError(data.error ?? "Error desconocido")
      } else {
        setAnalysisResult(data.analysis)
      }
      setAnalysisOpen(true)
    } catch {
      setAnalysisError("No se pudo conectar con el servidor de análisis.")
      setAnalysisOpen(true)
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto p-0">
        {/* Header */}
        <div className="border-b border-border px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <SheetHeader className="p-0">
                <SheetTitle className="text-base">{contact?.name ?? "Contacto no encontrado"}</SheetTitle>
                <SheetDescription className="text-xs">
                  {contact?.email ?? "Sin correo"} · {contact?.phone ?? "Sin teléfono"}
                </SheetDescription>
              </SheetHeader>
            </div>
            <Badge variant="outline" className={`text-[11px] ${STATUS_STYLES[opportunity.status]}`}>
              {opportunity.status}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {contact?.tags && contact.tags.length > 0 ? (
              contact.tags.map((tag) => (
                <span
                  key={tag}
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TAG_COLORS[tag] ?? "bg-secondary text-secondary-foreground border-border"}`}
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground italic">Sin etiquetas</span>
            )}
          </div>
          {locationId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                <a
                  href={`https://login.lezgosuite.com/v2/location/${locationId}/opportunities/${opportunity.id}?tab=Opportunity+Details`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver oportunidad
                </a>
              </Button>
              {contact && (
                <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                  <a
                    href={`https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver contacto
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {isAnalyzing ? "Analizando…" : "Analizar con IA"}
              </Button>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex flex-col gap-5 px-6 py-5 pb-8">

          {/* Opportunity section */}
          <div>
            <SectionLabel>Oportunidad</SectionLabel>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <InfoCell icon={<DollarSign className="h-3.5 w-3.5" />} label="Valor">
                {opportunity.value ? formatCurrency(opportunity.value) : "Sin valor"}
              </InfoCell>
              <InfoCell icon={<Calendar className="h-3.5 w-3.5" />} label="Cierre">
                {opportunity.closedAt
                  ? new Date(opportunity.closedAt).toLocaleDateString("es-MX", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "No disponible"}
              </InfoCell>
              <InfoCell icon={<User className="h-3.5 w-3.5" />} label="Etapa">
                {opportunity.stage ?? "No disponible"}
              </InfoCell>
              <InfoCell icon={<Clock className="h-3.5 w-3.5" />} label="Pipeline">
                {opportunity.pipelineName ?? "No disponible"}
              </InfoCell>
              {opportunity.assignedTo && (
                <InfoCell icon={<User className="h-3.5 w-3.5" />} label="Asignado a" className="col-span-2">
                  {opportunity.assignedTo}
                </InfoCell>
              )}
            </div>
          </div>

          <Divider />

          {/* Contact section */}
          <div>
            <SectionLabel>Contacto</SectionLabel>
            {!contact ? (
              <p className="text-xs text-muted-foreground italic">Contacto no vinculado.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground">{contact.name}</span>
                </div>
                {contact.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">{contact.email}</span>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">{contact.phone}</span>
                  </div>
                )}
                {contact.assignedTo && (
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">Asignado a: {contact.assignedTo}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Conversation section */}
          {hasConversation && (
            <>
              <Divider />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <SectionLabel>Conversación</SectionLabel>
                  {latestMessage && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                      <ChannelIcon source={latestMessage.source} />
                      <span>{CHANNEL_LABELS[latestMessage.source] ?? latestMessage.source}</span>
                      <span className="mx-0.5">·</span>
                      <span>{formatRelativeTime(latestMessage.createdAt)}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {lastInbound && (
                    <MessageRow
                      direction="inbound"
                      content={lastInbound.content}
                      time={lastInbound.createdAt}
                      source={lastInbound.source}
                    />
                  )}
                  {lastOutbound && (
                    <MessageRow
                      direction="outbound"
                      content={lastOutbound.content}
                      time={lastOutbound.createdAt}
                      source={lastOutbound.source}
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground pt-0.5">
                    {contactMessages.length} mensaje{contactMessages.length !== 1 ? "s" : ""} en total
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Appointments section */}
          {contactAppointments.length > 0 && (
            <>
              <Divider />
              <div>
                <SectionLabel>Citas</SectionLabel>
                <div className="flex flex-col gap-2">
                  {contactAppointments.map((appt) => {
                    const status = (appt.status ?? "").toLowerCase()
                    const isConfirmed = ["confirmed", "showed"].includes(status)
                    const isCancelled = ["cancelled", "noshow", "no_show"].includes(status)
                    const Icon = isConfirmed ? CalendarCheck : isCancelled ? CalendarX : CalendarClock
                    const iconBg = isConfirmed ? "bg-emerald-100" : isCancelled ? "bg-red-100" : "bg-amber-100"
                    const iconColor = isConfirmed ? "text-emerald-600" : isCancelled ? "text-red-500" : "text-amber-600"
                    const badgeClass = isConfirmed
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : isCancelled
                      ? "bg-red-50 text-red-600 border-red-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                    const startDate = new Date(appt.startTime)
                    const dateStr = startDate.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
                    const timeStr = startDate.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
                    return (
                      <button
                        key={appt.id}
                        type="button"
                        onClick={() => setSelectedAppointment(appt)}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-primary/40 hover:bg-accent/30 transition-colors w-full"
                      >
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
                          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                        </div>
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">
                            {appt.title ?? "Cita"}
                          </span>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{dateStr}</span>
                            <span>{timeStr}</span>
                          </div>
                          {appt.notes && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{appt.notes}</p>
                          )}
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 capitalize ${badgeClass}`}>
                          {appt.status || "pendiente"}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Análisis IA — {contact?.name ?? "Contacto"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Generado por Claude · Basado en datos del CRM y citas
              </DialogDescription>
            </DialogHeader>
            {analysisError ? (
              <p className="text-sm text-destructive mt-2">{analysisError}</p>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown>{analysisResult ?? ""}</ReactMarkdown>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AppointmentDetailDialog
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
        />
      </SheetContent>
    </Sheet>
  )
}

function Divider() {
  return <div className="h-px bg-border" />
}

function InfoCell({
  icon,
  label,
  children,
  className = "",
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground leading-snug">{children}</p>
      </div>
    </div>
  )
}

function MessageRow({
  direction,
  content,
  time,
  source,
}: {
  direction: "inbound" | "outbound"
  content?: string
  time: string
  source: string
}) {
  const isInbound = direction === "inbound"
  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isInbound ? (
            <ArrowDownLeft className="h-3 w-3 text-blue-500" />
          ) : (
            <ArrowUpRight className="h-3 w-3 text-emerald-500" />
          )}
          <span className={`text-[10px] font-semibold ${isInbound ? "text-blue-600" : "text-emerald-600"}`}>
            {isInbound ? "Lead" : "Nosotros"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <ChannelIcon source={source} />
          <span>{formatRelativeTime(time)}</span>
        </div>
      </div>
      {content ? (
        <p className="text-xs text-foreground line-clamp-3 leading-relaxed">{content}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin contenido</p>
      )}
    </div>
  )
}

function AppointmentDetailDialog({
  appointment,
  onClose,
}: {
  appointment: Appointment | null
  onClose: () => void
}) {
  const open = appointment !== null
  const status = (appointment?.status ?? "").toLowerCase()
  const isConfirmed = ["confirmed", "showed"].includes(status)
  const isCancelled = ["cancelled", "noshow", "no_show"].includes(status)
  const Icon = isConfirmed ? CalendarCheck : isCancelled ? CalendarX : CalendarClock
  const iconBg = isConfirmed ? "bg-emerald-100" : isCancelled ? "bg-red-100" : "bg-amber-100"
  const iconColor = isConfirmed ? "text-emerald-600" : isCancelled ? "text-red-500" : "text-amber-600"
  const badgeClass = isConfirmed
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : isCancelled
    ? "bg-red-50 text-red-600 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200"

  let dateStr = ""
  let startTimeStr = ""
  let endTimeStr = ""
  let durationStr = ""
  if (appointment) {
    const start = new Date(appointment.startTime)
    const end = new Date(appointment.endTime)
    dateStr = start.toLocaleDateString("es-MX", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
    startTimeStr = start.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    endTimeStr = end.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
    if (mins >= 60) {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      durationStr = m > 0 ? `${h}h ${m}min` : `${h}h`
    } else if (mins > 0) {
      durationStr = `${mins} min`
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
              <Icon className={`h-4 w-4 ${iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-snug">
                {appointment?.title ?? "Cita"}
              </DialogTitle>
              <div className="text-xs mt-1 capitalize text-muted-foreground">
                <Badge variant="outline" className={`text-[10px] capitalize ${badgeClass}`}>
                  {appointment?.status || "pendiente"}
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-2">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Fecha</p>
            </div>
            <p className="text-sm text-foreground capitalize">{dateStr}</p>
            <div className="flex items-center gap-2 mt-2 text-sm text-foreground">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {startTimeStr} – {endTimeStr}
                {durationStr && <span className="text-muted-foreground"> · {durationStr}</span>}
              </span>
            </div>
          </div>

          {appointment?.assignedTo && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Asignado a</p>
              </div>
              <p className="text-sm text-foreground">{appointment.assignedTo}</p>
            </div>
          )}

          {appointment?.notes && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Notas</p>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {appointment.notes}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
