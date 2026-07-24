// components/dashboard/project-picker.tsx
"use client"

import { useEffect, useState } from "react"
import { Loader2, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PickerProject {
  id: string
  name: string
}

// Logo assets live in public/logos/<project-id>.<ext>.
//
// `tone` is the plate colour each logo was DESIGNED for, and it is not cosmetic:
// five of these are dark ink on transparency and vanish on a dark surface, while
// Plaza Bosques ships a WHITE wordmark and vanishes on a light one. The plate IS
// the project's surface here, so it carries the logo's own background rather than
// nesting a chip inside a card.
//
// A project with no entry renders as a wordmark plate — adding one to the roster
// must never break the picker.
const LOGOS: Record<string, { src: string; tone: "light" | "dark" }> = {
  "lezgo-suite": { src: "/logos/lezgo-suite.png", tone: "light" },
  condesa: { src: "/logos/condesa.png", tone: "light" },
  "plaza-bosques": { src: "/logos/plaza-bosques.png", tone: "dark" },
  "grand-center": { src: "/logos/grand-center.svg", tone: "light" },
  balvanera: { src: "/logos/balvanera.png", tone: "light" },
  yconia: { src: "/logos/yconia.png", tone: "light" },
}

// DESIGN.md tokens. Amber marks where attention belongs — here that is the plate
// you are about to open, so it appears on hover, focus and the pending state, and
// nowhere else.
const AMBER = "#F59B1B"
const INK_NAVY = "#151B28"

// ease-out-quint: fast commit, soft landing. Product register keeps it brief.
const EASE = "cubic-bezier(0.22,1,0.36,1)"

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
      // tree — the same reason logout does this.
      window.location.href = "/"
    } catch {
      setPending(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Proyectos Lezgo
          </h1>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" })
              window.location.href = "/login"
            }}
            className="flex shrink-0 items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59B1B] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </header>

        {projects.length === 0 ? (
          <div className="mt-16 max-w-md">
            <p className="text-sm font-medium text-foreground">No hay proyectos configurados.</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Agrega uno a <code className="rounded bg-muted px-1 py-0.5 text-xs">DASHBOARD_CLIENTS</code>{" "}
              con <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm add-client</code> y vuelve a desplegar.
            </p>
          </div>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-7 sm:mt-12 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-9">
            {projects.map((p) => {
              const logo = LOGOS[p.id]
              const isPending = pending === p.id
              const busy = pending !== null
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => open(p.id)}
                    aria-busy={isPending}
                    className={cn(
                      "group block w-full text-left",
                      "focus-visible:outline-none",
                      // Only the clicked plate keeps full presence; the rest recede
                      // so the pending one reads as the one thing happening.
                      busy && !isPending && "opacity-40",
                      "disabled:cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        // The plate IS the surface: no card wrapping a chip.
                        "flex aspect-[16/10] items-center justify-center rounded-xl p-5 sm:p-6",
                        // Ring and shadow are both box-shadow under the hood, so one
                        // transition covers the amber attention state and the lift.
                        "transition-[transform,box-shadow] duration-200",
                        isPending
                          ? "ring-2 ring-[#F59B1B]"
                          : "ring-1 ring-black/[0.08] dark:ring-white/[0.14]",
                        // Amber marks the plate you are about to open, and nothing else.
                        !busy &&
                          "group-hover:-translate-y-0.5 group-hover:ring-[#F59B1B]/70 group-hover:shadow-lg group-hover:shadow-black/[0.07] dark:group-hover:shadow-black/40",
                        "group-focus-visible:ring-2 group-focus-visible:ring-[#F59B1B]",
                      )}
                      style={{
                        transitionTimingFunction: EASE,
                        backgroundColor: logo?.tone === "dark" ? INK_NAVY : "oklch(0.99 0.004 85)",
                      }}
                    >
                      {logo ? (
                        // Plain <img>, not next/image: fixed-size marks that need no
                        // srcset, and one is an SVG, which the next/image optimizer
                        // refuses without dangerouslyAllowSVG. alt="" because the
                        // project name is rendered directly below.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo.src} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-center text-sm font-semibold" style={{ color: INK_NAVY }}>
                          {p.name}
                        </span>
                      )}
                    </span>

                    <span className="mt-2.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-sm font-medium transition-colors duration-200",
                          isPending ? "" : "text-foreground/85 group-hover:text-foreground",
                        )}
                        style={isPending ? { color: AMBER } : undefined}
                      >
                        {p.name}
                      </span>
                      {isPending && (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: AMBER }} />
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
