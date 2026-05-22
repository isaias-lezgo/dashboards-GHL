"use client"

import { useState } from "react"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Opportunity, Contact, Task, Call } from "@/lib/types"
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Calendar,
  DollarSign,
  User,
} from "lucide-react"

interface DetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string | null
  opportunities: Opportunity[]
  contacts: Contact[]
  tasks: Task[]
  calls: Call[]
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
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
}: DetailDrawerProps) {
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "completed">("all")

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

  const filteredTasks =
    taskFilter === "all"
      ? oppTasks
      : oppTasks.filter((t) => t.status === taskFilter)

  // Timeline: merge tasks and calls, sorted by date desc
  const timelineItems = [
    ...oppTasks.map((t) => ({
      type: "task" as const,
      date: t.dueDate,
      title: t.title,
      subtitle: `${t.type} - ${t.status}`,
      icon: TASK_ICONS[t.type] || MoreHorizontal,
      status: t.status,
    })),
    ...contactCalls.map((c) => ({
      type: "call" as const,
      date: c.createdAt,
      title: `${c.direction} call - ${c.userName}`,
      subtitle: c.status === "completed" ? formatDuration(c.durationSeconds) : "Missed",
      icon: c.status === "missed" ? PhoneMissed : c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing,
      status: c.status,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))

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
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="px-6 pt-4">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1 text-xs">Resumen</TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1 text-xs">Tareas</TabsTrigger>
            <TabsTrigger value="calls" className="flex-1 text-xs">Llamadas</TabsTrigger>
            <TabsTrigger value="timeline" className="flex-1 text-xs">Historial</TabsTrigger>
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

          {/* Calls Tab */}
          <TabsContent value="calls" className="mt-4">
            {contactCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin llamadas registradas.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Fecha</TableHead>
                    <TableHead className="text-xs">Dirección</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs">Duración</TableHead>
                    <TableHead className="text-xs">Asesor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactCalls.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="text-xs text-foreground">{call.createdAt}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-foreground">
                          {call.direction === "inbound" ? (
                            <PhoneIncoming className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <PhoneOutgoing className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className="capitalize">{call.direction}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${call.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}
                        >
                          {call.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {call.status === "completed" ? formatDuration(call.durationSeconds) : "--"}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">{call.userName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-4 pb-6">
            {timelineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin actividad registrada.</p>
            ) : (
              <div className="relative flex flex-col gap-0">
                {timelineItems.map((item, idx) => {
                  const Icon = item.icon
                  const isLast = idx === timelineItems.length - 1
                  return (
                    <div key={`${item.type}-${idx}`} className="relative flex gap-3 pb-4">
                      {!isLast && (
                        <div className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />
                      )}
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.type === "call" ? "bg-blue-100" : "bg-muted"}`}>
                        <Icon className={`h-3.5 w-3.5 ${item.type === "call" ? "text-blue-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="text-sm text-foreground">{item.title}</span>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{item.date}</span>
                          <span>{item.subtitle}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
