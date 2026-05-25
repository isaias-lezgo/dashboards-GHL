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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { Opportunity, Contact, Task, Call, Appointment } from "@/lib/types"
import {
  Phone,
  Clock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Calendar,
  DollarSign,
  User,
  ExternalLink,
  Sparkles,
  Loader2,
  CalendarCheck,
  CalendarX,
  CalendarClock,
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

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`
}

const TASK_ICONS: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  followup: MessageSquare,
  other: MoreHorizontal,
}

export function DetailDrawer({
  open,
  onOpenChange,
  opportunityId,
  opportunities,
  contacts,
  tasks,
  calls,
  appointments = [],
  locationId = "",
}: DetailDrawerProps) {
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "completed">("all")
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
  const oppTasks = tasks.filter((t) => t.opportunityId === opportunity.id)
  const contactCalls = calls
    .filter((c) => c.contactId === opportunity.contactId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const contactAppointments = appointments.filter(
    (a) => a.contactId === opportunity.contactId
  )

  const filteredTasks =
    taskFilter === "all"
      ? oppTasks
      : oppTasks.filter((t) => t.status === taskFilter)

  async function handleAnalyze() {
    if (!opportunity || !contact) return
    setIsAnalyzing(true)
    setAnalysisError(null)
    try {
      const res = await fetch("/api/analyze-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            tags: contact.tags,
            source: contact.source,
            campaign: contact.campaign,
            assignedTo: contact.assignedTo,
          },
          opportunity: {
            id: opportunity.id,
            name: opportunity.name,
            pipelineName: opportunity.pipelineName,
            stage: opportunity.stage,
            status: opportunity.status,
            value: opportunity.value,
            lostReason: opportunity.lostReason,
            createdAt: opportunity.createdAt,
            updatedAt: opportunity.updatedAt,
            assignedTo: opportunity.assignedTo,
          },
          tasks: oppTasks.map((t) => ({
            title: t.title,
            type: t.type,
            status: t.status,
            dueDate: t.dueDate,
          })),
          calls: contactCalls.map((c) => ({
            direction: c.direction,
            status: c.status,
            durationSeconds: c.durationSeconds,
            createdAt: c.createdAt,
          })),
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
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
              >
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
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                >
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
                {isAnalyzing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {isAnalyzing ? "Analizando…" : "Analizar con IA"}
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="px-6 pt-4">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1 text-xs">Resumen</TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1 text-xs">Tareas</TabsTrigger>
            <TabsTrigger value="appointments" className="flex-1 text-xs">Citas</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-border p-4">
                <h4 className="text-xs font-semibold text-muted-foreground mb-3">Detalles de la Oportunidad</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Valor</p>
                      <p className="text-sm font-semibold text-foreground">{opportunity.value ? formatCurrency(opportunity.value) : "Sin valor"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Fecha de cierre</p>
                      <p className="text-sm font-semibold text-foreground">{(opportunity as any).closeDate ?? "No disponible"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Etapa</p>
                      <p className="text-sm font-semibold text-foreground">{opportunity.stage ?? "No disponible"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Pipeline</p>
                      <p className="text-sm font-semibold text-foreground">{opportunity.pipelineName ?? "No disponible"}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-4">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Información de Contacto</h4>
                {!contact ? (
                  <p className="text-sm text-muted-foreground italic">Contacto no vinculado a esta oportunidad.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium text-foreground">{contact.name}</p>
                    <p className="text-xs text-muted-foreground">{contact.email || "Sin correo electrónico"}</p>
                    <p className="text-xs text-muted-foreground">{contact.phone || "Sin teléfono"}</p>
                    {contact.assignedTo && <p className="text-xs text-muted-foreground">Asignado a: {contact.assignedTo}</p>}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="mt-4">
            <div className="flex items-center gap-1 mb-3">
              {([["all","Todas"],["open","Pendientes"],["completed","Completadas"]] as const).map(([f, label]) => (
                <Button
                  key={f}
                  variant={taskFilter === f ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() => setTaskFilter(f)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {filteredTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin tareas registradas.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredTasks.map((task) => {
                  const Icon = TASK_ICONS[task.type] || MoreHorizontal
                  return (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3"
                    >
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${task.status === "completed" ? "bg-emerald-100" : "bg-muted"}`}>
                        <Icon className={`h-3.5 w-3.5 ${task.status === "completed" ? "text-emerald-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">{task.title}</span>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="capitalize">{task.type}</span>
                          <span>Due: {task.dueDate}</span>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${task.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}
                      >
                        {task.status}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* Appointments Tab */}
          <TabsContent value="appointments" className="mt-4 pb-6">
            {contactAppointments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin citas registradas.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {contactAppointments
                  .slice()
                  .sort((a, b) => b.startTime.localeCompare(a.startTime))
                  .map((appt) => {
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
                        className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-primary/40 hover:bg-accent/30 transition-colors"
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
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 capitalize ${badgeClass}`}
                        >
                          {appt.status || "pendiente"}
                        </Badge>
                      </button>
                    )
                  })}
              </div>
            )}
          </TabsContent>
        </Tabs>

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
              <DialogDescription className="text-xs mt-1 capitalize">
                <Badge variant="outline" className={`text-[10px] capitalize ${badgeClass}`}>
                  {appointment?.status || "pendiente"}
                </Badge>
              </DialogDescription>
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
