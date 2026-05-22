"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { DetailDrawer } from "./detail-drawer"
import type { Opportunity, Contact, Task, Call, Pauta } from "@/lib/types"
import { DollarSign, User, Tag, FileText, ChevronRight } from "lucide-react"

const STAGE_CLASSES: Record<string, string> = {
  "Primera Cita":            "bg-blue-100 text-blue-700",
  "Segunda Cita":            "bg-purple-100 text-purple-700",
  "Envío de propuesta":      "bg-amber-100 text-amber-700",
  "Envío de liga de pago":   "bg-cyan-100 text-cyan-700",
  "Proceso de Implementación":"bg-emerald-100 text-emerald-700",
  "Cliente Activo":          "bg-green-100 text-green-700",
  "Servicio Terminado":      "bg-gray-100 text-gray-600",
  "Prospecto Perdido":       "bg-red-100 text-red-700",
  Discovery:                 "bg-blue-100 text-blue-700",
  Proposal:                  "bg-purple-100 text-purple-700",
  Negotiation:               "bg-amber-100 text-amber-700",
  "Closed Won":              "bg-emerald-100 text-emerald-700",
  "Closed Lost":             "bg-red-100 text-red-700",
}

const STATUS_STYLES: Record<string, string> = {
  open:      "bg-blue-50 text-blue-700 border-blue-200",
  won:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost:      "bg-red-50 text-red-700 border-red-200",
  abandoned: "bg-gray-50 text-gray-600 border-gray-200",
}

export interface DrillState {
  open: boolean
  title: string
  subtitle?: string
  opportunities: Opportunity[]
  pautas?: Pauta[]
}

export const DRILL_CLOSED: DrillState = { open: false, title: "", opportunities: [] }

interface ChartDrillDrawerProps {
  drill: DrillState
  onDrillChange: (d: DrillState) => void
  contacts: Contact[]
  tasks: Task[]
  calls: Call[]
  /** Full opportunity list needed by DetailDrawer to resolve the selected ID */
  allOpportunities: Opportunity[]
  locationId?: string
}

export function ChartDrillDrawer({
  drill,
  onDrillChange,
  contacts,
  tasks,
  calls,
  allOpportunities,
  locationId = "",
}: ChartDrillDrawerProps) {
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const showPautas = drill.opportunities.length === 0 && (drill.pautas?.length ?? 0) > 0
  const count = showPautas ? (drill.pautas?.length ?? 0) : drill.opportunities.length

  return (
    <>
      <Sheet open={drill.open} onOpenChange={(o) => onDrillChange({ ...drill, open: o })}>
        <SheetContent className="w-[500px] sm:max-w-[500px] p-0 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b border-border px-6 pt-5 pb-4 flex-none">
            <SheetHeader>
              <SheetTitle className="text-[15px] font-semibold leading-snug pr-6">
                {drill.title}
              </SheetTitle>
            </SheetHeader>
            {drill.subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{drill.subtitle}</p>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <Badge variant="secondary" className="rounded-full text-xs font-semibold tabular-nums">
                {count.toLocaleString()} registro{count !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {showPautas ? (
              <PautasList pautas={drill.pautas!} />
            ) : count === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Sin datos para mostrar.
              </div>
            ) : (
              drill.opportunities.map((opp, i) => {
                const contact = contacts.find((c) => c.id === opp.contactId)
                return (
                  <motion.button
                    key={opp.id}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
                    onClick={() => { setSelectedOppId(opp.id); setDetailOpen(true) }}
                    className="group w-full text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:bg-accent/30 transition-all"
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                          {contact?.name ?? "Contacto desconocido"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[opp.status] ?? ""}`}>
                          {opp.status}
                        </Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>

                    {/* Opp name */}
                    <p className="text-xs text-muted-foreground mb-2.5 truncate pl-5">{opp.name}</p>

                    {/* Stage + value */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_CLASSES[opp.stage] ?? "bg-muted text-muted-foreground"}`}>
                        {opp.stage}
                      </span>
                      <div className="flex items-center gap-0.5 text-xs font-semibold text-foreground">
                        <DollarSign className="h-3 w-3 text-muted-foreground" />
                        {opp.value.toLocaleString("es-MX")}
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground pl-0.5">
                      {opp.assignedTo && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {opp.assignedTo}
                        </span>
                      )}
                      {opp.campaign && (
                        <span className="flex items-center gap-1 truncate">
                          <Tag className="h-3 w-3 shrink-0" />
                          <span className="truncate">{opp.campaign}</span>
                        </span>
                      )}
                    </div>
                  </motion.button>
                )
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      <DetailDrawer
        open={detailOpen}
        onOpenChange={setDetailOpen}
        opportunityId={selectedOppId}
        opportunities={allOpportunities}
        contacts={contacts}
        tasks={tasks}
        calls={calls}
        locationId={locationId}
      />
    </>
  )
}

function PautasList({ pautas }: { pautas: Pauta[] }) {
  return (
    <>
      {pautas.map((p, i) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground truncate">
                {p.nombrePauta}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">{p.tipo}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground pl-5">
            {new Date(p.createdAt).toLocaleDateString("es-MX")}
          </p>
        </motion.div>
      ))}
    </>
  )
}
