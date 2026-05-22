# Conversations Tab — Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-loading Conversations tab with a wizard that shows a filter form on open and only fetches conversation threads when the user explicitly clicks "Cargar conversaciones."

**Architecture:** A new `/api/conversations` route fetches GHL message threads for a given list of contactIds. `ConversationsDashboard` manages a four-state wizard (idle → loading → loaded → exporting) using already-loaded contacts, opportunities, and pipelines from the main dashboard for client-side filter computation. Pagination appends 50 contactIds at a time; CSV export generates client-side from loaded threads.

**Tech Stack:** Next.js 15 App Router, React (useState/useMemo/useRef/useEffect), shadcn/ui (Select, Button, Card, Label), Lucide icons, GHL API client (`getConversations`, `getMessages` from `lib/ghl-client.ts`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/api/conversations/route.ts` | **Create** | Fetch GHL threads for a list of contactIds |
| `components/dashboard/conversations-dashboard.tsx` | **Rewrite** | Wizard state machine, filter form, two-panel view, pagination, CSV export |
| `app/page.tsx` | **Modify** | Pass `opportunities`, `pipelines`, `members`, `availableTags` to `ConversationsDashboard`; remove `messages` prop |

---

### Task 1: Create `/app/api/conversations/route.ts`

**Files:**
- Create: `app/api/conversations/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/conversations/route.ts
import { getConversations, getMessages } from "@/lib/ghl-client"
import type { Message } from "@/lib/types"

const MSG_TYPE_SOURCE: Record<number, Message["source"]> = {
  1: "sms",
  2: "email",
  3: "sms",
  5: "sms",
  6: "sms",
  7: "facebook",
  8: "instagram",
  9: "whatsapp",
  10: "google_chat",
  12: "email",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const contactIds = (searchParams.get("contactIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (contactIds.length === 0) {
    return Response.json({ threads: [] })
  }

  const threads: Array<{ contactId: string; messages: Message[] }> = []

  for (const contactId of contactIds) {
    try {
      const convResp = await getConversations({ contactId, limit: 20 })
      const conv = convResp.conversations[0]
      if (!conv) {
        threads.push({ contactId, messages: [] })
        continue
      }
      const msgResp = await getMessages(conv.id, { limit: 100 })
      const messages: Message[] = msgResp.messages.messages
        .filter((m) => Boolean(m.body))
        .map((m) => ({
          id: m.id,
          contactId,
          direction: m.direction,
          source: MSG_TYPE_SOURCE[m.type] ?? "sms",
          content: m.body ?? "",
          createdAt: m.dateAdded,
        }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      threads.push({ contactId, messages })
    } catch {
      threads.push({ contactId, messages: [] })
    }
  }

  return Response.json({ threads })
}
```

- [ ] **Step 2: Verify the route responds**

With `npm run dev` running, visit `http://localhost:3000/api/conversations?contactIds=test` in the browser.

Expected: `{"threads":[{"contactId":"test","messages":[]}]}` (GHL will return no conversations for a fake id, so the thread is empty — that's correct).

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations/route.ts
git commit -m "feat: add /api/conversations route for on-demand thread fetching"
```

---

### Task 2: Rewrite `conversations-dashboard.tsx` and update `page.tsx`

These two files are committed together because the props change in `page.tsx` only type-checks once the new component interface is in place.

**Files:**
- Rewrite: `components/dashboard/conversations-dashboard.tsx`
- Modify: `app/page.tsx` (the `<ConversationsDashboard>` JSX block, ~line 252)

- [ ] **Step 1: Replace `conversations-dashboard.tsx` entirely**

```tsx
"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  Mail,
  MessageSquare,
  Facebook,
  Instagram,
  Smartphone,
  Download,
  RefreshCw,
} from "lucide-react"
import type { Contact, Opportunity, Message, Pipeline } from "@/lib/types"

// ─── Channel display ─────────────────────────────────────────────────────────

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  sms: <Smartphone className="h-3 w-3" />,
  email: <Mail className="h-3 w-3" />,
  facebook: <Facebook className="h-3 w-3" />,
  instagram: <Instagram className="h-3 w-3" />,
  whatsapp: <MessageSquare className="h-3 w-3" />,
  google_chat: <MessageSquare className="h-3 w-3" />,
}

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_chat: "Google Chat",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatPreviewTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
  })
}

// Sentinel used instead of empty string in shadcn Select to avoid quirks
const ALL = "_all_"

function buildFilterSummary(
  assignedTo: string,
  tag: string,
  pipeline: string,
  stage: string,
  loadedCount: number
): string {
  const parts: string[] = []
  if (assignedTo) parts.push(`Usuario: ${assignedTo}`)
  if (tag) parts.push(`Tag: ${tag}`)
  if (pipeline) parts.push(`Pipeline: ${pipeline}`)
  if (stage) parts.push(`Etapa: ${stage}`)
  parts.push(`${loadedCount} contacto${loadedCount !== 1 ? "s" : ""}`)
  return parts.join(" · ")
}

function exportCSV(contacts: Contact[], threads: ThreadData[]) {
  const esc = (s: string) =>
    `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"`
  const header = [
    "Nombre",
    "Email",
    "Teléfono",
    "Tags",
    "Fecha",
    "Dirección",
    "Canal",
    "Mensaje",
  ]
  const rows: string[] = [header.join(",")]

  for (const thread of threads) {
    const contact = contacts.find((c) => c.id === thread.contactId)
    if (!contact) continue
    const base = [
      esc(contact.name),
      esc(contact.email),
      esc(contact.phone),
      esc(contact.tags.join(", ")),
    ]
    if (thread.messages.length === 0) {
      rows.push([...base, "", "", "", ""].join(","))
      continue
    }
    for (const msg of thread.messages) {
      rows.push(
        [
          ...base,
          esc(new Date(msg.createdAt).toLocaleString("es-MX")),
          msg.direction === "inbound" ? "Entrante" : "Saliente",
          CHANNEL_LABEL[msg.source] ?? msg.source,
          esc(msg.content ?? ""),
        ].join(",")
      )
    }
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `conversaciones-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardState = "idle" | "loading" | "loaded" | "exporting"

interface ThreadData {
  contactId: string
  messages: Message[]
}

export interface ConversationsDashboardProps {
  contacts: Contact[]
  opportunities: Opportunity[]
  pipelines: Pipeline[]
  members: string[]
  availableTags: string[]
}

const HOW_MANY_OPTIONS = [5, 10, 15, 50]

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationsDashboard({
  contacts,
  opportunities,
  pipelines,
  members,
  availableTags,
}: ConversationsDashboardProps) {
  // Wizard state
  const [wizardState, setWizardState] = useState<WizardState>("idle")
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Filter selections (empty string = no filter applied)
  const [selectedUser, setSelectedUser] = useState("")
  const [selectedTag, setSelectedTag] = useState("")
  const [selectedPipeline, setSelectedPipeline] = useState("")
  const [selectedStage, setSelectedStage] = useState("")
  const [howMany, setHowMany] = useState(10)

  // Loaded data
  const [loadedThreads, setLoadedThreads] = useState<ThreadData[]>([])
  const [filteredContactIds, setFilteredContactIds] = useState<string[]>([])
  const [loadedCount, setLoadedCount] = useState(0)
  const [selectedContactId, setSelectedContactId] = useState("")

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selectedContactId])

  const pipelineStages = useMemo(
    () => pipelines.find((p) => p.name === selectedPipeline)?.stages ?? [],
    [pipelines, selectedPipeline]
  )

  // ANDs all active filters to produce a sorted list of matching contactIds
  function computeFilteredIds(): string[] {
    let filtered = [...contacts]
    if (selectedUser)
      filtered = filtered.filter((c) => c.assignedTo === selectedUser)
    if (selectedTag)
      filtered = filtered.filter((c) => c.tags.includes(selectedTag))
    if (selectedPipeline) {
      const matchingContactIds = new Set(
        opportunities
          .filter(
            (o) =>
              o.pipelineName === selectedPipeline &&
              (!selectedStage || o.stage === selectedStage)
          )
          .map((o) => o.contactId)
      )
      filtered = filtered.filter((c) => matchingContactIds.has(c.id))
    }
    return filtered.map((c) => c.id)
  }

  async function fetchThreads(contactIds: string[], append: boolean) {
    if (contactIds.length === 0) return
    const resp = await fetch(
      `/api/conversations?contactIds=${contactIds.join(",")}`
    )
    const data: { threads: ThreadData[] } = await resp.json()
    if (append) {
      setLoadedThreads((prev) => [...prev, ...data.threads])
    } else {
      setLoadedThreads(data.threads)
      setSelectedContactId(data.threads[0]?.contactId ?? "")
    }
  }

  async function handleLoad() {
    const ids = computeFilteredIds()
    setFilteredContactIds(ids)
    setLoadedCount(howMany)
    setWizardState("loading")
    try {
      await fetchThreads(ids.slice(0, howMany), false)
    } finally {
      setWizardState("loaded")
    }
  }

  async function handleLoadMore() {
    const batch = filteredContactIds.slice(loadedCount, loadedCount + 50)
    setLoadedCount((prev) => prev + 50)
    setIsLoadingMore(true)
    try {
      await fetchThreads(batch, true)
    } finally {
      setIsLoadingMore(false)
    }
  }

  function handleExport() {
    setWizardState("exporting")
    exportCSV(contacts, loadedThreads)
    setWizardState("loaded")
  }

  function handleReset() {
    setWizardState("idle")
    setLoadedThreads([])
    setFilteredContactIds([])
    setLoadedCount(0)
    setSelectedContactId("")
  }

  // Preserve original contact order from loadedThreads
  const loadedContacts = useMemo(
    () =>
      loadedThreads
        .map((t) => contacts.find((c) => c.id === t.contactId))
        .filter(Boolean) as Contact[],
    [contacts, loadedThreads]
  )

  const threadMap = useMemo(() => {
    const map: Record<string, Message[]> = {}
    for (const t of loadedThreads) map[t.contactId] = t.messages
    return map
  }, [loadedThreads])

  const lastMessageMap = useMemo(() => {
    const map: Record<string, Message> = {}
    for (const t of loadedThreads) {
      if (t.messages.length > 0)
        map[t.contactId] = t.messages[t.messages.length - 1]
    }
    return map
  }, [loadedThreads])

  const selectedContact = useMemo(
    () => loadedContacts.find((c) => c.id === selectedContactId),
    [loadedContacts, selectedContactId]
  )

  const selectedThread = useMemo(
    () => threadMap[selectedContactId] ?? [],
    [threadMap, selectedContactId]
  )

  const hasMore = loadedCount < filteredContactIds.length

  // ─── Idle / Loading: filter form ────────────────────────────────────────────

  if (wizardState === "idle" || wizardState === "loading") {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-196px)] px-6">
        <Card className="w-full max-w-lg p-8">
          <h2 className="text-base font-semibold mb-6">
            Cargar conversaciones
          </h2>
          <div className="space-y-4">
            {/* Assigned user */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Usuario asignado
              </Label>
              <Select
                value={selectedUser || ALL}
                onValueChange={(v) => setSelectedUser(v === ALL ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los usuarios" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los usuarios</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tag */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tag</Label>
              <Select
                value={selectedTag || ALL}
                onValueChange={(v) => setSelectedTag(v === ALL ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los tags</SelectItem>
                  {availableTags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Pipeline */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Pipeline</Label>
              <Select
                value={selectedPipeline || ALL}
                onValueChange={(v) => {
                  setSelectedPipeline(v === ALL ? "" : v)
                  setSelectedStage("")
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los pipelines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos los pipelines</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stage — disabled until a pipeline is selected */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Etapa</Label>
              <Select
                value={selectedStage || ALL}
                onValueChange={(v) => setSelectedStage(v === ALL ? "" : v)}
                disabled={!selectedPipeline}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      selectedPipeline
                        ? "Todas las etapas"
                        : "Selecciona un pipeline primero"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas las etapas</SelectItem>
                  {pipelineStages.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* How many */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Cuántos contactos
              </Label>
              <Select
                value={String(howMany)}
                onValueChange={(v) => setHowMany(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOW_MANY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full mt-2"
              onClick={handleLoad}
              disabled={wizardState === "loading"}
            >
              {wizardState === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cargando…
                </>
              ) : (
                "Cargar conversaciones"
              )}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  // ─── Loaded / Exporting: two-panel view ─────────────────────────────────────

  return (
    <div className="px-6 py-3 flex flex-col gap-3 h-[calc(100vh-196px)]">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 flex-shrink-0"
            onClick={handleReset}
          >
            ← Cambiar filtros
          </Button>
          <span className="text-xs text-muted-foreground truncate">
            {buildFilterSummary(
              selectedUser,
              selectedTag,
              selectedPipeline,
              selectedStage,
              loadedContacts.length
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Cargar 50 más
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
            disabled={wizardState === "exporting"}
          >
            {wizardState === "exporting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Contact list */}
        <Card className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contactos
            </p>
          </div>
          <ul className="overflow-y-auto flex-1">
            {loadedContacts.map((contact) => {
              const last = lastMessageMap[contact.id]
              const isSelected = contact.id === selectedContactId
              return (
                <li
                  key={contact.id}
                  onClick={() => setSelectedContactId(contact.id)}
                  className={`flex items-start gap-3 px-3 py-3 cursor-pointer border-b last:border-0 transition-colors ${
                    isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {initials(contact.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-semibold truncate">
                        {contact.name}
                      </p>
                      {last && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatPreviewTime(last.createdAt)}
                        </span>
                      )}
                    </div>
                    {last && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-muted-foreground opacity-60">
                          {CHANNEL_ICON[last.source]}
                        </span>
                        <p className="text-xs text-muted-foreground truncate">
                          {last.content}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {contact.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground leading-none"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Thread panel */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          {selectedContact && (
            <div className="border-b px-4 py-3 flex items-center gap-3 flex-shrink-0">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                {initials(selectedContact.name)}
              </div>
              <div>
                <p className="font-semibold text-sm">{selectedContact.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedContact.email} · {selectedContact.phone}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap gap-1 justify-end">
                {selectedContact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {selectedThread.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin mensajes para este contacto
              </div>
            ) : (
              selectedThread.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.direction === "outbound" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[68%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      msg.direction === "outbound"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-muted text-foreground rounded-tl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 px-1">
                    <span className="text-muted-foreground opacity-50">
                      {CHANNEL_ICON[msg.source]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {CHANNEL_LABEL[msg.source]} · {formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/page.tsx` — change the `<ConversationsDashboard>` block**

Find this section (around line 252):
```tsx
        <ConversationsDashboard
          contacts={contacts}
          messages={messages}
        />
```

Replace with:
```tsx
        <ConversationsDashboard
          contacts={contacts}
          opportunities={opportunities}
          pipelines={data?.pipelines ?? []}
          members={availableMembers}
          availableTags={availableTags}
        />
```

Note: `messages` and `filteredMessages` stay in `page.tsx` — they're still used by `SalesDashboard`. Only the prop passed to `ConversationsDashboard` changes.

- [ ] **Step 3: Verify in the browser**

With `npm run dev` running, open `http://localhost:3000` and click "Conversaciones." You should see:

1. **No spinner, no loading** — just a centered card with five labeled dropdowns and a "Cargar conversaciones" button.
2. Selecting a pipeline enables the Etapa dropdown and populates it with that pipeline's stages.
3. Selecting a different pipeline resets the Etapa dropdown.
4. Clicking "Cargar conversaciones" shows a spinner on the button while fetching, then transitions to the two-panel view.
5. The action bar shows "← Cambiar filtros", the filter summary (e.g. "10 contactos"), and the "Exportar CSV" button.
6. "Cargar 50 más" appears only if there are more contacts than were loaded.
7. Clicking "← Cambiar filtros" returns to the filter form (empty, no data).
8. Clicking "Exportar CSV" downloads `conversaciones-YYYY-MM-DD.csv` with one row per message.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/conversations-dashboard.tsx app/page.tsx
git commit -m "feat: conversations tab wizard — filter form, on-demand load, pagination, CSV export"
```
