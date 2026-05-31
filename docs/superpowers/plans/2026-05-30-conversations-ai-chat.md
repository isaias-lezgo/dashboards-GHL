# Conversations AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Conversations tab's filter wizard with a full-page AI chat that has a live adaptive context panel — showing summary stats for multi-contact queries and a full contact profile (with live GHL tasks + notes) when drilling into one person.

**Architecture:** Refactor `ai-chat-panel.tsx`'s agent loop into a shared `hooks/use-agent-loop.ts` hook. Create two new components — `ConversationsChat` (full-page layout) and `ConversationsContextPanel` (adaptive left panel). Panel state is updated via an `onToolExecuted` callback fired from the shared hook after each tool runs.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Anthropic SDK (claude-sonnet-4-6), GoHighLevel REST API

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/ghl-client.ts` | Modify | Add `GHLNote`, `GHLNotesResponse`, `getContactNotes()` |
| `app/api/contact-tasks/route.ts` | Create | GET endpoint → `getContactTasks()` |
| `app/api/contact-notes/route.ts` | Create | GET endpoint → `getContactNotes()` |
| `lib/ai-tools.ts` | Modify | Add `get_contact_tasks` + `get_contact_notes` tool definitions |
| `lib/ghl-fetchers.ts` | Create | Shared client-side GHL fetchers (messages, threads, tasks, notes) |
| `hooks/use-agent-loop.ts` | Create | Shared agent loop hook (extracted from ai-chat-panel.tsx) |
| `lib/ai-context.ts` | Modify | Add `CONVERSATIONS_SYSTEM_PROMPT` |
| `components/dashboard/ai-chat-panel.tsx` | Modify | Consume `useAgentLoop` hook; remove duplicated logic |
| `components/dashboard/conversations-context-panel.tsx` | Create | Adaptive left panel (idle / summary / contact states) |
| `components/dashboard/conversations-chat.tsx` | Create | Full-page layout; wires hook → panel state |
| `app/page.tsx` | Modify | Swap `ConversationsDashboard` → `ConversationsChat` |
| `components/dashboard/conversations-dashboard.tsx` | Delete | Replaced entirely |

---

## Task 1: Add notes to GHL client + create API routes

**Files:**
- Modify: `lib/ghl-client.ts`
- Create: `app/api/contact-tasks/route.ts`
- Create: `app/api/contact-notes/route.ts`

- [ ] **Step 1: Add `GHLNote` type and `getContactNotes` to `lib/ghl-client.ts`**

Append to the end of `lib/ghl-client.ts` (after the existing `getContactTasks` block):

```typescript
// ============ NOTES ============

export interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded: string;
  contactId?: string;
}

export interface GHLNotesResponse {
  notes: GHLNote[];
}

export async function getContactNotes(contactId: string): Promise<GHLNotesResponse> {
  return ghlFetch<GHLNotesResponse>(`/contacts/${contactId}/notes`, {
    noQueryLocationId: true,
  });
}
```

- [ ] **Step 2: Create `app/api/contact-tasks/route.ts`**

```typescript
import { getContactTasks } from "@/lib/ghl-client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId") ?? "";

  if (!contactId) {
    return NextResponse.json({ error: "Missing contactId" }, { status: 400 });
  }

  try {
    const data = await getContactTasks(contactId);
    return NextResponse.json({
      tasks: (data.tasks ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        body: t.body,
        dueDate: t.dueDate,
        status: t.status,
        assignedTo: t.assignedTo,
        dateAdded: t.dateAdded,
      })),
      count: data.tasks?.length ?? 0,
    });
  } catch (err) {
    console.error("[/api/contact-tasks]", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Create `app/api/contact-notes/route.ts`**

```typescript
import { getContactNotes } from "@/lib/ghl-client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId") ?? "";

  if (!contactId) {
    return NextResponse.json({ error: "Missing contactId" }, { status: 400 });
  }

  try {
    const data = await getContactNotes(contactId);
    return NextResponse.json({
      notes: (data.notes ?? []).map((n) => ({
        id: n.id,
        body: n.body,
        userId: n.userId,
        dateAdded: n.dateAdded,
      })),
      count: data.notes?.length ?? 0,
    });
  } catch (err) {
    console.error("[/api/contact-notes]", err);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Smoke-test both endpoints**

Start the dev server (`npm run dev`) and open in a browser:
```
http://localhost:3000/api/contact-tasks?contactId=PASTE_A_REAL_CONTACT_ID
http://localhost:3000/api/contact-notes?contactId=PASTE_A_REAL_CONTACT_ID
```
Get a real contact ID from the GHL MCP tool `mcp__ghl-mcp__contacts_get-contacts` or from the dashboard.  
Expected: JSON with `{ tasks: [...], count: N }` or `{ notes: [...], count: N }`. A 200 with an empty array is fine.

- [ ] **Step 5: Commit**

```bash
git add lib/ghl-client.ts app/api/contact-tasks/route.ts app/api/contact-notes/route.ts
git commit -m "feat: add contact notes GHL client + task/notes API routes"
```

---

## Task 2: Add `get_contact_tasks` and `get_contact_notes` tool definitions

**Files:**
- Modify: `lib/ai-tools.ts`

- [ ] **Step 1: Add two tool definitions to `TOOL_DEFINITIONS` in `lib/ai-tools.ts`**

Insert after the `search_conversations` entry (just before the `] as const;` closing):

```typescript
  {
    name: "get_contact_tasks",
    description:
      "Fetches all tasks for a contact directly from GoHighLevel. Returns task title, due date, status (completed/pending), and assigned user. Use when the user asks about pending work, follow-ups, overdue items, or to-dos for a specific contact. Always resolve the contactId first with search_contacts if you only have a name.",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "Contact ID to fetch tasks for.",
        },
      },
      required: ["contactId"],
    },
  },
  {
    name: "get_contact_notes",
    description:
      "Fetches all advisor-written notes for a contact from GoHighLevel. Notes are internal observations — NOT chat messages. Use when the user asks what was noted, observed, or documented about a contact, or to cross-reference notes against the conversation.",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "Contact ID to fetch notes for.",
        },
      },
      required: ["contactId"],
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds (TypeScript errors are suppressed per `next.config.mjs`, but no new runtime errors should appear).

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat: add get_contact_tasks and get_contact_notes AI tool definitions"
```

---

## Task 3: Create `lib/ghl-fetchers.ts`

This extracts the client-side GHL fetch helpers from `ai-chat-panel.tsx` into a shared module. The helpers are NOT removed from `ai-chat-panel.tsx` yet (that happens in Task 5).

**Files:**
- Create: `lib/ghl-fetchers.ts`

- [ ] **Step 1: Create `lib/ghl-fetchers.ts`**

```typescript
// Client-side fetch helpers — run in the browser, call Next.js API routes.
// These are intentionally NOT server-side; they're called from the AI agent
// loop after the AI decides to invoke a tool.

export async function fetchContactMessages(
  input: Record<string, unknown>
): Promise<unknown> {
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  if (!contactId) return { error: "Missing contactId" };
  const limit =
    typeof input.limit === "number"
      ? Math.min(100, Math.max(1, Math.floor(input.limit)))
      : 50;

  const res = await fetch(
    `/api/conversations?contactIds=${encodeURIComponent(contactId)}`,
    { method: "GET" }
  );
  if (!res.ok) return { error: `GHL fetch failed (HTTP ${res.status})` };

  const data = (await res.json()) as {
    threads: Array<{ contactId: string; messages: Array<Record<string, unknown>> }>;
  };
  const thread = data.threads?.find((t) => t.contactId === contactId);
  const msgs = (thread?.messages ?? []).filter((m) => m.kind !== "activity");
  const sorted = [...msgs].sort(
    (a, b) =>
      new Date(String(b.createdAt ?? "")).getTime() -
      new Date(String(a.createdAt ?? "")).getTime()
  );
  const capped = sorted.slice(0, limit);
  return {
    contactId,
    returned: capped.length,
    totalAvailable: msgs.length,
    rows: capped.map((m) => ({
      id: m.id,
      direction: m.direction,
      source: m.source,
      content:
        typeof m.content === "string" && m.content.length > 500
          ? m.content.slice(0, 500) + "…"
          : m.content,
      createdAt: m.createdAt,
    })),
  };
}

export async function fetchConversationThreads(
  input: Record<string, unknown>
): Promise<unknown> {
  const rawIds = Array.isArray(input.contactIds)
    ? (input.contactIds as string[])
    : [];
  if (rawIds.length === 0)
    return { error: "contactIds is required and must be a non-empty array" };

  const limit =
    typeof input.limit === "number"
      ? Math.min(50, Math.max(1, Math.floor(input.limit)))
      : 20;
  const messageLimit =
    typeof input.messageLimit === "number"
      ? Math.max(1, Math.floor(input.messageLimit))
      : 100;
  const contactIds = rawIds.slice(0, limit);

  const params = new URLSearchParams({
    contactIds: contactIds.join(","),
    messageLimit: String(messageLimit),
  });

  const res = await fetch(`/api/conversations?${params}`, { method: "GET" });
  if (!res.ok) return { error: `GHL fetch failed (HTTP ${res.status})` };

  const data = (await res.json()) as {
    threads: Array<{ contactId: string; messages: Array<Record<string, unknown>> }>;
  };

  const threads = (data.threads ?? []).map((t) => {
    const chat = t.messages.filter((m) => m.kind !== "activity");
    const sorted = [...chat].sort(
      (a, b) =>
        new Date(String(b.createdAt ?? "")).getTime() -
        new Date(String(a.createdAt ?? "")).getTime()
    );
    return {
      contactId: t.contactId,
      messageCount: chat.length,
      messages: sorted.map((m) => ({
        id: m.id,
        direction: m.direction,
        source: m.source,
        content:
          typeof m.content === "string" && m.content.length > 500
            ? m.content.slice(0, 500) + "…"
            : m.content,
        createdAt: m.createdAt,
      })),
    };
  });

  return { returned: threads.length, threads };
}

export async function fetchContactTasks(
  input: Record<string, unknown>
): Promise<unknown> {
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  if (!contactId) return { error: "Missing contactId" };

  const res = await fetch(
    `/api/contact-tasks?contactId=${encodeURIComponent(contactId)}`,
    { method: "GET" }
  );
  if (!res.ok) return { error: `Tasks fetch failed (HTTP ${res.status})` };
  return res.json();
}

export async function fetchContactNotes(
  input: Record<string, unknown>
): Promise<unknown> {
  const contactId = typeof input.contactId === "string" ? input.contactId : "";
  if (!contactId) return { error: "Missing contactId" };

  const res = await fetch(
    `/api/contact-notes?contactId=${encodeURIComponent(contactId)}`,
    { method: "GET" }
  );
  if (!res.ok) return { error: `Notes fetch failed (HTTP ${res.status})` };
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ghl-fetchers.ts
git commit -m "feat: create shared ghl-fetchers client-side module"
```

---

## Task 4: Create `hooks/use-agent-loop.ts`

Extract the agent loop from `ai-chat-panel.tsx` into a reusable hook. Adds an `onToolExecuted` callback so consumers (like `ConversationsChat`) can react to tool results.

**Files:**
- Create: `hooks/use-agent-loop.ts`

- [ ] **Step 1: Create `hooks/use-agent-loop.ts`**

```typescript
"use client";

import { useCallback, useRef, useState } from "react";
import {
  executeTool,
  executeExportCsv,
  type ChatDataset,
} from "@/lib/ai-tools";
import {
  fetchContactMessages,
  fetchConversationThreads,
  fetchContactTasks,
  fetchContactNotes,
} from "@/lib/ghl-fetchers";

// ─── Types (re-exported so consumers can import from one place) ────────────────

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export type AnyBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ApiMessage {
  role: "user" | "assistant";
  content: AnyBlock[];
}

export interface UIMessage {
  role: "user" | "assistant";
  blocks: AnyBlock[];
}

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TURNS = 15;
const PRICING = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

function estimateCost(u: TurnUsage): number {
  return (
    (u.inputTokens * PRICING.input +
      u.outputTokens * PRICING.output +
      u.cacheReadTokens * PRICING.cacheRead +
      u.cacheCreationTokens * PRICING.cacheWrite) /
    1_000_000
  );
}

function triggerCsvDownload({
  csvContent,
  filename,
}: {
  csvContent: string;
  filename: string;
}): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  datasetSummary: string;
  dataset: ChatDataset;
  /**
   * Called after each tool executes, before the next LLM turn.
   * Use this to update panel state or any external UI driven by tool results.
   */
  onToolExecuted?: (
    name: string,
    input: Record<string, unknown>,
    result: unknown
  ) => void;
}

export interface AgentLoopReturn {
  messages: UIMessage[];
  busy: boolean;
  status: string | null;
  error: string | null;
  totalCost: number;
  totalTools: number;
  /** Send a user text message and start the agent loop. */
  send: (text: string) => void;
  /** Abort the current agent loop. */
  stop: () => void;
  /** Clear all messages and reset cost/tool counters. */
  reset: () => void;
  /**
   * Start the agent loop with a pre-built message list.
   * Used for auto-sending an initialMessage when a panel opens.
   */
  runWithMessages: (msgs: UIMessage[]) => void;
}

export function useAgentLoop({
  datasetSummary,
  dataset,
  onToolExecuted,
}: AgentLoopOptions): AgentLoopReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTools, setTotalTools] = useState(0);

  // Refs to avoid stale closures inside runWithMessages
  const stopRef = useRef(false);
  const messagesRef = useRef<UIMessage[]>([]);
  const onToolExecutedRef = useRef(onToolExecuted);
  onToolExecutedRef.current = onToolExecuted;

  const runWithMessages = useCallback(
    async (initialMessages: UIMessage[]) => {
      stopRef.current = false;
      setBusy(true);
      setError(null);
      let convo = [...initialMessages];

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          if (stopRef.current) break;
          setStatus(turn === 0 ? "Pensando…" : "Continuando…");

          const apiMessages: ApiMessage[] = convo.map((m) => ({
            role: m.role,
            content: m.blocks,
          }));

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasetSummary, messages: apiMessages }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(
              (errData as { error?: string }).error || `HTTP ${res.status}`
            );
          }

          const data = (await res.json()) as {
            stopReason: string;
            content: AnyBlock[];
            usage: TurnUsage;
          };

          setTotalCost((c) => c + estimateCost(data.usage));

          const assistantMsg: UIMessage = {
            role: "assistant",
            blocks: data.content,
          };
          convo = [...convo, assistantMsg];
          setMessages(convo);
          messagesRef.current = convo;

          const toolUses = data.content.filter(
            (b): b is ToolUseBlock => b.type === "tool_use"
          );

          if (toolUses.length === 0) {
            if (data.stopReason === "max_tokens") {
              convo = [
                ...convo,
                {
                  role: "user",
                  blocks: [{ type: "text", text: "Continúa." }],
                },
              ];
              setMessages(convo);
              messagesRef.current = convo;
              continue;
            }
            break;
          }

          setStatus(
            toolUses.length === 1
              ? `Ejecutando ${toolUses[0].name}…`
              : `Ejecutando ${toolUses.length} herramientas…`
          );

          const toolResults: ToolResultBlock[] = await Promise.all(
            toolUses.map(async (tu): Promise<ToolResultBlock> => {
              try {
                let result: unknown;
                if (tu.name === "get_contact_messages") {
                  result = await fetchContactMessages(tu.input);
                } else if (tu.name === "search_conversations") {
                  result = await fetchConversationThreads(tu.input);
                } else if (tu.name === "get_contact_tasks") {
                  result = await fetchContactTasks(tu.input);
                } else if (tu.name === "get_contact_notes") {
                  result = await fetchContactNotes(tu.input);
                } else if (tu.name === "export_csv") {
                  const exportResult = executeExportCsv(tu.input, dataset);
                  if (exportResult.rowCount > 0) triggerCsvDownload(exportResult);
                  result = {
                    success: exportResult.rowCount > 0,
                    filename: exportResult.filename,
                    rowCount: exportResult.rowCount,
                  };
                } else {
                  result = executeTool(tu.name, tu.input, dataset);
                }

                // Notify consumer (e.g. ConversationsChat to update panel)
                onToolExecutedRef.current?.(tu.name, tu.input, result);

                return {
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: JSON.stringify(result),
                };
              } catch (err) {
                return {
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                  }),
                  is_error: true,
                };
              }
            })
          );

          setTotalTools((n) => n + toolUses.length);

          convo = [...convo, { role: "user", blocks: toolResults }];
          setMessages(convo);
          messagesRef.current = convo;
        }

        // Guard: if last assistant turn had no text, show a notice.
        const lastAssistant = [...convo]
          .reverse()
          .find((m) => m.role === "assistant");
        const hasText = lastAssistant?.blocks.some(
          (b) => b.type === "text" && (b as TextBlock).text.trim()
        );
        if (!hasText) {
          const notice: UIMessage = {
            role: "assistant",
            blocks: [
              {
                type: "text",
                text: "⚠️ El agente alcanzó el límite de turnos sin producir una respuesta completa. Intenta hacer una pregunta más específica.",
              },
            ],
          };
          const final = [...convo, notice];
          setMessages(final);
          messagesRef.current = final;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [datasetSummary, dataset]
  );

  const send = useCallback(
    (text: string) => {
      if (busy) return;
      const userMsg: UIMessage = {
        role: "user",
        blocks: [{ type: "text", text }],
      };
      const next = [...messagesRef.current, userMsg];
      setMessages(next);
      messagesRef.current = next;
      void runWithMessages(next);
    },
    [busy, runWithMessages]
  );

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    messagesRef.current = [];
    setError(null);
    setStatus(null);
    setTotalCost(0);
    setTotalTools(0);
  }, []);

  return {
    messages,
    busy,
    status,
    error,
    totalCost,
    totalTools,
    send,
    stop,
    reset,
    runWithMessages,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/use-agent-loop.ts
git commit -m "feat: create shared use-agent-loop hook with onToolExecuted callback"
```

---

## Task 5: Refactor `ai-chat-panel.tsx` to use the shared hook

**Files:**
- Modify: `components/dashboard/ai-chat-panel.tsx`

- [ ] **Step 1: Replace `ai-chat-panel.tsx` with the refactored version**

The component keeps its exact same UI and props. Only the internal logic changes — the agent loop, fetchers, and related types are removed and imported from the shared modules.

Replace the entire file content:

```typescript
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  Sparkles,
  RefreshCcw,
  Wrench,
  AlertCircle,
  Square,
  ArrowUpRight,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatDataset } from "@/lib/ai-tools";
import { buildDatasetSummary } from "@/lib/ai-context";
import {
  useAgentLoop,
  type UIMessage,
  type TextBlock,
  type ToolUseBlock,
  type ToolResultBlock,
} from "@/hooks/use-agent-loop";

interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: ChatDataset;
  locationId?: string;
  initialMessage?: string;
}

export function AIChatPanel({
  open,
  onOpenChange,
  dataset,
  locationId,
  initialMessage,
}: AIChatPanelProps) {
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const processedInitialMessageRef = useRef<string | null>(null);

  const datasetSummary = useMemo(
    () => buildDatasetSummary(dataset, locationId),
    [dataset, locationId]
  );

  const {
    messages,
    busy,
    status,
    error,
    totalCost,
    totalTools,
    send,
    stop,
    reset,
    runWithMessages,
  } = useAgentLoop({ datasetSummary, dataset });

  useEffect(() => {
    if (!open) {
      processedInitialMessageRef.current = null;
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !initialMessage) return;
    if (processedInitialMessageRef.current === initialMessage) return;
    processedInitialMessageRef.current = initialMessage;
    reset();
    const userMsg: UIMessage = {
      role: "user",
      blocks: [{ type: "text", text: initialMessage }],
    };
    void runWithMessages([userMsg]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMessage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    send(text);
  }, [input, busy, send]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl focus:outline-none"
      >
        <div className="h-px w-full shrink-0 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <SheetTitle className="text-base font-semibold">
              Analizar con IA
            </SheetTitle>
          </div>
          <SheetDescription className="mt-0.5 text-xs text-muted-foreground/80">
            Pregúntame sobre contactos, oportunidades, pautas o citas.
          </SheetDescription>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 && !busy && (
            <EmptyState onSuggest={(s) => setInput(s)} />
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {busy && status && (
            <div className="flex items-center gap-2.5 py-1 text-xs text-muted-foreground">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              {status}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3.5">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="¿Cuántos leads de Meta sin cita esta semana?"
            rows={2}
            className="min-h-[52px] w-full resize-none text-sm"
            disabled={busy}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <span className="tabular-nums text-[10px] text-muted-foreground/60">
              Sonnet 4.6 · {totalTools}{" "}
              {totalTools === 1 ? "herramienta" : "herramientas"} · ~$
              {totalCost.toFixed(4)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={busy || messages.length === 0}
                className="h-7 gap-1.5 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <RefreshCcw className="h-3 w-3" />
                Reiniciar
              </Button>
              {busy && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stop}
                  className="h-7 gap-1.5 px-3 text-[10px]"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Detener
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={busy || !input.trim()}
                className="h-7 gap-1.5 px-3 text-[10px]"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {!busy && "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function EmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  const suggestions = [
    "¿Cuántos contactos de Meta tengo este mes?",
    "Dame un resumen del lead con más actividad.",
    "¿Qué pautas tipo Facebook tienen oportunidades abiertas?",
    "Top 5 asesores por valor de oportunidades cerradas.",
  ];
  return (
    <div className="flex flex-col gap-5 py-1">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sugerencias
        </p>
        <div className="flex flex-col gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="group flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/15 px-3.5 py-2.5 text-left text-sm text-foreground/70 transition-all duration-150 hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
            >
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/40 transition-colors duration-150 group-hover:text-primary/80" />
              <span className="leading-snug">{s}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/40">
        Respuestas basadas en los datos cargados en el panel. Conteos exactos,
        no estimaciones.
      </p>
    </div>
  );
}

export function MessageBubble({ message }: { message: UIMessage }) {
  const textBlocks = message.blocks.filter(
    (b): b is TextBlock => b.type === "text"
  );
  const toolUseBlocks = message.blocks.filter(
    (b): b is ToolUseBlock => b.type === "tool_use"
  );
  const toolResultBlocks = message.blocks.filter(
    (b): b is ToolResultBlock => b.type === "tool_result"
  );

  if (
    message.role === "user" &&
    toolResultBlocks.length > 0 &&
    textBlocks.length === 0
  ) {
    return <ToolResultsSummary blocks={toolResultBlocks} />;
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {textBlocks.map((b, i) => (
        <div
          key={`t-${i}`}
          className={cn(
            "max-w-[92%] rounded-2xl px-4 py-3 text-sm",
            isUser
              ? "bg-primary/90 text-primary-foreground"
              : "bg-muted/40 text-foreground ring-1 ring-inset ring-border/25"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{b.text}</p>
          ) : (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold",
                "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
                "prose-table:my-2 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-th:bg-muted/50 prose-td:px-2 prose-td:py-1 prose-td:border-border/40 prose-th:border-border/40",
                "prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
                "prose-strong:text-foreground prose-a:text-primary"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
      {toolUseBlocks.length > 0 && (
        <GroupedToolUseChips blocks={toolUseBlocks} />
      )}
    </div>
  );
}

function GroupedToolUseChips({ blocks }: { blocks: ToolUseBlock[] }) {
  const groups = blocks.reduce<Record<string, ToolUseBlock[]>>((acc, b) => {
    (acc[b.name] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(groups).map(([name, group]) => (
        <div
          key={name}
          className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          <Wrench className="h-2.5 w-2.5 shrink-0" />
          <span className="font-medium text-foreground/70">{name}</span>
          {group.length > 1 && (
            <span className="rounded-full bg-border/70 px-1 font-mono leading-tight">
              ×{group.length}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolResultsSummary({ blocks }: { blocks: ToolResultBlock[] }) {
  const errors = blocks.filter((b) => b.is_error).length;
  const ok = blocks.length - errors;
  const preview = blocks.length === 1 ? previewResult(blocks[0].content) : null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[10px]",
        errors > 0
          ? "border-destructive/30 bg-destructive/8 text-destructive"
          : "border-border/40 bg-muted/25 text-muted-foreground"
      )}
    >
      <span className="opacity-50">↳</span>
      <span>
        {preview ??
          `${ok} resultado${ok !== 1 ? "s" : ""}${errors > 0 ? `, ${errors} error${errors !== 1 ? "es" : ""}` : ""}`}
      </span>
    </div>
  );
}

function previewResult(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.error) return `error: ${String(parsed.error).slice(0, 80)}`;
    if (
      typeof parsed?.filename === "string" &&
      typeof parsed?.rowCount === "number"
    ) {
      return parsed.success
        ? `${parsed.rowCount} filas → ${parsed.filename}`
        : `sin filas — nada exportado`;
    }
    if (Array.isArray(parsed?.rows)) {
      return `${parsed.returned ?? parsed.rows.length} fila${(parsed.returned ?? parsed.rows.length) === 1 ? "" : "s"}${parsed.truncated ? " (truncado)" : ""}`;
    }
    if (Array.isArray(parsed?.groups)) {
      return `${parsed.groups.length} grupo${parsed.groups.length === 1 ? "" : "s"} · total ${parsed.total ?? "?"}`;
    }
    if (parsed?.id) return `id ${String(parsed.id).slice(0, 20)}`;
    return `${Object.keys(parsed ?? {}).length} campos`;
  } catch {
    return content.slice(0, 60);
  }
}
```

- [ ] **Step 2: Verify the existing AI chat still works**

```bash
npm run dev
```
Open `http://localhost:3000`, click "Analizar con IA" in the header. Send a message. Confirm the agent responds and tool chips still appear. The UI should be pixel-identical to before.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/ai-chat-panel.tsx
git commit -m "refactor: ai-chat-panel consumes shared use-agent-loop hook"
```

---

## Task 6: Add `CONVERSATIONS_SYSTEM_PROMPT` to `lib/ai-context.ts`

**Files:**
- Modify: `lib/ai-context.ts`

- [ ] **Step 1: Append the new prompt to `lib/ai-context.ts`**

Add at the end of the file:

```typescript
export const CONVERSATIONS_SYSTEM_PROMPT = `Eres un especialista en comunicación y seguimiento de leads para un CRM GoHighLevel. Tu objetivo es ayudar al equipo a entender el estado de sus conversaciones, identificar leads que necesitan atención, y redactar mensajes de seguimiento efectivos.

Tienes acceso a todo el contexto de cada contacto: sus mensajes, oportunidades, citas, tareas internas y notas del asesor.

# Reglas críticas

1. **Precisión numérica**: SIEMPRE usa \`aggregate\` para contar. NUNCA estimes números.
2. **Para conversaciones específicas**: usa \`get_contact_messages\` — devuelve el historial real de GHL, no una muestra.
3. **Para tareas y notas**: usa \`get_contact_tasks\` y \`get_contact_notes\` — son datos en vivo de GHL.
4. **Nunca imprimas IDs crudos**: si necesitas identificar contactos por ID, llama \`search_contacts(contactIds: [...])\` para obtener sus nombres.
5. **Antes de filtrar por un valor desconocido**: llama \`list_values\` para ver los valores exactos que existen en los datos.

# Estrategia de herramientas para conversaciones

- **Identificar leads sin respuesta**: \`search_contacts\` con filtros de fecha/fuente → luego \`search_conversations\` para verificar el estado de los hilos.
- **Perfil completo de un contacto**: \`get_contact\` + \`get_contact_related\` + \`get_contact_messages\` + \`get_contact_tasks\` + \`get_contact_notes\`.
- **Redactar follow-up**: lee primero la conversación con \`get_contact_messages\`, luego redacta el mensaje basándote en el contexto real — tono, último tema discutido, tiempo sin respuesta.
- **Cruzar conversaciones con tareas**: obtén las tareas con \`get_contact_tasks\` y compáralas con lo prometido en la conversación (\`get_contact_messages\`).

# Análisis de urgencia

Cuando el usuario pida leads sin respuesta o atrasados, calcula la urgencia así:
- 🔴 Crítico: último mensaje de entrada hace más de 3 días sin respuesta del asesor
- 🟡 Urgente: último mensaje de entrada hace más de 24h sin respuesta
- ⚪ Reciente: último mensaje de entrada hace menos de 24h

# Formato de respuesta

- Responde en español, conciso y directo.
- **NUNCA incluyas IDs** en tus respuestas.
- Usa **tablas markdown** para listas de contactos o comparaciones.
- Usa **negritas** para nombres, totales y conclusiones clave.
- Para follow-ups redactados: presenta el mensaje en un bloque de código para que sea fácil de copiar.
- Si identificas un lead en riesgo (sin respuesta + oportunidad abierta), dilo con claridad y sugiere la acción concreta.

# Exportar a CSV

Cuando el usuario pida exportar:
1. Confirma qué datos existen con \`search_*\` o \`aggregate\`.
2. Llama \`export_csv\` con el mismo \`entity\` y \`filters\`.
3. Informa el nombre del archivo y el número de filas.`;
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai-context.ts
git commit -m "feat: add CONVERSATIONS_SYSTEM_PROMPT for conversation-focused AI chat"
```

---

## Task 7: Create `components/dashboard/conversations-context-panel.tsx`

**Files:**
- Create: `components/dashboard/conversations-context-panel.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { ExternalLink, Clock, ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PanelContact {
  id: string;
  name: string;
  source?: string;
  assignedTo?: string;
  tags?: string[];
  lastActivity?: string;
}

export interface SummaryGroup {
  key: string;
  count: number;
  sum?: number;
}

export interface PanelTask {
  id: string;
  title: string;
  status: "pending" | "completed";
  dueDate?: string;
}

export interface PanelNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded: string;
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

export interface PanelLastMessage {
  direction: "inbound" | "outbound";
  source: string;
  content?: string;
  createdAt: string;
}

export type PanelState =
  | { mode: "idle" }
  | {
      mode: "summary";
      query?: string;
      contacts: PanelContact[];
      groups?: SummaryGroup[];
      total: number;
    }
  | {
      mode: "contact";
      contact: PanelContact & {
        email?: string;
        phone?: string;
        companyName?: string;
      };
      opportunities: PanelOpportunity[];
      appointments: PanelAppointment[];
      tasks: PanelTask[];
      notes: PanelNote[];
      lastMessage: PanelLastMessage | null;
      prevSummary?: Extract<PanelState, { mode: "summary" }>;
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ConversationsContextPanelProps {
  state: PanelState;
  locationId?: string;
  onContactClick?: (contact: PanelContact) => void;
  onBack?: () => void;
}

export function ConversationsContextPanel({
  state,
  locationId,
  onContactClick,
  onBack,
}: ConversationsContextPanelProps) {
  return (
    <div className="flex h-full w-[300px] flex-shrink-0 flex-col border-r border-border bg-muted/10">
      {state.mode === "idle" && <IdlePanel />}
      {state.mode === "summary" && (
        <SummaryPanel
          state={state}
          onContactClick={onContactClick}
        />
      )}
      {state.mode === "contact" && (
        <ContactPanel
          state={state}
          locationId={locationId}
          onBack={onBack}
        />
      )}
    </div>
  );
}

// ─── Idle ─────────────────────────────────────────────────────────────────────

function IdlePanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
        <Clock className="h-5 w-5 text-primary/60" />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        El contexto aparecerá aquí cuando la IA encuentre contactos o conversaciones.
      </p>
    </div>
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function SummaryPanel({
  state,
  onContactClick,
}: {
  state: Extract<PanelState, { mode: "summary" }>;
  onContactClick?: (c: PanelContact) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-foreground">
          Resumen · {state.total} {state.total === 1 ? "contacto" : "contactos"}
        </p>
        {state.query && (
          <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
            {state.query}
          </p>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {/* Aggregate groups (from aggregate tool) */}
          {state.groups && state.groups.length > 0 && (
            <div className="rounded-md border border-border/50 bg-background p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Distribución
              </p>
              <div className="space-y-1.5">
                {state.groups.slice(0, 8).map((g) => (
                  <div key={g.key} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground truncate max-w-[60%]">
                      {g.key}
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {g.sum !== undefined
                        ? `$${g.sum.toLocaleString("es-MX")}`
                        : g.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact list (from search_contacts / search_conversations) */}
          {state.contacts.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contactos
              </p>
              {state.contacts.slice(0, 10).map((c) => (
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
                    <p className="truncate text-xs font-medium">{c.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {c.source ?? c.assignedTo ?? ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60">→</span>
                </button>
              ))}
              {state.contacts.length > 10 && (
                <p className="px-2 text-center text-[10px] text-muted-foreground">
                  + {state.contacts.length - 10} más
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Contact detail ───────────────────────────────────────────────────────────

function ContactPanel({
  state,
  locationId,
  onBack,
}: {
  state: Extract<PanelState, { mode: "contact" }>;
  locationId?: string;
  onBack?: () => void;
}) {
  const { contact, opportunities, appointments, tasks, notes, lastMessage } = state;
  const pendingTasks = tasks.filter((t) => t.status !== "completed");
  const ghlUrl =
    locationId
      ? `https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`
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
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {initials(contact.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{contact.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {[contact.source, contact.assignedTo].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {/* Opportunity */}
          {opportunities.length > 0 && (
            <Section label="Oportunidad">
              {opportunities.slice(0, 1).map((o) => (
                <div key={o.id} className="rounded-md bg-background border border-border/50 p-2.5">
                  <p className="text-xs font-medium text-primary truncate">{o.name}</p>
                  <p className="mt-0.5 text-sm font-bold">
                    ${o.value.toLocaleString("es-MX")}
                    {o.currency ? ` ${o.currency}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Chip>{o.pipelineName}</Chip>
                    <Chip>{o.stage}</Chip>
                    <Chip
                      className={cn(
                        o.status === "won" && "bg-green-100 text-green-800",
                        o.status === "lost" && "bg-red-100 text-red-800",
                        o.status === "open" && "bg-yellow-100 text-yellow-800"
                      )}
                    >
                      {o.status}
                    </Chip>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Appointments */}
          {appointments.length > 0 && (
            <Section label="Citas">
              {appointments.slice(0, 2).map((a) => (
                <div key={a.id} className="rounded-md bg-background border border-border/50 p-2.5">
                  <p className="text-xs text-muted-foreground">
                    📅 {formatDate(a.startTime)}
                  </p>
                  {a.title && (
                    <p className="mt-0.5 text-xs font-medium truncate">{a.title}</p>
                  )}
                  <Chip className="mt-1">{a.status}</Chip>
                </div>
              ))}
            </Section>
          )}

          {/* Tasks */}
          {pendingTasks.length > 0 && (
            <Section label={`Tareas · ${pendingTasks.length} pendiente${pendingTasks.length !== 1 ? "s" : ""}`}>
              <div className="space-y-1.5">
                {pendingTasks.slice(0, 4).map((t) => {
                  const overdue = isOverdue(t.dueDate);
                  return (
                    <div key={t.id} className="flex items-start gap-2">
                      {t.status === "completed" ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                      ) : (
                        <Circle
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
                            overdue ? "text-destructive" : "text-muted-foreground"
                          )}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs leading-tight">{t.title}</p>
                        {t.dueDate && (
                          <p
                            className={cn(
                              "text-[10px]",
                              overdue ? "text-destructive" : "text-muted-foreground"
                            )}
                          >
                            {overdue ? "⚠ Vencida · " : ""}
                            {formatDate(t.dueDate)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Notes */}
          {notes.length > 0 && (
            <Section label="Notas">
              <div className="rounded-md bg-background border border-border/50 p-2.5">
                <p className="text-[10px] text-muted-foreground">
                  {formatDate(notes[0].dateAdded)}
                </p>
                <p className="mt-1 text-xs leading-relaxed line-clamp-4">
                  {notes[0].body}
                </p>
                {notes.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    + {notes.length - 1} nota{notes.length > 2 ? "s" : ""} más
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Last message */}
          {lastMessage && (
            <Section label="Último mensaje">
              <div className="rounded-md bg-background border border-border/50 p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[10px] text-muted-foreground">
                    {lastMessage.direction === "inbound" ? "↙ Entrante" : "↗ Saliente"} · {lastMessage.source}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex-shrink-0">
                    {relativeTime(lastMessage.createdAt)}
                  </p>
                </div>
                <p className="text-xs leading-relaxed line-clamp-3">
                  {lastMessage.content ?? "(sin contenido)"}
                </p>
                {lastMessage.direction === "inbound" && (
                  <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠ Sin respuesta del asesor
                  </p>
                )}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      {/* GHL link */}
      {ghlUrl && (
        <div className="border-t border-border px-4 py-2.5">
          <a
            href={ghlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Ver en Lezgo Suite
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Shared tiny components ───────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/conversations-context-panel.tsx
git commit -m "feat: create ConversationsContextPanel adaptive left panel"
```

---

## Task 8: Create `components/dashboard/conversations-chat.tsx`

**Files:**
- Create: `components/dashboard/conversations-chat.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  Sparkles,
  RefreshCcw,
  Square,
  AlertCircle,
  ArrowUpRight,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatDataset } from "@/lib/ai-tools";
import { buildDatasetSummary, CONVERSATIONS_SYSTEM_PROMPT } from "@/lib/ai-context";
import {
  useAgentLoop,
  type UIMessage,
  type TextBlock,
  type ToolUseBlock,
  type ToolResultBlock,
} from "@/hooks/use-agent-loop";
import {
  ConversationsContextPanel,
  type PanelState,
  type PanelContact,
  type PanelOpportunity,
  type PanelAppointment,
  type PanelTask,
  type PanelNote,
  type PanelLastMessage,
} from "@/components/dashboard/conversations-context-panel";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConversationsChatProps {
  dataset: ChatDataset;
  locationId?: string;
}

// ─── Panel state updater ──────────────────────────────────────────────────────

function buildPanelContactFromRow(row: Record<string, unknown>): PanelContact {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    source: row.source ? String(row.source) : undefined,
    assignedTo: row.assignedTo ? String(row.assignedTo) : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
    lastActivity: row.lastActivity ? String(row.lastActivity) : undefined,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "¿Qué leads de Meta no han respondido en más de 24h?",
  "Dame el perfil completo de [nombre del lead]",
  "¿Quién tiene tareas vencidas hoy?",
  "Redacta un follow-up para el lead más urgente.",
];

export function ConversationsChat({
  dataset,
  locationId,
}: ConversationsChatProps) {
  const [input, setInput] = useState("");
  const [panelState, setPanelState] = useState<PanelState>({ mode: "idle" });
  const prevSummaryRef = useRef<Extract<PanelState, { mode: "summary" }> | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Use the conversations-focused system prompt by injecting it via datasetSummary.
  // The /api/chat route prepends CHAT_SYSTEM_PROMPT from the server; we override it
  // by passing a custom header in the POST body. Instead, we embed the conversations
  // prompt into the first user message as a system context block — keeping /api/chat
  // unchanged.
  //
  // Implementation: pass the conversations system prompt as part of datasetSummary
  // so it lands in the cached system block of /api/chat.
  const datasetSummary = useMemo(() => {
    const base = buildDatasetSummary(dataset, locationId);
    return `${CONVERSATIONS_SYSTEM_PROMPT}\n\n${base}`;
  }, [dataset, locationId]);

  // ─── Panel updater (called by hook after each tool executes) ───────────────

  const onToolExecuted = useCallback(
    (name: string, input: Record<string, unknown>, result: unknown) => {
      const r = result as Record<string, unknown>;

      if (name === "search_contacts") {
        const rows = Array.isArray(r?.rows) ? (r.rows as Record<string, unknown>[]) : [];
        if (rows.length > 1) {
          const contacts = rows.map(buildPanelContactFromRow);
          const summary: Extract<PanelState, { mode: "summary" }> = {
            mode: "summary",
            contacts,
            total: typeof r.returned === "number" ? r.returned : rows.length,
          };
          prevSummaryRef.current = summary;
          setPanelState(summary);
        } else if (rows.length === 1) {
          const c = buildPanelContactFromRow(rows[0]);
          setPanelState((prev) => ({
            mode: "contact",
            contact: { ...c, email: String(rows[0].email ?? ""), phone: String(rows[0].phone ?? "") },
            opportunities: [],
            appointments: [],
            tasks: [],
            notes: [],
            lastMessage: null,
            prevSummary: prev.mode === "summary" ? prev : undefined,
          }));
        }
        return;
      }

      if (name === "aggregate") {
        const groups = Array.isArray(r?.groups) ? (r.groups as Record<string, unknown>[]) : [];
        const summary: Extract<PanelState, { mode: "summary" }> = {
          mode: "summary",
          contacts: [],
          total: typeof r.total === "number" ? r.total : 0,
          groups: groups.map((g) => ({
            key: String(g.key ?? ""),
            count: typeof g.count === "number" ? g.count : 0,
            sum: typeof g.sum === "number" ? g.sum : undefined,
          })),
        };
        prevSummaryRef.current = summary;
        setPanelState(summary);
        return;
      }

      if (name === "search_conversations") {
        const threads = Array.isArray(r?.threads) ? (r.threads as Record<string, unknown>[]) : [];
        const contacts: PanelContact[] = threads.map((t) => ({
          id: String(t.contactId ?? ""),
          name: String(t.contactId ?? ""),
        }));
        const summary: Extract<PanelState, { mode: "summary" }> = {
          mode: "summary",
          contacts,
          total: typeof r.returned === "number" ? r.returned : threads.length,
        };
        prevSummaryRef.current = summary;
        setPanelState(summary);
        return;
      }

      if (name === "get_contact") {
        const c = r as Record<string, unknown>;
        setPanelState((prev) => ({
          mode: "contact",
          contact: {
            id: String(c.id ?? ""),
            name: String(c.name ?? ""),
            email: String(c.email ?? ""),
            phone: String(c.phone ?? ""),
            source: c.source ? String(c.source) : undefined,
            assignedTo: c.assignedTo ? String(c.assignedTo) : undefined,
            companyName: c.companyName ? String(c.companyName) : undefined,
            tags: Array.isArray(c.tags) ? (c.tags as string[]) : undefined,
          },
          opportunities: [],
          appointments: [],
          tasks: [],
          notes: [],
          lastMessage: null,
          prevSummary: prev.mode === "summary" ? prev : prevSummaryRef.current ?? undefined,
        }));
        return;
      }

      if (name === "get_contact_related") {
        const opps = Array.isArray(r?.opportunities) ? (r.opportunities as Record<string, unknown>[]) : [];
        const appts = Array.isArray(r?.appointments) ? (r.appointments as Record<string, unknown>[]) : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            opportunities: opps.map((o) => ({
              id: String(o.id ?? ""),
              name: String(o.name ?? ""),
              pipelineName: String(o.pipeline ?? ""),
              stage: String(o.stage ?? ""),
              status: String(o.status ?? "open"),
              value: typeof o.value === "number" ? o.value : 0,
              currency: o.currency ? String(o.currency) : undefined,
            })),
            appointments: appts.map((a) => ({
              id: String(a.id ?? ""),
              title: a.title ? String(a.title) : undefined,
              startTime: String(a.startTime ?? ""),
              status: String(a.status ?? ""),
            })),
          };
        });
        return;
      }

      if (name === "get_contact_messages") {
        const rows = Array.isArray(r?.rows) ? (r.rows as Record<string, unknown>[]) : [];
        const last = rows[0];
        if (last) {
          const lastMessage: PanelLastMessage = {
            direction: (last.direction as "inbound" | "outbound") ?? "inbound",
            source: String(last.source ?? ""),
            content: last.content ? String(last.content) : undefined,
            createdAt: String(last.createdAt ?? ""),
          };
          setPanelState((prev) => {
            if (prev.mode !== "contact") return prev;
            return { ...prev, lastMessage };
          });
        }
        return;
      }

      if (name === "get_contact_tasks") {
        const tasks = Array.isArray(r?.tasks) ? (r.tasks as Record<string, unknown>[]) : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            tasks: tasks.map((t) => ({
              id: String(t.id ?? ""),
              title: String(t.title ?? ""),
              status: (t.status as "pending" | "completed") ?? "pending",
              dueDate: t.dueDate ? String(t.dueDate) : undefined,
            })),
          };
        });
        return;
      }

      if (name === "get_contact_notes") {
        const notes = Array.isArray(r?.notes) ? (r.notes as Record<string, unknown>[]) : [];
        setPanelState((prev) => {
          if (prev.mode !== "contact") return prev;
          return {
            ...prev,
            notes: notes.map((n) => ({
              id: String(n.id ?? ""),
              body: String(n.body ?? ""),
              userId: n.userId ? String(n.userId) : undefined,
              dateAdded: String(n.dateAdded ?? ""),
            })),
          };
        });
        return;
      }
    },
    []
  );

  const { messages, busy, status, error, totalCost, totalTools, send, stop, reset } =
    useAgentLoop({ datasetSummary, dataset, onToolExecuted });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    send(text);
  }, [input, busy, send]);

  const handleReset = useCallback(() => {
    reset();
    setPanelState({ mode: "idle" });
    prevSummaryRef.current = null;
  }, [reset]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleContactClick = useCallback((contact: PanelContact) => {
    setPanelState((prev) => ({
      mode: "contact",
      contact: { ...contact, email: undefined, phone: undefined },
      opportunities: [],
      appointments: [],
      tasks: [],
      notes: [],
      lastMessage: null,
      prevSummary: prev.mode === "summary" ? prev : undefined,
    }));
  }, []);

  const handleBack = useCallback(() => {
    if (prevSummaryRef.current) {
      setPanelState(prevSummaryRef.current);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-112px)] overflow-hidden">
      {/* Left: Adaptive context panel */}
      <ConversationsContextPanel
        state={panelState}
        locationId={locationId}
        onContactClick={handleContactClick}
        onBack={handleBack}
      />

      {/* Right: Chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Chat de Conversaciones</p>
            <p className="text-[10px] text-muted-foreground">
              Pregunta sobre contactos, conversaciones, tareas y notas en vivo.
            </p>
          </div>
          <div className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
            Sonnet 4.6 · {totalTools} {totalTools === 1 ? "herramienta" : "herramientas"} · ~${totalCost.toFixed(4)}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          {messages.length === 0 && !busy && (
            <ConvEmptyState onSuggest={(s) => setInput(s)} />
          )}

          {messages.map((m, i) => (
            <ConvMessageBubble key={i} message={m} />
          ))}

          {busy && status && (
            <div className="flex items-center gap-2.5 py-1 text-xs text-muted-foreground">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              {status}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-border px-5 py-4">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="¿Qué leads de Meta no han respondido en más de 24h?"
            rows={2}
            className="min-h-[52px] w-full resize-none text-sm"
            disabled={busy}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={busy || messages.length === 0}
              className="h-7 gap-1.5 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCcw className="h-3 w-3" />
              Reiniciar
            </Button>
            <div className="flex items-center gap-1.5">
              {busy && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stop}
                  className="h-7 gap-1.5 px-3 text-[10px]"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Detener
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={busy || !input.trim()}
                className="h-7 gap-1.5 px-3 text-[10px]"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {!busy && "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ConvEmptyState({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Sugerencias
        </p>
        <div className="flex flex-col gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="group flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/15 px-3.5 py-2.5 text-left text-sm text-foreground/70 transition-all hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
            >
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/40 group-hover:text-primary/80" />
              <span className="leading-snug">{s}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/40">
        Tareas y notas se obtienen en vivo de GoHighLevel. Conversaciones reales, no muestras.
      </p>
    </div>
  );
}

function ConvMessageBubble({ message }: { message: UIMessage }) {
  const textBlocks = message.blocks.filter(
    (b): b is TextBlock => b.type === "text"
  );
  const toolUseBlocks = message.blocks.filter(
    (b): b is ToolUseBlock => b.type === "tool_use"
  );
  const toolResultBlocks = message.blocks.filter(
    (b): b is ToolResultBlock => b.type === "tool_result"
  );

  if (
    message.role === "user" &&
    toolResultBlocks.length > 0 &&
    textBlocks.length === 0
  ) {
    const errors = toolResultBlocks.filter((b) => b.is_error).length;
    const ok = toolResultBlocks.length - errors;
    return (
      <div className="flex items-center gap-1 self-start rounded-full border border-border/40 bg-muted/25 px-2 py-0.5 text-[10px] text-muted-foreground">
        <span className="opacity-50">↳</span>
        <span>
          {ok} resultado{ok !== 1 ? "s" : ""}
          {errors > 0 ? `, ${errors} error${errors !== 1 ? "es" : ""}` : ""}
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {textBlocks.map((b, i) => (
        <div
          key={`t-${i}`}
          className={cn(
            "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
            isUser
              ? "bg-primary/90 text-primary-foreground"
              : "bg-muted/40 text-foreground ring-1 ring-inset ring-border/25"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{b.text}</p>
          ) : (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold",
                "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
                "prose-table:my-2 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-th:bg-muted/50 prose-td:px-2 prose-td:py-1",
                "prose-code:rounded prose-code:bg-background/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
                "prose-strong:text-foreground prose-a:text-primary"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
      {toolUseBlocks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(
            toolUseBlocks.reduce<Record<string, number>>((acc, b) => {
              acc[b.name] = (acc[b.name] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([name, count]) => (
            <div
              key={name}
              className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <Wrench className="h-2.5 w-2.5 shrink-0" />
              <span className="font-medium text-foreground/70">{name}</span>
              {count > 1 && (
                <span className="rounded-full bg-border/70 px-1 font-mono leading-tight">
                  ×{count}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/conversations-chat.tsx
git commit -m "feat: create ConversationsChat full-page AI chat with adaptive panel"
```

---

## Task 9: Wire `page.tsx`, remove `conversations-dashboard.tsx`

**Files:**
- Modify: `app/page.tsx`
- Delete: `components/dashboard/conversations-dashboard.tsx`

- [ ] **Step 1: Update `app/page.tsx`**

Change the import at the top:
```typescript
// Remove:
import { ConversationsDashboard } from "@/components/dashboard/conversations-dashboard"
// Add:
import { ConversationsChat } from "@/components/dashboard/conversations-chat"
```

Replace the `ConversationsDashboard` usage in the render (around line 226):
```typescript
// Remove:
        ) : (
          <ConversationsDashboard
            contacts={contacts}
            opportunities={opportunities}
            pipelines={data?.pipelines ?? []}
            members={availableMembers}
            availableTags={availableTags}
          />
        )}

// Add:
        ) : (
          <ConversationsChat
            dataset={{
              contacts,
              opportunities,
              pautas: data?.pautas ?? [],
              appointments,
              messages,
              tasks: data?.tasks ?? [],
              calls,
            }}
            locationId={data?.locationId}
          />
        )}
```

- [ ] **Step 2: Delete `conversations-dashboard.tsx`**

```bash
rm components/dashboard/conversations-dashboard.tsx
```

- [ ] **Step 3: Verify the app builds and runs**

```bash
npm run dev
```

Open `http://localhost:3000` and click the **Conversaciones** tab.  
Expected:
- The filter wizard is gone
- A two-column layout appears: narrow left panel + chat on right
- Left panel shows an idle state with a clock icon and helper text
- Suggestion chips appear in the chat area
- Typing a question and pressing Enter sends it
- The AI responds and the left panel updates with context

- [ ] **Step 4: Test the golden path**

Send this message in the chat:
```
¿Qué contactos de Meta no han respondido en más de 24 horas?
```
Expected:
- Tool chips appear: `search_contacts`, possibly `aggregate`
- Left panel switches to **summary mode** with a contact list
- AI responds with a count and list of names

Then click one of the contacts in the left panel.  
Expected: Left panel switches to **contact mode** with the contact's details.

Then send:
```
Dame el perfil completo con tareas y notas
```
Expected:
- Tool chips: `get_contact_related`, `get_contact_tasks`, `get_contact_notes`, `get_contact_messages`
- Left panel enriches progressively with opportunities, tasks, notes, last message

- [ ] **Step 5: Verify the existing AI chat sidebar still works**

Click "Analizar con IA" in the header.  
Expected: The Sheet sidebar opens, functions identically to before (uses the refactored `AIChatPanel`).

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git rm components/dashboard/conversations-dashboard.tsx
git commit -m "feat: wire ConversationsChat into Conversations tab, remove old dashboard"
```

---

## Self-Review Notes

- All `PanelState` types defined in Task 7 are consumed correctly in Task 8 (`mode: "contact"`, `mode: "summary"`, `mode: "idle"`).
- `onToolExecutedRef.current` in the hook (Task 4) keeps the latest callback without re-creating `runWithMessages` — avoids stale closure on `onToolExecuted`.
- `CONVERSATIONS_SYSTEM_PROMPT` is injected via `datasetSummary` (Task 8) so `/api/chat` needs no changes — it lands in the ephemeral cache block alongside the dataset.
- `prevSummaryRef` in `ConversationsChat` tracks the last summary so the back button in contact detail can restore it without a re-query.
- The `search_conversations` tool result in `onToolExecuted` builds a contact list from thread contactIds — names will be raw IDs until the AI resolves them. This is acceptable since the AI will typically call `search_contacts` before or after `search_conversations`.
- No changes to `/api/chat`, `lib/ai-tools.ts` executor logic, or `AIChatPanel` UI.
