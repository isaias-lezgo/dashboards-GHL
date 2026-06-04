# Lazy-load conversations — design

**Date:** 2026-06-03
**Status:** Approved

## Problem

The dashboard's initial load is gated behind the most expensive fetch in the
app: the per-user conversation + message fan-out in
`app/api/dashboard/route.ts:353-429`. For each advisor it fetches up to 30
conversations (concurrency 4), then up to 50 messages per conversation
(concurrency 6) — potentially hundreds of GHL calls — all before the loading
screen clears.

The default landing tab (Marketing) never references `messages`. Only the Sales
dashboard and the Conversations tab (plus the AI chat dataset) consume them. So
this cost is paid up front by every user, including those who never open a
message-dependent view.

## Goal

Render the dashboard from core data immediately. Fetch conversations silently in
the background right after core data arrives, so the Sales/Conversations tabs are
usually ready by the time they're opened.

Non-goals: prefetch-on-hover, a caching layer beyond SWR's existing dedup, and
any change to how the AI routes consume `messages`.

## Server

### New `app/api/conversations/route.ts`

A streaming GET endpoint holding **only** the conversation logic currently in
`route.ts:353-429`:

1. Build `userMap` internally via `getUsers()` (needed for advisor attribution).
2. Per-user `getConversations({ limit: 30, assignedTo: userId })` fan-out,
   concurrency 4.
3. Dedupe conversations across users; skip `deleted`.
4. Bounded `getMessages(conv.id, { limit: 50 })` fetch, concurrency 6.
5. Transform via `ghlMessageToInternal` → `Message[]`.

Emits the same progress + `data` stream shape as the dashboard route. The `data`
event payload is `{ messages, meta: { totalMessages, fetchedAt } }`.

### `app/api/dashboard/route.ts`

- Remove the conversation block (`route.ts:353-429`).
- The `data` event no longer includes `messages`.
- `meta.totalMessages` moves to the conversations payload.
- Everything else (contacts, opportunities, appointments, pautas, pipelines,
  members, tags, campaigns, sources) is untouched.

## Client

### Shared stream helper

Lift `fetchStream` out of `hooks/use-dashboard-data.ts` into a shared module
(e.g. `hooks/fetch-stream.ts`) so both hooks reuse it. Generic over the payload
type.

### `hooks/use-dashboard-data.ts`

- Drop `messages` from `DashboardData` and from `meta` (`totalMessages`).
- Otherwise unchanged.

### New `hooks/use-conversations-data.ts`

Fetches `/api/conversations` via the shared `fetchStream`. Exposes
`{ messages, isLoading, isError }`. Fires on mount.

### `app/page.tsx`

- Call `useConversationsData()` after `useDashboardData()`. Firing on mount gives
  "background after load": the page paints from `useDashboardData`, and the
  conversations request resolves a beat later.
- Replace `const messages = data?.messages ?? []` with the value from the new
  hook.
- Pass `messages` plus a `messagesLoading` flag into the Sales dashboard and the
  Conversations tab / AI dataset.

## Loading UX

While the background conversations fetch is in flight, message-dependent UI shows
a subtle inline "Cargando conversaciones…" state rather than rendering as
empty/zero:

- Sales dashboard conversation charts and the "conversaciones" total badge.
- The Conversations tab dataset.

This prevents a fast click into Sales from looking like "0 messages." Marketing is
unaffected (it never references `messages`).

## Files touched

- `app/api/conversations/route.ts` — new
- `app/api/dashboard/route.ts` — remove conversation block
- `hooks/fetch-stream.ts` — new (lifted helper)
- `hooks/use-dashboard-data.ts` — drop messages
- `hooks/use-conversations-data.ts` — new
- `app/page.tsx` — wire new hook + loading flag
- `components/dashboard/sales-dashboard.tsx` — `messagesLoading` state on
  message panels
