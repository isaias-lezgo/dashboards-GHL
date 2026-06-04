"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { AnimatePresence } from "framer-motion"
import { MarketingDashboard } from "@/components/dashboard/marketing-dashboard"
import { SalesDashboard } from "@/components/dashboard/sales-dashboard"
import { ConversationsChat } from "@/components/dashboard/conversations-chat"
import { LoadingScreen } from "@/components/dashboard/loading-screen"
import { AIChatPanel } from "@/components/dashboard/ai-chat-panel"
import { useDashboardData } from "@/hooks/use-dashboard-data"
import { useConversationsData } from "@/hooks/use-conversations-data"
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
  ClipboardList,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type DashboardTab = "marketing" | "sales" | "conversations"

export default function DashboardPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DashboardTab>("marketing")
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aiInitialMessage, setAiInitialMessage] = useState<string | undefined>(undefined)

  function handleAnalyzeWithAI(initialMessage: string) {
    setAiInitialMessage(initialMessage)
    setAiChatOpen(true)
  }

  useEffect(() => { setMounted(true) }, [])

  const { data, isLoading, isError, progress, refresh } = useDashboardData({})
  const { messages, isLoading: messagesLoading } = useConversationsData()

  const contacts = data?.contacts ?? []
  const opportunities = data?.opportunities ?? []
  const calls = data?.calls ?? []
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
      <header className="border-b border-[#335577]/20 bg-[#0D172F] px-6 py-3.5 text-white shadow-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <BarChart3 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight tracking-tight">Lezgo Suite Analíticas</h1>
              <p className="text-[11px] text-white/70">Marketing y Ventas</p>
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
              <TooltipProvider delayDuration={200}>
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-medium text-white">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {data.contacts.length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Contactos cargados</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-medium text-white">
                        <Target className="h-3 w-3 text-muted-foreground" />
                        {data.opportunities.length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Oportunidades cargadas</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-medium text-white">
                        <ClipboardList className="h-3 w-3 text-muted-foreground" />
                        {(data?.pautas ?? []).length.toLocaleString("es-MX")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Pautas cargadas</TooltipContent>
                  </Tooltip>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setAiChatOpen(true)}
                    className="h-7 gap-1.5 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2.5 text-[11px] font-medium text-white shadow-sm transition-all hover:from-violet-400 hover:to-fuchsia-400 hover:shadow-md"
                  >
                    <Sparkles className="h-3 w-3" />
                    Analizar con IA
                  </Button>
                </div>
              </TooltipProvider>
            )}
            <span className="text-[11px] text-white/75">
              {isLoading
                ? (progress || "Sincronizando…")
                : data?.meta?.fetchedAt
                  ? `Actualizado ${new Date(data.meta.fetchedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
            </span>
            
           
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 rounded-lg text-xs font-medium"
              onClick={() => refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-white/80" />}

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

      <nav className="border-b border-border bg-background px-6" aria-label="Vistas del panel">
        <div className="flex gap-8">
          {(
            [
              { id: "marketing" as const, label: "Marketing", icon: TrendingUp },
              { id: "sales" as const, label: "Ventas", icon: BarChart3 },
              { id: "conversations" as const, label: "Conversaciones", icon: MessageSquare },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  "relative flex items-center gap-2 py-3 text-sm font-medium transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Dashboard Content */}
      <div className="flex-1 pt-2 pb-6">
        {activeTab === "marketing" ? (
          <MarketingDashboard
            opportunities={opportunities}
            contacts={contacts}
            pautas={data?.pautas ?? []}
            pipelines={data?.pipelines ?? []}
            tasks={data?.tasks ?? []}
            calls={calls}
            appointments={appointments}
            locationId={data?.locationId ?? ""}
            onAnalyzeWithAI={handleAnalyzeWithAI}
          />
        ) : activeTab === "sales" ? (
          <SalesDashboard
            opportunities={opportunities}
            contacts={contacts}
            calls={calls}
            messages={messages}
            messagesLoading={messagesLoading}
            appointments={appointments}
            tasks={data?.tasks ?? []}
            pautas={data?.pautas ?? []}
            members={availableMembers}
            locationId={data?.locationId ?? ""}
            onAnalyzeWithAI={handleAnalyzeWithAI}
          />
        ) : (
          <ConversationsChat
            dataset={{
              contacts,
              opportunities,
              pautas: data?.pautas ?? [],
              appointments,
              messages,
              tasks: data?.tasks ?? [],
              calls,
            }}
            locationId={data?.locationId}
          />
        )}
      </div>

      {data && (
        <AIChatPanel
          open={aiChatOpen}
          onOpenChange={(o) => {
            setAiChatOpen(o)
            if (!o) setAiInitialMessage(undefined)
          }}
          dataset={{
            contacts,
            opportunities,
            pautas: data.pautas ?? [],
            appointments,
            messages,
            tasks: data.tasks ?? [],
            calls,
          }}
          locationId={data.locationId}
          initialMessage={aiInitialMessage}
        />
      )}
    </div>
    </>
  )
}
