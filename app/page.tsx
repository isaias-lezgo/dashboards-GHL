"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { AnimatePresence } from "framer-motion"
import { MarketingDashboard } from "@/components/dashboard/marketing-dashboard"
import { SalesDashboard } from "@/components/dashboard/sales-dashboard"
import { ConversationsDashboard } from "@/components/dashboard/conversations-dashboard"
import { LoadingScreen } from "@/components/dashboard/loading-screen"
import { useDashboardData } from "@/hooks/use-dashboard-data"
import {
  TrendingUp,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  MessageSquare,
  Users,
  Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"

type DashboardTab = "marketing" | "sales" | "conversations"

export default function DashboardPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DashboardTab>("marketing")

  useEffect(() => { setMounted(true) }, [])

  const { data, isLoading, isError, progress, refresh } = useDashboardData({})

  const contacts = data?.contacts ?? []
  const opportunities = data?.opportunities ?? []
  const calls = data?.calls ?? []
  const messages = data?.messages ?? []
  const appointments = data?.appointments ?? []
  const availableMembers = data?.members ?? []
  const availableTags = data?.tags ?? []

  const isInitialLoad = isLoading && !data

  return (
    <>
    <AnimatePresence>
      {isInitialLoad && <LoadingScreen key="loader" progress={progress} />}
    </AnimatePresence>
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight text-foreground">GHL Analíticas</h1>
              <p className="text-[11px] text-muted-foreground">Panel de Marketing y Ventas</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isError && (
              <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                Error al cargar datos
              </div>
            )}
            {!isLoading && data && (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] font-medium text-foreground"
                  title="Contactos cargados"
                >
                  <Users className="h-3 w-3 text-muted-foreground" />
                  {data.contacts.length.toLocaleString("es-MX")}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] font-medium text-foreground"
                  title="Oportunidades cargadas"
                >
                  <Target className="h-3 w-3 text-muted-foreground" />
                  {data.opportunities.length.toLocaleString("es-MX")}
                </span>
              </div>
            )}
            <span className="text-[11px] text-muted-foreground">
              {isLoading
                ? (progress || "Sincronizando…")
                : data?.meta?.fetchedAt
                  ? `Actualizado ${new Date(data.meta.fetchedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
            </span>
            
           
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg text-xs font-medium"
              onClick={() => refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Cambiar tema"
            >
              {mounted && resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border px-6 py-3">
        <div className="inline-flex items-center rounded-xl bg-secondary p-1 gap-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("marketing")}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all ${
              activeTab === "marketing"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            Marketing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sales")}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all ${
              activeTab === "sales"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Ventas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("conversations")}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all ${
              activeTab === "conversations"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Conversaciones
          </button>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="flex-1 pt-2 pb-6">
        {activeTab === "marketing" ? (
          <MarketingDashboard
            opportunities={opportunities}
            contacts={contacts}
            pautas={data?.pautas ?? []}
            tasks={data?.tasks ?? []}
            calls={calls}
            locationId={data?.locationId ?? ""}
          />
        ) : activeTab === "sales" ? (
          <SalesDashboard
            opportunities={opportunities}
            contacts={contacts}
            calls={calls}
            messages={messages}
            appointments={appointments}
            tasks={data?.tasks ?? []}
            members={availableMembers}
            locationId={data?.locationId ?? ""}
          />
        ) : (
          <ConversationsDashboard
            contacts={contacts}
            opportunities={opportunities}
            pipelines={data?.pipelines ?? []}
            members={availableMembers}
            availableTags={availableTags}
          />
        )}
      </div>
    </div>
    </>
  )
}
