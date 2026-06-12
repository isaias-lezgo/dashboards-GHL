"use client"

import * as React from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarRange, ChevronDown } from "lucide-react"
import type { DateRange as DayPickerRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DateFilter, DateFilterPreset } from "@/lib/date-range"

const PRESET_OPTIONS: Array<{ label: string; value: DateFilterPreset }> = [
  { label: "Semana", value: "week" },
  { label: "Mes", value: "month" },
  { label: "3 meses", value: "3m" },
  { label: "6 meses", value: "6m" },
  { label: "Todo", value: "all" },
]

interface DateRangeFilterProps {
  value: DateFilter
  onChange: (value: DateFilter) => void
  className?: string
}

function formatCustomLabel(from?: Date, to?: Date) {
  if (!from) return "Personalizado"
  const fmt = (d: Date) => format(d, "d MMM yy", { locale: es })
  return to ? `${fmt(from)} – ${fmt(to)}` : fmt(from)
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const [customOpen, setCustomOpen] = React.useState(false)
  const isCustom = value.preset === "custom"

  const handleCustomSelect = React.useCallback(
    (range: DayPickerRange | undefined) => {
      onChange({ preset: "custom", from: range?.from, to: range?.to })
    },
    [onChange]
  )

  return (
    <section
      aria-label="Filtro de fechas"
      className={cn(
        "sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
        <div className="mr-1 flex shrink-0 items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fecha
          </span>
        </div>

        <div
          className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
          role="group"
          aria-label="Rango de fechas"
        >
          {PRESET_OPTIONS.map(({ label, value: preset }) => {
            const isActive = value.preset === preset

            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange({ preset })}
                aria-pressed={isActive}
                className={cn(
                  "h-6 shrink-0 rounded px-2 text-[11px] font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={isCustom ? "default" : "outline"}
              className="h-7 gap-1.5 rounded-md px-2.5 text-[11px] font-medium"
              aria-pressed={isCustom}
            >
              {isCustom ? formatCustomLabel(value.from, value.to) : "Personalizado"}
              <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              numberOfMonths={2}
              locale={es}
              defaultMonth={value.from ?? new Date()}
              selected={isCustom ? { from: value.from, to: value.to } : undefined}
              onSelect={handleCustomSelect}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border p-2">
              <span className="px-1 text-[11px] text-muted-foreground">
                {isCustom && value.from
                  ? formatCustomLabel(value.from, value.to)
                  : "Selecciona fecha de inicio y fin"}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-md text-[11px]"
                disabled={!isCustom || !value.from}
                onClick={() => setCustomOpen(false)}
              >
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </section>
  )
}
