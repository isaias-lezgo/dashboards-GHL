"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Amber Ledger tokens — see DESIGN.md */
export const BRAND_AMBER = "#F59B1B"
export const STRUCTURAL_NAVY = "#335577"
export const CHART_GRID_STROKE = "hsl(var(--border))"

export const CHART_TICK = {
  fontSize: 11,
  fill: "hsl(var(--muted-foreground))",
} as const

/** Leading series is always brand amber; blue is series-only, never primary UI. */
export const CHART_PALETTE = [
  BRAND_AMBER,
  STRUCTURAL_NAVY,
  "#10b981",
  "#8b5cf6",
  "#2563eb",
  "#06b6d4",
  "#f97316",
  "#22c55e",
  "#ec4899",
  "#84cc16",
  "#ef4444",
  "#0ea5e9",
] as const

export function chartPaletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

export function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium tabular-nums tracking-wide text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString("es-MX") : value}
    </span>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 px-6 pb-8">{children}</div>
}

export function DashboardCard({
  children,
  className,
  interactive,
  onClick,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
  onClick?: () => void
}) {
  return (
    <Card
      className={cn(
        "shadow-none",
        interactive &&
          "cursor-pointer transition-[box-shadow,border-color,background-color] duration-200 hover:border-primary/35 hover:shadow-[0_1px_3px_rgba(21,27,40,0.08),0_1px_2px_rgba(21,27,40,0.06)]",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </Card>
  )
}

export function ChartCardHeader({
  title,
  total,
  icon: Icon,
}: {
  title: string
  total?: number | string
  icon?: LucideIcon
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <CardTitle className="text-sm font-semibold leading-snug tracking-tight">{title}</CardTitle>
      {total !== undefined && <TotalBadge value={total} />}
    </CardHeader>
  )
}

export function ChartCardContent({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <CardContent className={cn("px-4 pb-4 pt-0", className)}>{children}</CardContent>
}

export function ChartEmpty({
  message,
  height = 200,
}: {
  message: string
  height?: number
}) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-sm text-muted-foreground"
      style={{ minHeight: height }}
    >
      {message}
    </div>
  )
}

export function ChartHint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">{children}</p>
  )
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {title}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

export function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  variant = "default",
  onClick,
}: {
  label: string
  value: string
  sublabel?: string
  icon?: LucideIcon
  variant?: "default" | "hero"
  onClick?: () => void
}) {
  const isHero = variant === "hero"
  return (
    <DashboardCard interactive={!!onClick} onClick={onClick} className={isHero ? "md:col-span-2" : undefined}>
      <CardContent className={cn("p-4", isHero && "py-5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                "font-medium uppercase tracking-wide text-muted-foreground",
                isHero ? "text-[11px]" : "text-[10px]",
              )}
            >
              {label}
            </p>
            <p
              className={cn(
                "mt-1 font-bold tabular-nums tracking-tight text-foreground",
                isHero ? "text-4xl" : "text-2xl",
              )}
            >
              {value}
            </p>
            {sublabel && (
              <p className="mt-1 text-[11px] text-muted-foreground">{sublabel}</p>
            )}
          </div>
          {Icon && (
            <Icon
              className={cn(
                "shrink-0",
                isHero ? "h-6 w-6 text-primary" : "h-5 w-5 text-[#335577]",
              )}
              aria-hidden
            />
          )}
        </div>
      </CardContent>
    </DashboardCard>
  )
}

export function MarketingSummaryStrip({
  opportunities,
  pautas,
  paidSocialLeads,
}: {
  opportunities: number
  pautas: number
  paidSocialLeads: number
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-none">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Oportunidades
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
          {opportunities.toLocaleString("es-MX")}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-none">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pautas</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
          {pautas.toLocaleString("es-MX")}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-none">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Oportunidades por pauta
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-primary">
          {paidSocialLeads.toLocaleString("es-MX")}
        </p>
      </div>
    </div>
  )
}
