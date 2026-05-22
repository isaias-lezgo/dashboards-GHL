"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Activity } from "lucide-react"
import { useEffect, useState } from "react"

interface LoadingScreenProps {
  progress: string
}

const NODE_COUNT = 6
const RING_RADII = [80, 130, 180]

const orbitAngles = [0, 60, 120, 180, 240, 300]

function OrbitDot({
  radius,
  angle,
  duration,
  delay,
  color,
}: {
  radius: number
  angle: number
  duration: number
  delay: number
  color: string
}) {
  const rad = (angle * Math.PI) / 180
  const x = Math.cos(rad) * radius
  const y = Math.sin(rad) * radius

  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: 8,
        height: 8,
        backgroundColor: color,
        left: "50%",
        top: "50%",
        marginLeft: -4,
        marginTop: -4,
      }}
      animate={{
        x: [
          Math.cos((angle * Math.PI) / 180) * radius,
          Math.cos(((angle + 180) * Math.PI) / 180) * radius,
          Math.cos((angle * Math.PI) / 180) * radius,
        ],
        y: [
          Math.sin((angle * Math.PI) / 180) * radius,
          Math.sin(((angle + 180) * Math.PI) / 180) * radius,
          Math.sin((angle * Math.PI) / 180) * radius,
        ],
        opacity: [0.3, 1, 0.3],
        scale: [0.8, 1.4, 0.8],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  )
}

function DataBar({ index, delay }: { index: number; delay: number }) {
  return (
    <motion.div
      className="w-1.5 rounded-full bg-primary"
      style={{ originY: 1 }}
      animate={{ scaleY: [0.2, 1, 0.4, 0.8, 0.2] }}
      transition={{
        duration: 1.4,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  )
}

export function LoadingScreen({ progress }: LoadingScreenProps) {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    if (progress && !messages.includes(progress)) {
      setMessages((prev) => [...prev.slice(-3), progress])
    }
  }, [progress])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Radial glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 500,
          height: 500,
          background:
            "radial-gradient(circle, hsl(var(--primary) / 0.12) 0%, transparent 70%)",
        }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Orbit rings */}
      <div className="relative flex items-center justify-center" style={{ width: 400, height: 400 }}>
        {RING_RADII.map((r, i) => (
          <motion.div
            key={r}
            className="absolute rounded-full border border-primary/20"
            style={{ width: r * 2, height: r * 2 }}
            animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
            transition={{
              duration: 12 + i * 6,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}

        {/* Orbiting dots */}
        {orbitAngles.slice(0, NODE_COUNT).map((angle, i) => (
          <OrbitDot
            key={`outer-${i}`}
            radius={180}
            angle={angle}
            duration={2 + (i % 3) * 0.5}
            delay={i * 0.3}
            color="hsl(var(--primary))"
          />
        ))}
        {orbitAngles.slice(0, 4).map((angle, i) => (
          <OrbitDot
            key={`mid-${i}`}
            radius={130}
            angle={angle + 30}
            duration={1.8 + (i % 2) * 0.4}
            delay={i * 0.2}
            color="hsl(var(--primary) / 0.6)"
          />
        ))}
        {[0, 120, 240].map((angle, i) => (
          <OrbitDot
            key={`inner-${i}`}
            radius={80}
            angle={angle + 15}
            duration={1.5 + i * 0.3}
            delay={i * 0.15}
            color="hsl(var(--primary) / 0.4)"
          />
        ))}

        {/* Center logo */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
          <motion.div
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-2xl"
            animate={{
              boxShadow: [
                "0 0 0 0px hsl(var(--primary) / 0.4)",
                "0 0 0 12px hsl(var(--primary) / 0)",
              ],
            }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          >
            <Activity className="h-8 w-8 text-white" />
          </motion.div>

          {/* Equalizer bars */}
          <div className="flex items-end gap-1" style={{ height: 24 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <DataBar key={i} index={i} delay={i * 0.15} />
            ))}
          </div>
        </div>
      </div>

      {/* Text content below orbit */}
      <div className="mt-6 flex flex-col items-center gap-4">
        <div className="text-center">
          <motion.h2
            className="text-xl font-bold text-foreground"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            GHL Analíticas
          </motion.h2>
          <motion.p
            className="mt-1 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Sincronizando datos con GoHighLevel…
          </motion.p>
        </div>

        {/* Progress messages */}
        <div className="flex h-8 flex-col items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            {progress && (
              <motion.div
                key={progress}
                className="rounded-full border border-border bg-card/80 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm"
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.25 }}
              >
                {progress}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
