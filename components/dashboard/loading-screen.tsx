"use client"

import { motion, AnimatePresence } from "framer-motion"

interface LoadingScreenProps {
  progress: string
}

const SYNC_STEPS = [
  "Pipelines",
  "Contactos",
  "Oportunidades",
  "Pautas",
  "Citas",
] as const

function normalizeProgress(message: string): string {
  return message
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
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

function stepFromMessage(message: string): number {
  const lower = normalizeProgress(message)
  if (lower.includes("pipeline") || lower.includes("configuracion") || lower.includes("sincroniz")) return 0
  if (lower.includes("contacto")) return 1
  if (lower.includes("oportunidad")) return 2
  if (lower.includes("pauta") || lower.includes("procesando")) return 3
  if (lower.includes("citas") || /\bcita\b/.test(lower)) return 4
  return 0
}

export function LoadingScreen({ progress }: LoadingScreenProps) {
  const activeStep = stepFromMessage(progress)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
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
              Sincronizando datos con Lezgo Suite
            </motion.p>
          </div>

          <div className="w-full space-y-2">
            {SYNC_STEPS.map((label, i) => {
              const isDone = activeStep > i
              const isActive = activeStep === i
              return (
                <motion.div
                  key={label}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.3 }}
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
                    className={`text-sm transition-colors duration-300 ${
                      isActive ? "font-medium text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/60"
                    }`}
                  >
                    {label}
                  </span>
                </motion.div>
              )
            })}
          </div>

          <div className="flex min-h-[2.25rem] w-full flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              {progress && (
                <motion.p
                  key={progress}
                  className="max-w-full truncate text-center text-xs text-muted-foreground"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  {progress}
                </motion.p>
              )}
            </AnimatePresence>
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
