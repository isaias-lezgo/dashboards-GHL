// components/dashboard/project-picker.tsx
"use client"

import { useEffect, useState } from "react"
import { ArrowRight, LogOut, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PickerProject {
  id: string
  name: string
}

export function ProjectPicker({ projects }: { projects: PickerProject[] }) {
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => { document.title = "Proyectos Lezgo" }, [])

  async function open(id: string) {
    setPending(id)
    try {
      const res = await fetch("/api/project/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setPending(null)
        return
      }
      // A full page load, not a router push. A soft navigation would leave the
      // previous project's contacts and chat history mounted in the cached React
      // tree — the same reason the logout button does this.
      window.location.href = "/"
    } catch {
      setPending(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Proyectos Lezgo</h1>
        <p className="mt-2 text-sm text-muted-foreground">Elige el proyecto que quieres revisar.</p>

        {projects.length === 0 ? (
          <p className="mt-10 text-sm text-destructive">
            No hay proyectos configurados. Revisa DASHBOARD_CLIENTS.
          </p>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending !== null}
                onClick={() => open(p.id)}
                className={cn(
                  "group flex items-center justify-between rounded-xl border border-border bg-card",
                  "px-6 py-7 text-left transition-colors duration-200",
                  "hover:border-foreground/25 hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <span className="text-lg font-medium text-foreground">{p.name}</span>
                {pending === p.id ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" })
            window.location.href = "/login"
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </Button>
      </footer>
    </div>
  )
}
