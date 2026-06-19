"use client"

import { motion, AnimatePresence } from "framer-motion"
import type { StepKey, StepMap } from "@/hooks/use-dashboard-data"

interface LoadingScreenProps {
  progress: string
  /** Name of the GHL sub-account being opened. Empty until resolved. */
  locationName?: string
  /** Live per-dataset progress. All datasets load concurrently. */
  steps?: StepMap
}

// Visible rows, in display order, with their Spanish labels. These mirror the
// concurrent fetches in /api/dashboard — each advances independently.
const STEP_ROWS: { key: StepKey; label: string }[] = [
  { key: "config", label: "Configuración" },
  { key: "contacts", label: "Contactos" },
  { key: "opportunities", label: "Oportunidades" },
  { key: "pautas", label: "Pautas" },
  { key: "appointments", label: "Citas" },
  { key: "tasks", label: "Tareas" },
]

const FALLBACK_STEPS: StepMap = {
  config: { status: "loading" },
  contacts: { status: "pending" },
  opportunities: { status: "pending" },
  pautas: { status: "pending" },
  appointments: { status: "pending" },
  tasks: { status: "pending" },
}

function SyncRing() {
  const size = 88
  const stroke = 2.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: [circumference, circumference * 0.25, circumference] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-[3px] rounded-full bg-primary"
            style={{ height: 14 }}
            animate={{ scaleY: [0.35, 1, 0.5, 0.85, 0.35] }}
            transition={{
              duration: 1.1,
              delay: i * 0.12,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </div>
  )
}

function StepRow({
  label,
  status,
  count,
  delay,
}: {
  label: string
  status: "pending" | "loading" | "done"
  count?: number
  delay: number
}) {
  const isDone = status === "done"
  const isActive = status === "loading"

  return (
    <motion.div
      className="flex items-center gap-3"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-300 ${
          isDone
            ? "bg-primary text-primary-foreground"
            : isActive
              ? "border-2 border-primary bg-primary/10 text-primary"
              : "border border-border bg-muted/50 text-muted-foreground"
        }`}
      >
        {isDone ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : isActive ? (
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-primary"
            animate={{ scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        ) : (
          <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
        )}
      </span>

      <span
        className={`flex-1 text-sm transition-colors duration-300 ${
          isActive ? "font-medium text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/60"
        }`}
      >
        {label}
      </span>

      {/* Live count: shows the running total while loading and the final total
          when done. Tabular numerals keep the column from jittering as digits
          change. */}
      <span className="min-w-[3.5rem] text-right text-xs tabular-nums">
        {count !== undefined && (isActive || isDone) ? (
          <motion.span
            key={`${status}-${count}`}
            className={isDone ? "font-medium text-foreground" : "text-muted-foreground"}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {count.toLocaleString("es-MX")}
          </motion.span>
        ) : isActive ? (
          <span className="text-muted-foreground/60">…</span>
        ) : null}
      </span>
    </motion.div>
  )
}

export function LoadingScreen({ progress, locationName, steps }: LoadingScreenProps) {
  const resolved = steps ?? FALLBACK_STEPS

  const total = STEP_ROWS.length
  const completed = STEP_ROWS.filter((s) => resolved[s.key].status === "done").length
  const pct = Math.round((completed / total) * 100)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      // Opaque from the first frame (no enter fade) so the empty dashboard
      // behind it never shows through on initial load / after login. The exit
      // fade still plays to reveal the populated dashboard once data arrives.
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/80" />

      <div className="flex w-full max-w-md flex-col items-center gap-10 px-8">
        <SyncRing />

        <div className="flex w-full flex-col items-center gap-6">
          <div className="text-center">
            <motion.h2
              className="text-2xl font-bold tracking-tight text-foreground"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}
            >
              Lezgo Suite Analíticas
            </motion.h2>
            <motion.p
              className="mt-2 text-sm text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.35 }}
            >
              Abriendo subcuenta
            </motion.p>
            {/* Skeleton → name pill swap. Deliberately NOT wrapped in
                AnimatePresence mode="wait": the placeholder's infinite-repeat
                opacity animation never fires an exit-complete callback, which
                deadlocks the presence swap so the pill never mounts. A plain
                conditional with a CSS-pulse skeleton unmounts cleanly the
                instant the sub-account name resolves. */}
            <div className="mt-3 flex min-h-[2rem] items-center justify-center">
              {locationName ? (
                <motion.span
                  key={locationName}
                  className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary"
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {locationName}
                </motion.span>
              ) : (
                <span className="h-7 w-40 animate-pulse rounded-full bg-muted" aria-hidden />
              )}
            </div>
          </div>

          <div className="w-full space-y-2.5">
            {STEP_ROWS.map((row, i) => {
              const s = resolved[row.key]
              return (
                <StepRow
                  key={row.key}
                  label={row.label}
                  status={s.status}
                  count={s.count}
                  delay={0.15 + i * 0.05}
                />
              )
            })}
          </div>

          {/* Determinate progress bar driven by completed-step count, so the
              user always sees how far along the sync is — not just motion. */}
          <div className="w-full space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <div className="flex min-h-[1.25rem] items-center justify-between text-xs text-muted-foreground">
              <AnimatePresence mode="wait">
                <motion.span
                  key={progress}
                  className="max-w-[70%] truncate"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  {progress || "Sincronizando…"}
                </motion.span>
              </AnimatePresence>
              <span className="tabular-nums">{pct}%</span>
            </div>
          </div>
        </div>
      </div>

      <motion.div
        className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-border"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <motion.div
          className="h-full w-1/3 bg-primary"
          animate={{ x: ["-100%", "400%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </motion.div>
  )
}
