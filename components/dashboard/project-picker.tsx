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

// Logo assets live in public/logos/, named after the project id.
//
// `tone` is the chip background each logo was DESIGNED for, and it is not
// cosmetic: five of these are dark ink on transparency and vanish on a dark
// surface, while Plaza Bosques ships a WHITE wordmark and vanishes on a light
// one. The chip pins each logo to the background it needs, so the picker stays
// readable in both light and dark theme without touching the source files.
//
// `shape` matches the chip to the asset. Five of these are horizontal wordmark
// lockups and want a wide chip; Lezgo Suite is a bare square mark (no horizontal
// lockup of it exists) and stranded in a wide chip it looks like a mistake. The
// chip narrows to a square for those, while the SLOT around it keeps a constant
// width so every project name still starts at the same x.
//
// A project with no entry here simply renders without a chip — adding one to the
// roster must never break the picker.
const LOGOS: Record<
  string,
  { src: string; tone: "light" | "dark"; shape?: "square" }
> = {
  "lezgo-suite": { src: "/logos/lezgo-suite.png", tone: "light", shape: "square" },
  condesa: { src: "/logos/condesa.png", tone: "light" },
  "plaza-bosques": { src: "/logos/plaza-bosques.png", tone: "dark" },
  "grand-center": { src: "/logos/grand-center.svg", tone: "light" },
  balvanera: { src: "/logos/balvanera.png", tone: "light" },
  yconia: { src: "/logos/yconia.png", tone: "light" },
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
            {projects.map((p) => {
              const logo = LOGOS[p.id]
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => open(p.id)}
                  className={cn(
                    "group flex items-center gap-5 rounded-xl border border-border bg-card",
                    "px-5 py-5 text-left transition-colors duration-200",
                    "hover:border-foreground/25 hover:bg-accent",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {logo && (
                    // Constant-width slot: the chip inside may be square or wide, but
                    // every project name still starts at the same x across the grid.
                    <span className="flex w-28 shrink-0 justify-start">
                      <span
                        className={cn(
                          "flex h-16 items-center justify-center rounded-lg p-2.5",
                          logo.shape === "square" ? "w-16" : "w-28",
                          // The ring is on EVERY chip, not just the dark one. Without it
                          // the fill that matches the current theme's card goes invisible
                          // and that one logo reads as a mistake — white chips vanish in
                          // light theme, the dark chip vanishes in dark theme. A constant
                          // outline makes all six read as one system with different fills.
                          "ring-1 ring-black/10 dark:ring-white/15",
                          logo.tone === "dark" ? "bg-[#151B28]" : "bg-white",
                        )}
                      >
                        {/* Plain <img>, not next/image: these are fixed-size decorative
                            marks that need no srcset, and one is an SVG, which the
                            next/image optimizer refuses without dangerouslyAllowSVG.
                            alt="" because the project name sits right beside it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo.src} alt="" className="max-h-full max-w-full object-contain" />
                      </span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-lg font-medium text-foreground">{p.name}</span>
                  {pending === p.id ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                  )}
                </button>
              )
            })}
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
