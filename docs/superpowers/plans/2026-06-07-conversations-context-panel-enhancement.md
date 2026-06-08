# Conversations Context Panel Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Conversations AI left panel into a triage-style summary and a drawer-style contact detail, both populated entirely from the in-memory `ChatDataset` (no live fetches, no AI tool calls).

**Architecture:** A new pure-logic module `lib/conversations-panel.ts` owns the panel state types and three builder functions (`computeContactUrgency`, `buildSummaryState`, `buildContactState`). `conversations-context-panel.tsx` becomes presentation-only, importing types from that module. `conversations-chat.tsx` calls the builders to set panel state and drops its live-fetch + progressive-hydration logic.

**Tech Stack:** Next.js 15 / React (client components), TypeScript, Tailwind v3, lucide-react. No test framework in repo — verification is `npx tsc --noEmit` + visual check via `npm run dev`.

---

## Notes for the implementer

- **No unit tests exist in this project** and CLAUDE.md says not to add a framework. "Verify" steps use the TypeScript compiler and the running app, not test runners.
- **Type check command** (used throughout): `npx tsc --noEmit -p tsconfig.json` — expected output: no errors (exit 0). `next.config.mjs` ignores TS errors at build time, so `tsc` is the real gate.
- **Commits:** the working branch is `main` with unrelated uncommitted changes already present. Before committing, confirm with the user (repo policy: commit only when asked; branch first if on default). Commit steps below stage **only the files each task touches**.
- The panel bars (urgency, channels) are plain `<div>` bars, **not** Recharts charts — so the project's "every chart needs a drill-down drawer / NonZeroTooltipContent" rule does not apply here.

## File Structure

- **Create** `lib/conversations-panel.ts` — panel state types + pure builders. One responsibility: turn dataset + ids into `PanelState`.
- **Modify** `components/dashboard/conversations-context-panel.tsx` — render the new summary (triage) and contact (drawer-style) states. Imports types from `lib/conversations-panel.ts`. Presentation only.
- **Modify** `components/dashboard/conversations-chat.tsx` — import builders, replace `handleContactClick` async fetch with sync `buildContactState`, simplify `onToolExecuted`, drop unused fetcher imports.

Current panel state types live **inside** `conversations-context-panel.tsx` and are imported by `conversations-chat.tsx`. This plan **moves the types to `lib/conversations-panel.ts`** so both the component and the chat container import them from one place (no import cycle: panel→lib types, chat→lib + panel).

---

## Task 1: Create the panel-logic module with types

**Files:**
- Create: `lib/conversations-panel.ts`

- [ ] **Step 1: Create the module with types and the urgency helper**

```ts
// lib/conversations-panel.ts
import type {
  Contact,
  Message,
  MessageChannel,
  Opportunity,
  Appointment,
  Pauta,
} from "@/lib/types";
import type { ChatDataset } from "@/lib/ai-tools";

// ─── Shared bits ────────────────────────────────────────────────────────────

export type UrgencyBucket = "red" | "yellow" | "grey" | "none";

export interface ContactUrgency {
  channel?: MessageChannel | "system";
  lastActivityAt?: string;
  unanswered: boolean;
  bucket: UrgencyBucket;
}

// ─── Panel state types (moved here from the component) ───────────────────────

export interface PanelContact {
  id: string;
  name: string;
  source?: string;
  assignedTo?: string;
  tags?: string[];
  lastActivity?: string;
  // enriched (optional — absent when contact not in the in-memory dataset)
  channel?: MessageChannel | "system";
  lastActivityAt?: string;
  unanswered?: boolean;
  urgency?: UrgencyBucket;
}

export interface SummaryGroup {
  key: string;
  count: number;
  sum?: number;
}

export interface PanelOpportunity {
  id: string;
  name: string;
  pipelineName: string;
  stage: string;
  status: string;
  value: number;
  currency?: string;
}

export interface PanelAppointment {
  id: string;
  title?: string;
  startTime: string;
  status: string;
}

export interface PanelPauta {
  id: string;
  nombrePauta: string;
  tipo?: string;
  createdAt: string;
}

export interface PanelMessage {
  direction: "inbound" | "outbound";
  source: string;
  content?: string;
  createdAt: string;
}

export interface PanelContactInfo extends PanelContact {
  email?: string;
  phone?: string;
  companyName?: string;
  createdAt?: string;
  adType?: string;
}

export type PanelState =
  | { mode: "idle" }
  | {
      mode: "summary";
      query?: string;
      title?: string;
      contacts: PanelContact[];
      groups?: SummaryGroup[];
      total: number;
      valueAtRisk?: number;
      urgency?: { red: number; yellow: number; grey: number };
      channels?: { key: string; count: number }[];
    }
  | {
      mode: "contact";
      contact: PanelContactInfo;
      status?: string;
      opportunities: PanelOpportunity[];
      appointments: PanelAppointment[];
      pautas: PanelPauta[];
      lastInbound: PanelMessage | null;
      lastOutbound: PanelMessage | null;
      messageCount: number;
      prevSummary?: Extract<PanelState, { mode: "summary" }>;
    };

// ─── Urgency ─────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;

export function computeContactUrgency(
  contactId: string,
  messages: Message[],
): ContactUrgency {
  const msgs = messages
    .filter((m) => m.contactId === contactId && m.kind !== "activity")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = msgs[0];
  if (!last) return { unanswered: false, bucket: "none" };

  const unanswered = last.direction === "inbound";
  const ageH = (Date.now() - new Date(last.createdAt).getTime()) / HOUR;
  let bucket: UrgencyBucket = "grey";
  if (unanswered) {
    if (ageH > 72) bucket = "red";
    else if (ageH >= 24) bucket = "yellow";
    else bucket = "grey";
  }
  return {
    channel: last.source,
    lastActivityAt: last.createdAt,
    unanswered,
    bucket,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (exit 0).

- [ ] **Step 3: Commit** (after confirming with user — see "Notes")

```bash
git add lib/conversations-panel.ts
git commit -m "feat: add conversations-panel logic module with urgency helper"
```

---

## Task 2: Add `buildSummaryState` and `buildContactState`

**Files:**
- Modify: `lib/conversations-panel.ts`

- [ ] **Step 1: Append the two builders to `lib/conversations-panel.ts`**

```ts
// ─── Summary builder ──────────────────────────────────────────────────────────

const URGENCY_RANK: Record<UrgencyBucket, number> = {
  red: 0,
  yellow: 1,
  grey: 2,
  none: 3,
};

interface BuildSummaryOpts {
  title?: string;
  query?: string;
  total?: number;
  groups?: SummaryGroup[];
}

export function buildSummaryState(
  contacts: PanelContact[],
  dataset: ChatDataset,
  opts: BuildSummaryOpts = {},
): Extract<PanelState, { mode: "summary" }> {
  // Enrich each contact with urgency/channel from in-memory messages.
  const enriched: PanelContact[] = contacts.map((c) => {
    const u = computeContactUrgency(c.id, dataset.messages);
    return {
      ...c,
      channel: u.channel,
      lastActivityAt: u.lastActivityAt,
      unanswered: u.unanswered,
      urgency: u.bucket,
    };
  });

  enriched.sort((a, b) => {
    const r = URGENCY_RANK[a.urgency ?? "none"] - URGENCY_RANK[b.urgency ?? "none"];
    if (r !== 0) return r;
    // within a bucket, oldest activity first (most urgent)
    return (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? "");
  });

  const urgency = { red: 0, yellow: 0, grey: 0 };
  for (const c of enriched) {
    if (c.urgency === "red") urgency.red++;
    else if (c.urgency === "yellow") urgency.yellow++;
    else if (c.urgency === "grey") urgency.grey++;
  }
  const anyMessages = enriched.some((c) => c.urgency && c.urgency !== "none");

  const channelCounts = new Map<string, number>();
  for (const c of enriched) {
    if (!c.channel || c.channel === "system") continue;
    channelCounts.set(c.channel, (channelCounts.get(c.channel) ?? 0) + 1);
  }
  const channels = Array.from(channelCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const idSet = new Set(enriched.map((c) => c.id));
  const valueAtRisk = dataset.opportunities
    .filter((o) => idSet.has(o.contactId) && o.status === "open")
    .reduce((s, o) => s + (typeof o.value === "number" ? o.value : 0), 0);

  return {
    mode: "summary",
    title: opts.title,
    query: opts.query,
    contacts: enriched,
    groups: opts.groups,
    total: opts.total ?? enriched.length,
    valueAtRisk: valueAtRisk > 0 ? valueAtRisk : undefined,
    urgency: anyMessages ? urgency : undefined,
    channels: channels.length > 0 ? channels : undefined,
  };
}

// ─── Contact builder ──────────────────────────────────────────────────────────

export function buildContactState(
  contactId: string,
  dataset: ChatDataset,
  prevSummary?: Extract<PanelState, { mode: "summary" }>,
): Extract<PanelState, { mode: "contact" }> {
  const c: Contact | undefined = dataset.contacts.find((x) => x.id === contactId);

  const opportunities: PanelOpportunity[] = dataset.opportunities
    .filter((o) => o.contactId === contactId)
    .map((o) => ({
      id: o.id,
      name: o.name,
      pipelineName: o.pipelineName,
      stage: o.stage,
      status: o.status,
      value: o.value,
      currency: o.currency || undefined,
    }));

  const appointments: PanelAppointment[] = dataset.appointments
    .filter((a) => a.contactId === contactId)
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .map((a) => ({
      id: a.id,
      title: a.title || undefined,
      startTime: a.startTime,
      status: a.status,
    }));

  const pautas: PanelPauta[] = dataset.pautas
    .filter((p) => p.contactId === contactId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({
      id: p.id,
      nombrePauta: p.nombrePauta,
      tipo: p.tipo || undefined,
      createdAt: p.createdAt,
    }));

  const msgs = dataset.messages
    .filter((m) => m.contactId === contactId && m.kind !== "activity")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const toPanelMsg = (m: (typeof msgs)[number]): PanelMessage => ({
    direction: m.direction,
    source: m.source,
    content: m.content,
    createdAt: m.createdAt,
  });
  const lastInbound = msgs.find((m) => m.direction === "inbound");
  const lastOutbound = msgs.find((m) => m.direction === "outbound");

  return {
    mode: "contact",
    contact: {
      id: contactId,
      name: c?.name || c?.email || c?.phone || contactId,
      source: c?.source || undefined,
      assignedTo: c?.assignedTo || undefined,
      tags: c?.tags?.length ? c.tags : undefined,
      email: c?.email || undefined,
      phone: c?.phone || undefined,
      companyName: c?.companyName || undefined,
      createdAt: c?.createdAt || undefined,
      adType: c?.adType || undefined,
    },
    status: opportunities[0]?.status,
    opportunities,
    appointments,
    pautas,
    lastInbound: lastInbound ? toPanelMsg(lastInbound) : null,
    lastOutbound: lastOutbound ? toPanelMsg(lastOutbound) : null,
    messageCount: msgs.length,
    prevSummary,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (`conversations-context-panel.tsx` / `conversations-chat.tsx` still define their own old `PanelState` — that's fine; this module is self-contained until Task 3/4 swap them over.)

- [ ] **Step 3: Commit** (after confirming with user)

```bash
git add lib/conversations-panel.ts
git commit -m "feat: add summary + contact panel state builders"
```

---

## Task 3: Rewrite the context panel to render the new states

**Files:**
- Modify: `components/dashboard/conversations-context-panel.tsx`

- [ ] **Step 1: Replace the type block with imports from the logic module**

Delete the local `PanelContact`, `SummaryGroup`, `PanelTask`, `PanelNote`, `PanelOpportunity`, `PanelAppointment`, `PanelLastMessage`, and `PanelState` declarations (lines ~7-86). Replace the top of the file with:

```tsx
"use client";

import { ExternalLink, Clock, ArrowLeft, Calendar, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  PanelState,
  PanelContact,
  UrgencyBucket,
} from "@/lib/conversations-panel";

export type {
  PanelState,
  PanelContact,
} from "@/lib/conversations-panel";
```

(Re-exporting keeps `conversations-chat.tsx`'s existing `import { ... } from "@/components/dashboard/conversations-context-panel"` working until Task 4 points it at the module directly.)

- [ ] **Step 2: Keep the existing helpers, add channel + urgency helpers**

Keep `initials`, `relativeTime`, `formatDate`. Remove `isOverdue` (tasks are gone). Add:

```tsx
const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_chat: "Google Chat",
  call: "Llamada",
  webchat: "Web Chat",
  live_chat: "Live Chat",
  tiktok: "TikTok",
  review: "Reseña",
  form_submission: "Formulario",
  other: "Otro",
};

function channelLabel(source?: string): string {
  if (!source) return "";
  return CHANNEL_LABELS[source] ?? source;
}

const URGENCY_DOT: Record<UrgencyBucket, string> = {
  red: "bg-destructive",
  yellow: "bg-amber-500",
  grey: "bg-muted-foreground/50",
  none: "bg-transparent",
};

const URGENCY_BADGE: Record<UrgencyBucket, string> = {
  red: "bg-destructive/15 text-destructive",
  yellow: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  grey: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};
```

- [ ] **Step 3: Keep the outer `ConversationsContextPanel` wrapper and `IdlePanel` unchanged**

The wrapper (lines ~131-159) and `IdlePanel` stay as-is. Only `SummaryPanel` and `ContactPanel` bodies change (next steps).

- [ ] **Step 4: Replace `SummaryPanel` with the triage version**

```tsx
function SummaryPanel({
  state,
  onContactClick,
}: {
  state: Extract<PanelState, { mode: "summary" }>;
  onContactClick?: (c: PanelContact) => void;
}) {
  const total = state.total;
  const channelTotal = (state.channels ?? []).reduce((s, c) => s + c.count, 0);
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-foreground">
          {state.title ?? "Resumen"} · {total} {total === 1 ? "contacto" : "contactos"}
        </p>
        {state.query && (
          <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
            {state.query}
          </p>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2.5 p-3">
          {/* Urgency */}
          {state.urgency && (
            <div className="rounded-md border border-border/50 bg-background p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Urgencia
              </p>
              <div className="mb-2.5 flex gap-1.5">
                {state.urgency.red > 0 && (
                  <div className="h-1.5 rounded-full bg-destructive" style={{ flex: state.urgency.red }} />
                )}
                {state.urgency.yellow > 0 && (
                  <div className="h-1.5 rounded-full bg-amber-500" style={{ flex: state.urgency.yellow }} />
                )}
                {state.urgency.grey > 0 && (
                  <div className="h-1.5 rounded-full bg-muted-foreground/40" style={{ flex: state.urgency.grey }} />
                )}
              </div>
              <div className="space-y-1">
                <UrgencyRow color="bg-destructive" count={state.urgency.red} label="sin respuesta +3d" />
                <UrgencyRow color="bg-amber-500" count={state.urgency.yellow} label="+24h" />
                <UrgencyRow color="bg-muted-foreground/50" count={state.urgency.grey} label="recientes" />
              </div>
            </div>
          )}

          {/* Value at risk + channels */}
          <div className="flex gap-2">
            {state.valueAtRisk !== undefined && state.valueAtRisk > 0 && (
              <div className="flex-1 rounded-md border border-border/50 bg-background p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  En riesgo
                </p>
                <p className="mt-0.5 text-sm font-bold tabular-nums">
                  ${state.valueAtRisk.toLocaleString("es-MX")}
                </p>
              </div>
            )}
            {state.channels && state.channels.length > 0 && (
              <div className="flex-1 rounded-md border border-border/50 bg-background p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Canales
                </p>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  {state.channels.map((c, i) => (
                    <div
                      key={c.key}
                      className={cn("h-full", CHANNEL_BAR[i % CHANNEL_BAR.length])}
                      style={{ width: `${channelTotal ? (c.count / channelTotal) * 100 : 0}%` }}
                    />
                  ))}
                </div>
                <p className="mt-1.5 truncate text-[9px] text-muted-foreground">
                  {state.channels.slice(0, 3).map((c) => channelLabel(c.key)).join(" · ")}
                </p>
              </div>
            )}
          </div>

          {/* Aggregate groups (unchanged behavior) */}
          {state.groups && state.groups.length > 0 && (
            <div className="rounded-md border border-border/50 bg-background p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Distribución
              </p>
              <div className="space-y-1.5">
                {state.groups.slice(0, 8).map((g) => (
                  <div key={g.key} className="flex items-center justify-between">
                    <span className="max-w-[60%] truncate text-xs text-muted-foreground">{g.key}</span>
                    <span className="text-xs font-medium tabular-nums">
                      {g.sum !== undefined ? `$${g.sum.toLocaleString("es-MX")}` : g.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact list */}
          {state.contacts.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {state.urgency ? "Más urgentes" : "Contactos"}
              </p>
              {state.contacts.slice(0, 10).map((c) => {
                const bucket = c.urgency ?? "none";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onContactClick?.(c)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                      {initials(c.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                        <span className="truncate">{c.name}</span>
                        {bucket !== "none" && bucket !== "grey" && (
                          <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", URGENCY_DOT[bucket])} />
                        )}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {c.channel && c.channel !== "system"
                          ? `${channelLabel(c.channel)}${c.unanswered ? " · sin respuesta" : ""}`
                          : c.source ?? c.assignedTo ?? ""}
                      </p>
                    </div>
                    {c.lastActivityAt ? (
                      <span className={cn("flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold", URGENCY_BADGE[bucket])}>
                        {relativeTime(c.lastActivityAt)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/60">→</span>
                    )}
                  </button>
                );
              })}
              {state.contacts.length > 10 && (
                <p className="px-2 pt-1 text-center text-[10px] text-primary">
                  Ver los {state.contacts.length} →
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

const CHANNEL_BAR = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-pink-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-muted-foreground/50",
];

function UrgencyRow({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      <span className="font-semibold tabular-nums">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Replace `ContactPanel` with the drawer-style version**

```tsx
function ContactPanel({
  state,
  locationId,
  onBack,
}: {
  state: Extract<PanelState, { mode: "contact" }>;
  locationId?: string;
  onBack?: () => void;
}) {
  const { contact, opportunities, appointments, pautas, lastInbound, lastOutbound, messageCount } = state;
  const primaryOpp = opportunities[0];
  const contactUrl = locationId
    ? `https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`
    : undefined;
  const oppUrl = locationId && primaryOpp
    ? `https://login.lezgosuite.com/v2/location/${locationId}/opportunities/${primaryOpp.id}?tab=Opportunity+Details`
    : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        {state.prevSummary && (
          <button
            type="button"
            onClick={onBack}
            className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver
          </button>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
              {initials(contact.name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{contact.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {[channelLabel(contact.channel), contact.assignedTo].filter(Boolean).join(" · ") ||
                  contact.source ||
                  ""}
              </p>
            </div>
          </div>
          {state.status && (
            <Chip
              className={cn(
                "flex-shrink-0 capitalize",
                state.status === "won" && "bg-green-100 text-green-800",
                state.status === "lost" && "bg-red-100 text-red-800",
                state.status === "open" && "bg-yellow-100 text-yellow-800",
              )}
            >
              {state.status}
            </Chip>
          )}
        </div>
        {contact.tags && contact.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {contact.tags.slice(0, 6).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        )}
      </div>

      {/* Sections */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {/* Opportunity */}
          {primaryOpp && (
            <Section label="Oportunidad">
              <div className="rounded-md border border-border/50 bg-background p-2.5">
                <p className="text-sm font-bold">
                  ${primaryOpp.value.toLocaleString("es-MX")}
                  {primaryOpp.currency ? ` ${primaryOpp.currency}` : ""}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{primaryOpp.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Chip>{primaryOpp.pipelineName}</Chip>
                  <Chip>{primaryOpp.stage}</Chip>
                </div>
              </div>
            </Section>
          )}

          {/* Contact info */}
          <Section label="Contacto">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-md border border-border/50 bg-background p-2.5">
              <InfoCell label="Email" value={contact.email || "—"} />
              <InfoCell label="Teléfono" value={contact.phone || "—"} />
              <InfoCell
                label="Registro"
                value={contact.createdAt ? formatDate(contact.createdAt) : "—"}
              />
              <InfoCell label="Medio" value={contact.adType || "—"} />
            </div>
          </Section>

          {/* Appointments */}
          {appointments.length > 0 && (
            <Section label="Citas">
              <div className="space-y-1.5">
                {appointments.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 rounded-md border border-border/50 bg-background p-2.5"
                  >
                    <Calendar className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{a.title ?? "Cita"}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(a.startTime)}</p>
                    </div>
                    <Chip className="flex-shrink-0">{a.status}</Chip>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Pautas */}
          {pautas.length > 0 && (
            <Section label="Pautas">
              <div className="space-y-1.5">
                {pautas.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 rounded-md border border-border/50 bg-background p-2.5"
                  >
                    <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {p.nombrePauta.split(" - ")[0] || p.nombrePauta}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        {p.tipo && <Chip>{p.tipo}</Chip>}
                        <span className="text-[10px] text-muted-foreground">{formatDate(p.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Conversation snippet */}
          {messageCount > 0 && (
            <Section label={`Conversación · ${messageCount} mensaje${messageCount !== 1 ? "s" : ""}`}>
              <div className="space-y-1.5">
                {lastInbound && <MsgCard msg={lastInbound} label="Lead" inbound />}
                {lastOutbound && <MsgCard msg={lastOutbound} label="Nosotros" />}
                {lastInbound && !lastOutbound && (
                  <p className="px-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠ Sin respuesta del asesor
                  </p>
                )}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      {/* Footer links */}
      {(contactUrl || oppUrl) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5">
          {contactUrl && (
            <a href={contactUrl} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1.5 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />
              Ver contacto
            </a>
          )}
          {oppUrl && (
            <a href={oppUrl} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1.5 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />
              Ver oportunidad
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium">{value}</p>
    </div>
  );
}

function MsgCard({ msg, label, inbound }: { msg: { source: string; content?: string; createdAt: string }; label: string; inbound?: boolean }) {
  return (
    <div className="rounded-md border border-border/50 bg-background p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className={cn("text-[10px] font-semibold", inbound ? "text-sky-600 dark:text-sky-400" : "text-primary")}>
          {inbound ? "↙ " : "↗ "}{label}
        </span>
        <span className="text-[10px] text-muted-foreground">{relativeTime(msg.createdAt)}</span>
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed">{msg.content ?? "(sin contenido)"}</p>
    </div>
  );
}
```

- [ ] **Step 6: Keep `Section` and `Chip` helpers** (bottom of file, unchanged).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `conversations-chat.tsx` (it still builds the OLD panel state shapes — `tasks`/`notes`/`lastMessage`). That is expected and fixed in Task 4. The panel file itself must have **no** errors.

- [ ] **Step 8: Commit** (after confirming with user)

```bash
git add components/dashboard/conversations-context-panel.tsx lib/conversations-panel.ts
git commit -m "feat: triage summary + drawer-style contact in context panel"
```

---

## Task 4: Wire `conversations-chat.tsx` to the builders

**Files:**
- Modify: `components/dashboard/conversations-chat.tsx`

- [ ] **Step 1: Fix imports**

Replace the panel-type import block (lines ~42-51) and the fetcher import (lines ~23-27) with:

```tsx
import {
  buildSummaryState,
  buildContactState,
  type PanelState,
  type PanelContact,
} from "@/lib/conversations-panel";
import { ConversationsContextPanel } from "@/components/dashboard/conversations-context-panel";
```

Remove the `import { fetchContactMessages, fetchContactTasks, fetchContactNotes } from "@/lib/ghl-fetchers";` block entirely. Remove the now-unused `import type { Contact } from "@/lib/types";` only if `contactById`/`panelContactFromId` no longer reference it — `panelContactFromId` does, so **keep** the `Contact` import.

- [ ] **Step 2: Simplify `onToolExecuted`**

Replace the entire `onToolExecuted` callback (lines ~127-356) with this version. It routes multi-contact results through `buildSummaryState` and single-contact focus through `buildContactState`, and drops the `get_contact_related` / `get_contact_tasks` / `get_contact_notes` panel branches:

```tsx
  const onToolExecuted = useCallback(
    (name: string, input: Record<string, unknown>, result: unknown) => {
      const r = result as Record<string, unknown>;

      const setSummary = (contacts: PanelContact[], opts: { title?: string; total?: number; groups?: { key: string; count: number; sum?: number }[] } = {}) => {
        const summary = buildSummaryState(contacts, dataset, opts);
        prevSummaryRef.current = summary;
        setPanelState(summary);
      };

      const focusContact = (id: string) => {
        setPanelState((prev) =>
          buildContactState(
            id,
            dataset,
            prev.mode === "summary" ? prev : prevSummaryRef.current ?? undefined,
          ),
        );
      };

      if (name === "show_in_panel") {
        const ids = Array.isArray(input.contactIds) ? (input.contactIds as string[]).map(String) : [];
        const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined;
        if (ids.length === 1) return focusContact(ids[0]);
        setSummary(ids.map((id) => panelContactFromId(id, contactById)), { title, total: ids.length });
        return;
      }

      if (name === "search_contacts") {
        const rows = Array.isArray(r?.rows) ? (r.rows as Record<string, unknown>[]) : [];
        if (rows.length > 1) {
          setSummary(rows.map(buildPanelContact), {
            total: typeof r.returned === "number" ? r.returned : rows.length,
          });
        } else if (rows.length === 1) {
          focusContact(String(rows[0].id ?? ""));
        }
        return;
      }

      if (name === "aggregate") {
        const groups = Array.isArray(r?.groups) ? (r.groups as Record<string, unknown>[]) : [];
        const summary = buildSummaryState([], dataset, {
          total: typeof r.total === "number" ? r.total : 0,
          groups: groups.map((g) => ({
            key: String(g.key ?? ""),
            count: typeof g.count === "number" ? g.count : 0,
            sum: typeof g.sum === "number" ? g.sum : undefined,
          })),
        });
        prevSummaryRef.current = summary;
        setPanelState(summary);
        return;
      }

      if (name === "search_conversations") {
        const threads = Array.isArray(r?.threads) ? (r.threads as Record<string, unknown>[]) : [];
        const contacts = threads.map((t) => panelContactFromId(String(t.contactId ?? ""), contactById));
        if (contacts.length === 1) return focusContact(contacts[0].id);
        setSummary(contacts, { total: typeof r.returned === "number" ? r.returned : threads.length });
        return;
      }

      if (name === "get_contact") {
        const c = r as Record<string, unknown>;
        focusContact(String(c.id ?? ""));
        return;
      }
    },
    [contactById, dataset],
  );
```

- [ ] **Step 3: Simplify `handleContactClick`**

Replace the whole `handleContactClick` callback (lines ~423-524) with a synchronous version:

```tsx
  const handleContactClick = useCallback(
    (contact: PanelContact) => {
      setPanelState((prev) =>
        buildContactState(
          contact.id,
          dataset,
          prev.mode === "summary" ? prev : prevSummaryRef.current ?? undefined,
        ),
      );
    },
    [dataset],
  );
```

- [ ] **Step 4: Remove now-unused imports/types**

After steps 1-3, these are no longer referenced and must be removed to keep `tsc` clean:
- the `PanelOpportunity`, `PanelAppointment`, `PanelTask`, `PanelNote`, `PanelLastMessage` type imports (gone in step 1 already).
- Confirm `buildPanelContact` and `panelContactFromId` are still used (they are — keep them).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (exit 0) across the whole project.

- [ ] **Step 6: Check for dead code**

Run: `grep -rn "ghl-fetchers" components/dashboard/conversations-chat.tsx`
Expected: no matches. If `lib/ghl-fetchers.ts` is now unreferenced anywhere, leave it in place (other code or the AIChatPanel may use it) — verify with `grep -rn "ghl-fetchers" --include=*.ts --include=*.tsx .` and only note the result; do not delete in this plan.

- [ ] **Step 7: Commit** (after confirming with user)

```bash
git add components/dashboard/conversations-chat.tsx
git commit -m "feat: drive context panel from in-memory dataset, drop live fetches"
```

---

## Task 5: Visual verification in the running app

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server on http://localhost:3000, no compile errors in the terminal.

- [ ] **Step 2: Verify the summary (triage) state**

In the Conversations tab, ask the AI something that returns multiple contacts (e.g. "¿Qué leads de Meta no han respondido en más de 24h?"). Confirm:
- Urgencia card shows the 3-segment bar + red/yellow/grey counts.
- En riesgo + Canales cards render side by side.
- Contact rows show urgency dot + channel subtitle + time badge, most-urgent first.

- [ ] **Step 3: Verify the contact state (from memory, no network)**

Open DevTools → Network. Click a contact row in the summary. Confirm:
- The panel shows Oportunidad / Contacto / Citas / Pautas / Conversación sourced from data already loaded.
- **No new XHR/fetch** to `/api/contact-tasks`, `/api/contact-notes`, or `/api/conversations` fires on click.
- Footer shows Ver contacto (+ Ver oportunidad when an opp exists).

- [ ] **Step 4: Verify empty-section handling**

Click a contact with no opportunity/appointments/pautas/messages. Confirm those sections are omitted (only Contacto grid shows) and nothing errors.

- [ ] **Step 5: Verify back navigation**

From a contact opened via the summary list, click "Volver" → returns to the summary state with its urgency/channels intact.

---

## Self-Review (completed by plan author)

- **Spec coverage:** Summary triage (urgency/channels/value/sorted rows) → Task 1-3. Contact drawer-style from memory → Task 1-3. No live fetches / no AI panel hydration → Task 4. Type changes → Task 1. New module → Task 1-2. ✅
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `PanelState`, `PanelContact`, `buildSummaryState`, `buildContactState`, `computeContactUrgency`, `UrgencyBucket` names match across Tasks 1-4. Summary builder signature `(contacts, dataset, opts)` and contact builder `(contactId, dataset, prevSummary?)` are used consistently in Task 4.
