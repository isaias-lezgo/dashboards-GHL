"use client"

// What the copilot shows while it works (a run takes 10–40 s): a little builder
// in a hard hat stacking a bar chart, a rotating joke, and — small, underneath —
// the real status ("Pensando…", "Creando 3 widgets…"), which is information the
// joke must not replace. Original drawing; the motion lives in app/globals.css
// (.bb-*) and stands still under prefers-reduced-motion.
import { useEffect, useState } from "react"

const PHRASES = [
  "Poniéndome el casco…",
  "Acomodando barritas…",
  "Midiendo dos veces, graficando una…",
  "Apretándole los tornillos al eje…",
  "Pidiéndole los números al CRM…",
  "Cuadrando los totales…",
  "Esta barra va un poquito más arriba…",
  "Echándole cemento a los datos…",
  "Revisando que nada quede chueco…",
  "Ya casi, nomás pinto la gráfica…",
]
const PHRASE_MS = 2800

const AMBER = "#F59B1B"
const AMBER_DARK = "#D9870F"
const SKIN = "#F4C7A1"
const INK = "#151B28"
const OVERALLS = "fill-[#335577] dark:fill-[#6d8fb3]"
const LEGS = "fill-[#26405a] dark:fill-[#5a7a9c]"

// A four-point sparkle centered on 0,0.
const SPARK = "M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1 Z"

export function BuilderBuddy({ status }: { status: string | null }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * PHRASES.length))
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % PHRASES.length), PHRASE_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 pb-2.5 pt-1.5">
      <svg viewBox="0 10 240 82" className="block h-auto w-full" aria-hidden>
        <line x1="4" x2="236" y1="86" y2="86" className="stroke-border" strokeWidth="1.5" strokeLinecap="round" />

        {/* The pile of blocks he takes from. */}
        <g fill={AMBER} stroke={AMBER_DARK} strokeWidth="0.8">
          <rect x="6" y="78" width="12" height="8" rx="1.5" />
          <rect x="19" y="78" width="12" height="8" rx="1.5" />
          <rect x="12.5" y="70" width="12" height="8" rx="1.5" />
        </g>

        {/* The chart he builds: each trip raises one bar. */}
        <g stroke={AMBER_DARK} strokeWidth="0.8">
          <rect className="bb-bar1" x="150" y="60" width="18" height="26" rx="2" fill={AMBER} fillOpacity="0.55" />
          <rect className="bb-bar2" x="174" y="46" width="18" height="40" rx="2" fill={AMBER} fillOpacity="0.8" />
          <rect className="bb-bar3" x="198" y="32" width="18" height="54" rx="2" fill={AMBER} />
        </g>
        <g transform="translate(159 54)"><path className="bb-spark1" d={SPARK} fill={AMBER} /></g>
        <g transform="translate(183 40)"><path className="bb-spark2" d={SPARK} fill={AMBER} /></g>
        <g transform="translate(207 18)"><path className="bb-spark3" d={SPARK} fill={AMBER} /></g>

        {/* The block that does not stay on the third bar. */}
        <rect className="bb-fall" x="198" y="24" width="18" height="8" rx="1.5" fill={AMBER} stroke={AMBER_DARK} strokeWidth="0.8" />
        <g className="bb-dust">
          <g className="fill-muted-foreground" opacity="0.45">
            <circle cx="223" cy="84" r="2" />
            <circle cx="229" cy="82" r="2.6" />
            <circle cx="235" cy="84" r="1.8" />
          </g>
        </g>
        <g className="bb-ups">
          <rect x="158" y="17" width="34" height="15" rx="7.5" className="fill-card stroke-border" strokeWidth="1" />
          <path d="M171 31.5 l3 5 l3 -5 z" className="fill-card" />
          <text x="175" y="27.6" textAnchor="middle" fontSize="9" fontWeight="700" className="fill-foreground">
            ¡Ups!
          </text>
        </g>

        {/* The builder, drawn around his feet at 0,0 facing right; .bb-worker walks and turns him. */}
        <g className="bb-worker">
          <rect className={`bb-leg-l ${LEGS}`} x="-4.6" y="-12" width="3.6" height="12" rx="1.6" />
          <rect className={`bb-leg-r ${LEGS}`} x="1" y="-12" width="3.6" height="12" rx="1.6" />
          <g className="bb-upper">
            <rect x="-6.5" y="-25" width="13" height="14" rx="3.5" className={OVERALLS} />
            <rect x="-3.2" y="-23" width="6.4" height="4.5" rx="1" fill="#fff" opacity="0.22" />
            <rect x="-6.5" y="-14.5" width="13" height="2" fill={AMBER_DARK} />
            <g className="bb-arms-down" stroke={SKIN} strokeWidth="2.6" strokeLinecap="round">
              <path d="M-5.6 -22.5 L-7.6 -14.5" />
              <path d="M5.6 -22.5 L7.6 -14.5" />
            </g>
            <circle cx="0" cy="-31" r="6" fill={SKIN} />
            <circle cx="2.7" cy="-31.6" r="0.9" fill={INK} />
            <path d="M1 -28.3 q1.7 1.2 3.4 0" stroke={INK} strokeWidth="0.8" fill="none" strokeLinecap="round" />
            {/* Hard hat */}
            <path d="M-6.4 -33 a6.4 6.4 0 0 1 12.8 0 z" fill={AMBER} />
            <rect x="-7.4" y="-33.8" width="16.4" height="2.1" rx="1" fill={AMBER_DARK} />
            <rect x="-0.8" y="-39.2" width="1.6" height="5.6" rx="0.8" fill="#FFD27A" />
            <g className="bb-carry">
              <g stroke={SKIN} strokeWidth="2.6" strokeLinecap="round">
                <path d="M-5.6 -23 L-6.4 -39.5" />
                <path d="M5.6 -23 L6.4 -39.5" />
              </g>
              <rect x="-8" y="-48" width="16" height="8" rx="1.5" fill={AMBER} stroke={AMBER_DARK} strokeWidth="0.8" />
            </g>
          </g>
        </g>
      </svg>
      <p key={i} className="bb-phrase text-center text-xs font-medium text-foreground/80" aria-hidden>
        {PHRASES[i]}
      </p>
      {status && (
        <p className="mt-0.5 text-center text-[11px] text-muted-foreground" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
