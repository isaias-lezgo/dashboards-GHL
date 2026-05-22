# Sales Dashboard — Conversation Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two charts to the sales dashboard — "Conversaciones únicas por día" and "Tiempo promedio de respuesta del asesor" — backed by a richer conversation fetch (last 30 conversations instead of first 5 contacts).

**Architecture:** Expand the existing message fetch in `route.ts` to pull the 30 most recent conversations directly, enriching each `Message` with `conversationId` and `assignedTo` from the conversation. Both charts compute client-side via `useMemo` in `sales-dashboard.tsx`.

**Tech Stack:** Next.js 15 App Router, React, Recharts, shadcn/ui, TypeScript, GHL REST API

---

## File Map

| File | Change |
|------|--------|
| `lib/types.ts` | Add `conversationId?: string` to `Message` interface |
| `lib/ghl-message-mapper.ts` | Add optional `extra` param (`conversationId`, `assignedTo`) passed through to returned `Message` |
| `app/api/dashboard/route.ts` | Replace first-5-contacts loop with direct 30-conversation fetch |
| `components/dashboard/sales-dashboard.tsx` | Add helper functions, two `useMemo`s, one new section, two new charts |

---

## Task 1: Add `conversationId` to `Message` type and update the mapper

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/ghl-message-mapper.ts`

- [ ] **Step 1: Add `conversationId` field to `Message` in `lib/types.ts`**

Open `lib/types.ts`. Find the `Message` interface (line ~84) and add the field after `contactId`:

```typescript
export interface Message {
  id: string
  contactId: string
  conversationId?: string        // ← add this line
  assignedTo?: string
  direction: "inbound" | "outbound"
  kind?: "message" | "activity"
  source: MessageChannel | "system"
  activityKind?: ActivityKind
  content?: string
  createdAt: string
}
```

- [ ] **Step 2: Update `ghlMessageToInternal` signature in `lib/ghl-message-mapper.ts`**

Replace the entire file content with:

```typescript
import type { GHLMessage } from "./ghl-client"
import type { ActivityKind, Message, MessageChannel } from "./types"

const CHANNEL_BY_TYPE: Record<string, MessageChannel> = {
  TYPE_CALL: "call",
  TYPE_IVR_CALL: "call",
  TYPE_CUSTOM_CALL: "call",
  TYPE_CAMPAIGN_CALL: "call",
  TYPE_CAMPAIGN_MANUAL_CALL: "call",
  TYPE_CAMPAIGN_VOICEMAIL: "call",

  TYPE_SMS: "sms",
  TYPE_RCS: "sms",
  TYPE_SMS_REVIEW_REQUEST: "sms",
  TYPE_SMS_NO_SHOW_REQUEST: "sms",
  TYPE_CAMPAIGN_SMS: "sms",
  TYPE_CAMPAIGN_MANUAL_SMS: "sms",
  TYPE_CUSTOM_SMS: "sms",
  TYPE_CUSTOM_PROVIDER_SMS: "sms",
  TYPE_SMS_REACTION: "sms",

  TYPE_EMAIL: "email",
  TYPE_CAMPAIGN_EMAIL: "email",
  TYPE_CUSTOM_EMAIL: "email",
  TYPE_CUSTOM_PROVIDER_EMAIL: "email",

  TYPE_FACEBOOK: "facebook",
  TYPE_CAMPAIGN_FACEBOOK: "facebook",
  TYPE_FACEBOOK_COMMENT: "facebook",

  TYPE_INSTAGRAM: "instagram",
  TYPE_INSTAGRAM_COMMENT: "instagram",

  TYPE_WHATSAPP: "whatsapp",

  TYPE_TIKTOK: "tiktok",
  TYPE_TIKTOK_COMMENT: "tiktok",

  TYPE_GMB: "google_chat",
  TYPE_CAMPAIGN_GMB: "google_chat",

  TYPE_WEBCHAT: "webchat",
  TYPE_LIVE_CHAT: "live_chat",
  TYPE_LIVE_CHAT_INFO_MESSAGE: "live_chat",

  TYPE_REVIEW: "review",
  TYPE_FORM_SUBMISSION: "form_submission",
  TYPE_INTERNAL_COMMENT: "internal_comment",
}

const ACTIVITY_BY_TYPE: Record<string, { kind: ActivityKind; label: string }> = {
  TYPE_ACTIVITY_OPPORTUNITY: { kind: "opportunity", label: "Oportunidad actualizada" },
  TYPE_ACTIVITY_APPOINTMENT: { kind: "appointment", label: "Cita registrada" },
  TYPE_ACTIVITY_INVOICE: { kind: "invoice", label: "Factura registrada" },
  TYPE_ACTIVITY_PAYMENT: { kind: "payment", label: "Pago registrado" },
  TYPE_ACTIVITY_CONTACT: { kind: "contact", label: "Contacto actualizado" },
  TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG: { kind: "employee_action", label: "Acción de empleado" },
  TYPE_ACTIVITY_WHATSAPP: { kind: "other", label: "Actividad de WhatsApp" },
}

export function ghlMessageToInternal(
  m: GHLMessage,
  contactId: string,
  extra?: { conversationId?: string; assignedTo?: string }
): Message | null {
  const typeKey = m.messageType ?? ""
  const activity = ACTIVITY_BY_TYPE[typeKey]
  if (activity) {
    return {
      id: m.id,
      contactId,
      conversationId: extra?.conversationId,
      assignedTo: extra?.assignedTo,
      direction: m.direction,
      kind: "activity",
      source: "system",
      activityKind: activity.kind,
      content: m.body?.trim() || activity.label,
      createdAt: m.dateAdded,
    }
  }
  if (!m.body) return null
  return {
    id: m.id,
    contactId,
    conversationId: extra?.conversationId,
    assignedTo: extra?.assignedTo,
    direction: m.direction,
    kind: "message",
    source: CHANNEL_BY_TYPE[typeKey] ?? "other",
    content: m.body,
    createdAt: m.dateAdded,
  }
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to these files).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/ghl-message-mapper.ts
git commit -m "feat: add conversationId to Message type and mapper"
```

---

## Task 2: Expand conversation fetch in `route.ts`

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Replace the first-5-contacts message loop**

In `app/api/dashboard/route.ts`, find the block starting at the comment `"Fetch full message threads for first 5 contacts"` (around line 290). Replace the entire block (from `send({ type: "progress", message: "Cargando conversaciones…" })` through the closing `}` of the contacts loop) with:

```typescript
// Fetch last 30 active conversations and their messages
send({ type: "progress", message: "Cargando conversaciones…" });
const messages: Message[] = [];
try {
  const convResp = await getConversations({ limit: 30 });
  for (const conv of convResp.conversations) {
    try {
      const msgResp = await getMessages(conv.id, { limit: 50 });
      for (const msg of msgResp.messages.messages) {
        const transformed = ghlMessageToInternal(msg, conv.contactId, {
          conversationId: conv.id,
          assignedTo: conv.assignedTo,
        });
        if (transformed) messages.push(transformed);
      }
    } catch {
      // skip conversations that fail individually
    }
  }
} catch (err) {
  console.error("[GHL] Conversations fetch failed:", err);
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat: fetch last 30 conversations instead of first-5-contacts loop"
```

---

## Task 3: Add Chart 1 — Conversaciones únicas por día

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add the `dailyConvData` useMemo**

In `sales-dashboard.tsx`, after the `lostReasonsConfig` useMemo (around line 254), add:

```typescript
const dailyConvData = useMemo(() => {
  if (messages.length === 0) return []
  const dailyMap = new Map<string, Set<string>>()
  for (const msg of messages) {
    if (!msg.conversationId) continue
    const date = msg.createdAt.slice(0, 10)
    if (!dailyMap.has(date)) dailyMap.set(date, new Set())
    dailyMap.get(date)!.add(msg.conversationId)
  }
  return [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, convSet]) => ({
      date,
      label: new Date(date + "T12:00:00").toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
      }),
      count: convSet.size,
    }))
}, [messages])
```

- [ ] **Step 2: Add the section and chart JSX**

In the return JSX, find the `{/* ── Análisis de Pérdidas ───────────────────── */}` section comment and insert the following block **before** it:

```tsx
{/* ── Actividad de Conversaciones ─────────────── */}
<SectionHeader title="Actividad de Conversaciones" />
<Card>
  <CardHeader className="flex flex-row items-center pb-2">
    <CardTitle className="text-base font-semibold">
      Conversaciones únicas por día
    </CardTitle>
    <TotalBadge value={new Set(messages.map((m) => m.conversationId).filter(Boolean)).size} />
  </CardHeader>
  <CardContent>
    {dailyConvData.length === 0 ? (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin datos de conversaciones
      </div>
    ) : (
      <ChartContainer
        config={{ count: { label: "Conversaciones", color: "#06b6d4" } }}
        style={{ height: 220 }}
        className="w-full"
      >
        <BarChart
          data={dailyConvData}
          margin={{ left: 8, right: 8, top: 8, bottom: dailyConvData.length > 10 ? 48 : 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            angle={dailyConvData.length > 10 ? -35 : 0}
            textAnchor={dailyConvData.length > 10 ? "end" : "middle"}
            interval={0}
          />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="#06b6d4" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Verify types and lint**

```bash
npx tsc --noEmit 2>&1 | head -30
npm run lint 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Conversaciones únicas por día chart"
```

---

## Task 4: Add Chart 2 — Tiempo promedio de respuesta del asesor

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `Cell` to the recharts import at the top of the file**

Find the existing recharts import block and add `Cell`:

```typescript
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LabelList,
  Cell,                 // ← add this
} from "recharts"
```

- [ ] **Step 2: Add the business-hours helper functions**

Add these four pure functions **before** the `SalesDashboard` component definition (after the `COLOR_PALETTE` constant block, around line 44):

```typescript
function isBusinessHoursStr(isoStr: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(isoStr))
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
  return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 19
}

function nextBusinessOpenMs(isoStr: string): number {
  const d = new Date(isoStr)
  let candidate = new Date(d)
  candidate.setUTCMinutes(0, 0, 0)
  candidate.setUTCMilliseconds(0)
  if (candidate.getTime() <= d.getTime()) {
    candidate = new Date(candidate.getTime() + 3_600_000)
  }
  for (let h = 0; h < 168; h++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(candidate)
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
    if (!["Sat", "Sun"].includes(weekday) && hour === 9) return candidate.getTime()
    candidate = new Date(candidate.getTime() + 3_600_000)
  }
  return d.getTime()
}

function responseColor(minutes: number): string {
  if (minutes < 30) return "#10b981"
  if (minutes <= 60) return "#f59e0b"
  return "#ef4444"
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}
```

- [ ] **Step 3: Add the `responseTimeData` useMemo**

Inside `SalesDashboard`, after the `dailyConvData` useMemo added in Task 3, add:

```typescript
const responseTimeData = useMemo(() => {
  const threads = new Map<string, typeof messages>()
  for (const msg of messages) {
    if (!msg.conversationId) continue
    if (!threads.has(msg.conversationId)) threads.set(msg.conversationId, [])
    threads.get(msg.conversationId)!.push(msg)
  }
  for (const thread of threads.values()) {
    thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  const advisorDeltas = new Map<string, number[]>()
  for (const thread of threads.values()) {
    for (let i = 0; i < thread.length; i++) {
      const msg = thread[i]
      if (msg.direction !== "inbound" || msg.kind === "activity") continue
      const reply = thread.slice(i + 1).find(
        (m) => m.direction === "outbound" && m.kind !== "activity"
      )
      if (!reply) continue
      const advisor = reply.assignedTo
      if (!advisor) continue
      const clockStart = isBusinessHoursStr(msg.createdAt)
        ? new Date(msg.createdAt).getTime()
        : nextBusinessOpenMs(msg.createdAt)
      const delta = new Date(reply.createdAt).getTime() - clockStart
      if (delta <= 0) continue
      if (!advisorDeltas.has(advisor)) advisorDeltas.set(advisor, [])
      advisorDeltas.get(advisor)!.push(delta)
    }
  }

  return [...advisorDeltas.entries()]
    .map(([member, deltas]) => ({
      member,
      avgMinutes: deltas.reduce((s, d) => s + d, 0) / deltas.length / 60_000,
    }))
    .sort((a, b) => a.avgMinutes - b.avgMinutes)
}, [messages])
```

- [ ] **Step 4: Add the chart JSX**

In the return JSX, inside the `{/* ── Rendimiento Individual ─────────────────── */}` section, find the closing `</div>` of the `grid grid-cols-1 md:grid-cols-2` row (after the Ingreso Ganado card) and insert the following **after** that closing div:

```tsx
{/* Tiempo promedio de respuesta - full width */}
{responseTimeData.length > 0 && (
  <Card>
    <CardHeader className="flex flex-row items-center pb-2">
      <CardTitle className="text-base font-semibold">
        Tiempo promedio de respuesta del asesor
      </CardTitle>
      <TotalBadge value={`${responseTimeData.length} asesores`} />
    </CardHeader>
    <CardContent>
      <ChartContainer
        config={{ avgMinutes: { label: "Tiempo de respuesta", color: "#10b981" } }}
        style={{ height: Math.max(200, responseTimeData.length * 64) }}
        className="w-full"
      >
        <BarChart
          data={responseTimeData}
          layout="vertical"
          margin={{ left: 8, right: 80, top: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <YAxis
            dataKey="member"
            type="category"
            width={68}
            tick={{ fontSize: 12 }}
          />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${Math.round(v as number)}m`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? formatMinutes(value) : String(value)
                }
              />
            }
          />
          <Bar dataKey="avgMinutes" radius={[0, 3, 3, 0]}>
            {responseTimeData.map((entry) => (
              <Cell key={entry.member} fill={responseColor(entry.avgMinutes)} />
            ))}
            <LabelList
              dataKey="avgMinutes"
              position="right"
              formatter={(v: unknown) =>
                typeof v === "number" ? formatMinutes(v) : ""
              }
              style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 5: Verify types and lint**

```bash
npx tsc --noEmit 2>&1 | head -30
npm run lint 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 6: Start dev server and verify both charts render**

```bash
npm run dev
```

Open http://localhost:3000 in a browser. Navigate to the Sales tab. Verify:
- "Actividad de Conversaciones" section appears after "Salud del Pipeline"
- "Conversaciones únicas por día" bar chart renders (or shows empty state if no messages)
- "Tiempo promedio de respuesta del asesor" chart appears in "Rendimiento Individual" section with colored bars (or is hidden if no response pairs found)

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Tiempo promedio de respuesta del asesor chart"
```
