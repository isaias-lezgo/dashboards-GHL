"use client"

import type { ComponentProps, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Facebook, Instagram, Globe } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartTooltipContent } from "@/components/ui/chart"

/** Tooltip wrapper that hides zero-value series and sorts by value descending. */
type NonZeroTooltipProps = ComponentProps<typeof ChartTooltipContent>

export function NonZeroTooltipContent(props: NonZeroTooltipProps) {
  const filtered = (props.payload ?? [])
    .filter((p) => Number(p?.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
  if (!props.active || filtered.length === 0) return null
  return <ChartTooltipContent {...props} payload={filtered} />
}

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

// Brand icon for a canonical platform label. lucide ships Facebook/Instagram
// but not TikTok/WhatsApp/Google, so those use inline brand SVGs. "Otro" and any
// unknown label fall back to a neutral globe so every row keeps a leading glyph.
export function PlatformIcon({ platform, className = "h-3.5 w-3.5 shrink-0" }: { platform: string; className?: string }) {
  switch (platform) {
    case "Facebook":
      return <Facebook className={`${className} text-[#1877f2]`} />
    case "Instagram":
      return <Instagram className={`${className} text-[#e1306c]`} />
    case "TikTok":
      return (
        <svg viewBox="0 0 24 24" className={`${className} text-foreground`} fill="currentColor" aria-hidden="true">
          <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.6 2.6 0 0 1-2.6-2.6c0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3c-.97 0-1.88-.49-2.43-1.48z" />
        </svg>
      )
    case "WhatsApp":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#25D366" aria-hidden="true">
          <path d="M17.47 14.38c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.5 9.5 0 0 1-4.84-1.33l-.35-.2-3.6.94.96-3.51-.23-.36a9.46 9.46 0 0 1-1.45-5.05c0-5.23 4.26-9.49 9.5-9.49 2.54 0 4.92.99 6.72 2.79a9.43 9.43 0 0 1 2.78 6.71c-.01 5.23-4.27 9.49-9.49 9.49z" />
        </svg>
      )
    case "Google":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
      )
    default:
      return <Globe className={`${className} text-muted-foreground`} />
  }
}

export function TotalBadge({ value, className }: { value: number | string; className?: string }) {
  return (
    <span className={cn("ml-auto inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium tabular-nums tracking-wide text-muted-foreground", className)}>
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
  actions,
}: {
  title: string
  total?: number | string
  icon?: LucideIcon
  actions?: ReactNode
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <CardTitle className="text-sm font-semibold leading-snug tracking-tight">{title}</CardTitle>
      <div className="ml-auto flex items-center gap-2">
        {actions}
        {total !== undefined && <TotalBadge value={total} className="ml-0" />}
      </div>
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
  uniquePautas,
  reingresoPautas,
  paidSocialLeads,
}: {
  opportunities: number
  pautas: number
  uniquePautas: number
  reingresoPautas: number
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
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Oportunidades por pauta
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-primary">
          {paidSocialLeads.toLocaleString("es-MX")}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-none">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pautas</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
          {pautas.toLocaleString("es-MX")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
          <span>
            Leads únicos{" "}
            <span className="font-semibold text-foreground">{uniquePautas.toLocaleString("es-MX")}</span>
          </span>
          <span className="text-border">·</span>
          <span>
            Reingresos{" "}
            <span className="font-semibold text-amber-600">{reingresoPautas.toLocaleString("es-MX")}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
