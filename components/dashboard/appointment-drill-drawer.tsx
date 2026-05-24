"use client"

import { motion } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import type { Appointment, Contact } from "@/lib/types"
import { CalendarCheck, CalendarX, CalendarClock, User } from "lucide-react"

export interface ApptDrillState {
  open: boolean
  title: string
  appointments: Appointment[]
}

export const APPT_DRILL_CLOSED: ApptDrillState = { open: false, title: "", appointments: [] }

interface AppointmentDrillDrawerProps {
  drill: ApptDrillState
  onDrillChange: (d: ApptDrillState) => void
  contacts: Contact[]
}

function statusVisual(status: string): {
  Icon: typeof CalendarCheck
  iconBg: string
  iconColor: string
  badgeClass: string
} {
  const s = status.toLowerCase()
  if (s === "showed" || s === "confirmed") {
    return {
      Icon: CalendarCheck,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    }
  }
  if (s === "noshow" || s === "no_show" || s === "cancelled") {
    return {
      Icon: CalendarX,
      iconBg: "bg-red-100",
      iconColor: "text-red-500",
      badgeClass: "bg-red-50 text-red-600 border-red-200",
    }
  }
  return {
    Icon: CalendarClock,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  }
}

export function AppointmentDrillDrawer({
  drill,
  onDrillChange,
  contacts,
}: AppointmentDrillDrawerProps) {
  const contactById = new Map(contacts.map((c) => [c.id, c]))
  const sorted = [...drill.appointments].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  )
  const count = drill.appointments.length

  return (
    <Sheet open={drill.open} onOpenChange={(o) => onDrillChange({ ...drill, open: o })}>
      <SheetContent className="w-[500px] sm:max-w-[500px] p-0 flex flex-col overflow-hidden">
        <div className="border-b border-border px-6 pt-5 pb-4 flex-none">
          <SheetHeader>
            <SheetTitle className="text-[15px] font-semibold leading-snug pr-6">
              {drill.title}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-2.5 flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full text-xs font-semibold tabular-nums">
              {count.toLocaleString()} cita{count !== 1 ? "s" : ""}
            </Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {count === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Sin citas en este segmento.
            </div>
          ) : (
            sorted.map((appt, i) => {
              const contact = contactById.get(appt.contactId)
              const { Icon, iconBg, iconColor, badgeClass } = statusVisual(appt.status)
              const start = new Date(appt.startTime)
              const dateStr = start.toLocaleDateString("es-MX", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
              const timeStr = start.toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
              })
              return (
                <motion.div
                  key={appt.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
                    <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground truncate">
                        {contact?.name ?? "Contacto desconocido"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {appt.title ?? "Cita"}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span>{dateStr}</span>
                      <span>{timeStr}</span>
                    </div>
                    {appt.notes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {appt.notes}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 capitalize ${badgeClass}`}
                  >
                    {appt.status}
                  </Badge>
                </motion.div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
