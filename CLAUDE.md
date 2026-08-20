# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev        # Start Next.js dev server (localhost:3000)
pnpm build      # Production build (TypeScript errors are ignored — see next.config.mjs)
pnpm start      # Serve production build
pnpm lint       # Run ESLint

# Multi-client
pnpm add-client # Add a client to the DASHBOARD_CLIENTS roster (prompts, validates, prints the blob)
                #   Non-interactive: pnpm add-client --name "X" --location <id> --token pit-…
                #   It APPENDS to the roster it reads from DASHBOARD_CLIENTS, which is why the
                #   script loads .env.local. Run it without that env and it silently starts a
                #   NEW roster of one — paste that blob into Vercel and every other client is
                #   gone. Always check the "Current roster (N)" line it prints first.
                #   Full runbook: docs/alta-de-clientes.md

# Verification (see below — there is no test framework)
pnpm verify:clients      # lib/clients.ts   — roster parsing + password lookup
pnpm verify:auth         # lib/auth.ts      — session token; incl. the cookie-tamper rejection
pnpm verify:limiter      # lib/ghl-limiter.ts — per-location isolation
pnpm verify:attachments  # lib/attachments.ts + lib/attachment-tools.ts — tabular parse/query/join
pnpm verify:pagination   # lib/ghl-client.ts — offset→cursor handoff (hits live GHL, read-only)
pnpm verify:sync-store   # lib/sync-store.ts — freshness window, gzip round-trip, lock
                         #   (DB assertions run only when DATABASE_URL is set)
pnpm db:migrate          # creates the project_sync cache table (idempotent)
npx tsc --noEmit         # REQUIRED: next build ignores TS errors, so a green build proves nothing
```

**No test framework, and not adopting one.** Instead, the three pure modules where a
silent bug would be a *cross-tenant data leak* have assertion scripts under
`scripts/verify-*.ts` (plain `node:assert/strict`, run via `tsx`). Run them after
touching auth, the roster, or the limiter. Everything else is verified by driving the
real app.

Gotcha when writing these scripts: this package is CommonJS (no `"type": "module"`),
so `tsx` compiles to CJS where **top-level `await` fails**. Wrap async work in a
`main()` and call `main().catch(...)` — see the existing scripts.

**Package manager: pnpm.** This repo is managed with pnpm (`packageManager: pnpm@11.x`
in `package.json`), and the Vercel deploy runs `pnpm install --frozen-lockfile` against
`pnpm-lock.yaml`. **Install and add dependencies with `pnpm install` / `pnpm add <pkg>`
— never `npm install`.** Running `npm install` writes `package-lock.json` but leaves
`pnpm-lock.yaml` stale, which makes the Vercel build fail with
`ERR_PNPM_OUTDATED_LOCKFILE`. If a lockfile ever drifts, run `pnpm install
--lockfile-only` to resync only the lockfile (no `node_modules` churn), then commit it.
A tracked `package-lock.json` lingers from before the switch; it is **not** the source
of truth — ignore it.

## Environment Variables

Required vars in `.env.local`:
- `DASHBOARD_CLIENTS` — JSON array of clients, one per GHL sub-account:
  `[{"id","name","locationId","ghlToken","password"?}]`. `password` is optional and
  defaults to that client's `locationId`. Use `npm run add-client` to extend it safely.
- `DASHBOARD_AUTH_SECRET` — random string used to HMAC-sign the session cookie (`openssl rand -hex 32`)
- `ANTHROPIC_API_KEY` — used by `app/api/chat` (assistant), `analyze-report` (PDF analyses)
  and `analyze-contact`
- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` — Neon, injected by the Vercel Marketplace
  integration. **Optional**: without them the app simply syncs live from GHL on every
  load, which is exactly how it behaved before the cache existed.
- `GHL_API_TOKEN` / `GHL_LOCATION_ID` — **not read by the app.** Kept only so the dev
  GHL MCP server (`.mcp.json`) can point at one sub-account.

All are server-side only. `DASHBOARD_CLIENTS` is read in `lib/clients.ts`;
`DASHBOARD_AUTH_SECRET` in `lib/auth.ts`, `app/api/auth/login/route.ts`, and
`middleware.ts` — never exposed to the browser.

## Architecture

This is a single-page Next.js 16 (App Router) dashboard that surfaces GoHighLevel CRM data in three tabs: **Marketing**, **Ventas**, and **Asistente IA**. It is **multi-tenant**: one deployment serves every client, and a client's password resolves to their own GHL sub-account (see "Multi-client" below).

### Current state

- `components/dashboard/marketing-dashboard.tsx` and `components/dashboard/sales-dashboard.tsx` — **fully built**: each receives already-filtered data as props and renders its own set of charts, KPI cards, and drill-down drawers.
- The third tab (`DashboardTab` id `"conversations"`, labelled **"Asistente IA"**) renders `conversations-chat.tsx`. It is **permanently mounted and merely hidden** when inactive, so the chat history survives tab switches — do not make it conditional. It always sees the full, unfiltered dataset.
- Both dashboards can **export a branded PDF report** of their own charts (see "PDF report export").

### Data flow

```
browser → middleware.ts (verifies the signed dash_session cookie)
    ↓
app/api/dashboard/route.ts
    ↓  requireClient()  → resolves the cookie's client id to a ClientConfig (lib/session.ts)
    ↓  withClient(...)  → establishes the per-request credential context (lib/ghl-context.ts)
    ↓
lib/ghl-client.ts  (raw GHL types + fetch helpers; reads token+location from the context)
    ↓  lib/ghl-limiter.ts  (concurrency + rate limiting, keyed PER LOCATION)
GHL REST API (services.leadconnectorhq.com)
    ↓  back up: transforms GHL → internal types; contacts/opps/pautas/appointments/tasks fetched concurrently
    ↓  NDJSON stream of {progress|location|step|data|error} frames
hooks/fetch-stream.ts  (parses the NDJSON stream)
    ↓
hooks/use-dashboard-data.ts  (custom streaming fetcher; exposes data, progress text, and structured per-dataset `steps`. No SWR/caching — refresh() re-runs the full sync)
    ↓
app/page.tsx  (tab state, date-filter state, applies the client-side date-range filter, renders dashboard)
    ↓
components/dashboard/{marketing,sales}-dashboard.tsx
```

Beyond that main sync, the app has these routes. Every one that touches GHL runs through
`requireClient()` + `withClient()`; the ones marked **no GHL** work off data the browser
already holds and need only the middleware gate:

| Route | Purpose |
|---|---|
| `dashboard` | the main NDJSON sync above |
| `dashboard-messages` | NDJSON stream of conversation messages, loaded separately from the main sync |
| `conversations` | on-demand full message threads for a batch of contacts |
| `contact-notes` / `contact-tasks` | per-contact detail, fetched live when a drawer opens |
| `analyze-contact` | Anthropic call summarizing one contact (does read GHL for the opportunity) |
| `chat` | one Anthropic turn for the AI assistant — **no GHL** |
| `analyze-report` | Anthropic pass writing the PDF report's analyses — **no GHL** |
| `auth/login` / `auth/logout` | session cookie |

Client-side data hooks mirror this: `use-dashboard-data.ts` (main sync),
`use-conversations-data.ts` (messages), `use-agent-loop.ts` (the AI agent loop), all
built on `fetch-stream.ts` for the NDJSON routes.

### Multi-client (multi-tenancy)

One deployment serves every client. **The password IS the client's identity.**

1. `lib/clients.ts` — the roster, parsed from `DASHBOARD_CLIENTS`. This is the
   **seam**: nothing downstream knows the roster comes from an env var, so swapping
   in a database later touches only this file.
2. Login (`app/api/auth/login/route.ts`) looks the submitted password up across the
   roster (`findClientByPassword` — constant-time, no early return) and HMAC-signs
   the matched client's id into the `dash_session` cookie:
   `<clientId>.<expiryMs>.<hmac>`. The id is inside the signed payload, so a client
   cannot edit their cookie to reach another client's data.
3. Every GHL-touching route calls `requireClient()` (`lib/session.ts`), which
   re-verifies the cookie **itself** — it deliberately does not trust a
   middleware-injected header, which would be a spoofing surface. Middleware only
   verifies the signature; resolving the client there would drag the roster into the
   Edge bundle.
4. The route runs its GHL work inside `withClient(client, ...)`
   (`lib/ghl-context.ts`, an `AsyncLocalStorage`). `ghlFetch` reads credentials via
   `currentClient()`, which is why none of its ~113 exported functions needed a
   signature change. `currentClient()` **fails closed** — it throws rather than
   falling back to a default token.
5. `lib/ghl-limiter.ts` keys the concurrency semaphore, token bucket, and 429
   cooldown **by location id**, because GHL's budget is per location. Shared, one
   client's 429 would freeze every other client's sync.

**NEVER** replace the AsyncLocalStorage context with a module-level "current client"
variable: one serverless instance serves overlapping requests, so that would
silently serve client A's dashboard using client B's token.

**Password model — a deliberate, informed tradeoff. Do not "fix" it unprompted.**
A client's password defaults to their GHL `locationId`. That id is *not* a secret
(it appears in GHL URLs, embed codes, webhook payloads, Make scenarios) and it
**cannot be rotated**. The owner accepted this knowingly, for the convenience of
having nothing extra to manage. The escape hatch is already built in: the optional
`password` field on a client entry overrides the default, so any single client can be
given a real, rotatable password by adding one line — no migration, no code change.
Suggest that if a password leaks; don't rewrite the model on your own initiative.

The two streaming routes (`dashboard`, `dashboard-messages`) enter the context
**inside** the `ReadableStream` `start()` callback — the stream outlives the
handler's return, so wrapping the handler would leave the pump running outside the
context.

`app/api/chat` and `app/api/analyze-report` never touch GHL (they work off data the
browser already holds), so they need no client context — only the middleware gate.

Verification scripts (no test framework in this repo): `npm run verify:clients`,
`verify:auth`, `verify:limiter`.

### Loading & progress

The dashboard fetch streams NDJSON progress frames rather than returning a single JSON blob, so the UI can show live progress during the multi-second GHL sync:
- `{ type: "location", name }` — sub-account name (resolved first, for the loading header).
- `{ type: "step", key, status, count }` — structured per-dataset progress. `key` ∈ `config | contacts | opportunities | pautas | appointments | tasks`; `status` ∈ `loading | done`. Because those datasets are fetched **concurrently**, the loading screen (`components/dashboard/loading-screen.tsx`) renders one live row per dataset with a running count, plus a determinate progress bar driven by completed-step count.
- `{ type: "progress", message }` — human-readable fallback text.
- `{ type: "data", ... }` / `{ type: "error", ... }` — terminal frames.

### AI assistant

The assistant is an **agent loop that runs in the browser**, not on the server.

- `app/api/chat/route.ts` handles exactly **one Anthropic turn per request**. When the
  model returns `tool_use` blocks the server just returns them; `hooks/use-agent-loop.ts`
  executes the tools locally and POSTs back with `tool_result` blocks. The server holds
  **no session state** between turns.
- `lib/ai-tools.ts` — the ~22 `TOOL_DEFINITIONS` and their executor. Most tools
  (`search_*`, `aggregate`, `relate`, `get_*`) run **against the dataset the browser
  already holds** — no extra GHL calls. The exceptions reach back through
  `lib/ghl-fetchers.ts` for data not in the initial sync: `get_contact_messages`,
  `search_conversations`, `get_contact_tasks`, `get_contact_notes`.
- UI-side tools: `render_chart` → `chat-chart.tsx`, `ask_user` → `chat-question.tsx`,
  `show_in_panel` → the conversations context panel, `create_pdf` / `export_csv` →
  direct browser downloads.
- `lib/ai-context.ts` — the Spanish system prompt. It carries hard-won behavioral rules
  (date-window consistency, never concluding from a truncated message sample, `lostReason`
  being a native field, never printing IDs). **Treat those numbered rules as regression
  fixes, not prose** — each one exists because the model got it wrong. Don't trim them
  for brevity.
- `lib/ai-index.ts` — `buildChatIndex()` precomputes the by-contact lookup maps
  (`oppsByContact`, `pautasByContact`, `pautaNameByContact`, …), cached on the contacts
  array reference so it survives within a single agent run.
- `datasetSummary` is built once on the client and pinned for **prompt caching**; keep
  it stable across turns in a session or the cache key breaks.

### Pauta (paid-advertising) classification

`lib/pauta.ts` is the **single source of truth** for what counts as "de pauta", shared by
the marketing charts and the AI tools. Do not re-inline this logic anywhere.

- `isDePauta(opp, pautaContacts)` — a deliberate **union**: the contact is linked to a
  Pauta custom-object record **OR** the opportunity itself carries a paid-traffic
  source/medium (`isPaidTraffic`). Neither signal alone is complete — Pauta records come
  from a Make scenario and don't always exist, and not every paid lead keeps its UTM — so
  each covers the other's gaps.
- `resolveCampaignName()` — an ordered fallback chain, since sub-accounts name the field
  differently ("Nombre pauta", "Nombre de la pauta", …) and some accounts have no
  attribution URL at all.
- Totals legitimately differ between grouping modes; that's by design, not a bug.

### PDF report export

Both dashboards export a branded PDF via `components/dashboard/export-report-button.tsx`.

- `lib/report.ts` composes a `ReportInput` (KPIs + `ReportSection[]`) from the dashboard's
  **already-computed aggregates** — deterministic code, not the model.
- `app/api/analyze-report/route.ts` then makes one Haiku pass that writes an executive
  summary plus one analysis per section. Sections are analyzed **by default**; `ai: false`
  opts out. Token budget is sized to the section count (~13 marketing / ~8 ventas) — if you
  add sections, check it still fits.
- `lib/pdf/*` renders the spec with pdfmake: `build-pdf.ts` (doc definition — **LETTER
  landscape**, 712pt usable width), `charts.ts` (hand-drawn canvas charts), `blocks.ts`
  (tables/KPIs), `branding.ts` (palette, `sanitizeBrand`).
- The same `create_pdf` spec/renderer backs the AI assistant's PDF tool, so both outputs
  share one format. Changing `lib/pdf/*` affects both.
- **Brand rule**: `sanitizeBrand()` strips "GoHighLevel"/"GHL" from all rendered text —
  the platform is presented as "Lezgo Suite CRM". The AI prompts carry the same rule.
- pdfmake **cannot render in a bare Node harness** — verify PDF changes by building and
  driving the real app.

### Sync cache (Neon Postgres)

A full GHL sync takes tens of seconds, and it used to run on **every page load**. The
cache removes GHL from the normal path: the route reads one row of already-assembled
payload and ships it.

```
GET /api/dashboard
    ↓  requireClient()      → the ClientConfig (unchanged)
    ↓  readCache(client)    → the project_sync row
    ├─ hit  → ship the payload immediately; if older than 15 min,
    │         after(() => refreshInBackground()) once the response is out
    └─ miss → live sync with the loading screen, then cache the result
```

| File | Responsibility |
|---|---|
| `lib/db.ts` | The Neon client. **The seam** — nothing downstream knows the database is Neon, the same way nothing knows the roster comes from an env var. `getSql()` is lazy: Next evaluates top-level module code at build time, so an eager `neon()` would break `next build` before the database exists. |
| `lib/sync-store.ts` | `readSync` / `writeSync` / `claimSync` / `releaseSync` / `isStale`. The only module that knows the table. Compression lives here. |
| `lib/sync.ts` | `syncProject(client, onFrame?)` — the GHL orchestration, extracted from the route so the route and the background refresh run the **same** code. Two copies would drift, and the background one would drift silently. |
| `scripts/db-migrate.ts` | `CREATE TABLE IF NOT EXISTS`, idempotent. DDL goes through `DATABASE_URL_UNPOOLED` — pgbouncer in transaction mode interferes with schema changes. |

Invariants, each of which exists because something broke first:

- **The database is an accelerator, never a dependency.** Every failure is logged and
  falls back to a live sync. Adding the cache must not create a new way for the
  dashboard to fail to load. Verify by pointing `DATABASE_URL` at an invalid host.
- **The cache is disposable.** One row per client, overwritten whole, present only —
  no history. Drop the table and it refills itself. That property is what keeps this
  one table instead of a schema, and keeps historical personal data from accumulating.
- **`bytea` + gzip, not `jsonb`.** The payload is never queried from the inside, only
  shipped whole, so `jsonb` would buy parsing cost on both ends. Measured ~11x smaller.
- **This deployment needs its OWN Neon**, and has one: endpoint
  `ep-frosty-term-awf7asfw` (Neon project `snowy-dawn-00376789`). The internal
  panel (`dashboards-internos-lezgo`) is a *different* database entirely
  (`ep-winter-brook-avuhndg1`) — never point one at the other. `project_id` is
  the primary key and the two deployments have historically used overlapping
  client ids, so a shared database would have them silently overwrite each
  other's payloads. Verify the endpoint before running anything destructive.
- **Who serves whom.** This deployment serves the *external* clients — as of
  2026-08-19: `hausmen`, `kapitaliza`, `rise-29`, `stanza-residencial`. Condesa,
  Lezgo Suite, Plaza Bosques and Grand Center were moved to the internal panel
  and **deliberately removed** from this roster. A login that fails for one of
  those is the intended behavior, not an outage.
- **`claimSync` decides inside the `WHERE` of the UPDATE**, never read-then-write in
  TypeScript: that would leave a window where two requests both see the lock free.
  The lock self-heals after 10 minutes so a function dying mid-sync cannot freeze a
  client forever.
- **`releaseSync` never touches the payload.** A failed refresh must leave the last
  good cache in place — an hour-old dashboard beats no dashboard.
- **`synced_at` comes from the payload, not `now()`**: it records when GHL was read,
  which is what the header's "Actualizado hace X" means.
- **`after()` is scheduled in the handler scope**, not inside the stream. Without it
  the function is torn down when the response closes and the refresh never runs.
  `cookies()` is unavailable both inside the stream callback and inside `after()`.
- **`maxDuration = 300` needs Fluid Compute ON** (Settings → Functions) — it is *not*
  a paid-plan feature. With Fluid off the ceiling is 60s and a real 60.3s sync gets
  cut silently, long after the response was sent; the only symptom is an
  "Actualizado hace X" that stops advancing.
- The header shows **relative** age, never clock time: a cache whose age is not
  visible lies by omission. The loading screen waits 300 ms before appearing so a
  cached read does not flash it.

### Key design decisions

- **No mock-data fallback**: when the GHL API is unavailable or errors, the UI renders against empty arrays (`data?.contacts ?? []` patterns in `app/page.tsx`). The former `lib/mock-data.ts` and its stand-ins have been removed.
- **All GHL API calls are server-only**: `lib/ghl-client.ts` is never imported from client components — only from API routes. This keeps the token out of the browser bundle. Client code reaches GHL data through `lib/ghl-fetchers.ts`, which calls those routes.
- **`/opportunities/search` uses `location_id` (snake_case)** while most other endpoints use `locationId` (camelCase). The `useSnakeCaseLocationId` flag in `ghlFetch` handles this quirk.
- **Offset pagination dies at 10,000 records.** GHL's search endpoints are
  Elasticsearch-backed and reject any request whose offset reaches 10k:
  `/opportunities/search` → `400 SEARCH_USE_START_AFTER_PAGINATION`,
  `/objects/:key/records/search` → `400 "Invalid request body"`. Page 101 at
  `limit=100` is the first to fail, on every sub-account. `getAllOpportunities`
  and `getAllCustomObjectRecords` therefore paginate **hybrid**: fan out the
  offset-safe pages concurrently (fast — ~8x faster than a sequential walk),
  then hand off to the cursor (`startAfterId`+`startAfter` for opportunities,
  the per-record `searchAfter` tuple for object records) for the remainder. Do
  not "simplify" either back to a plain page fan-out: one rejected page rejects
  the whole `Promise.all`, and the caller's catch turns that into an **empty
  dataset**, so a 12k-opportunity account renders zero rows instead of 10,000.
- **Never stop a paginated walk on `meta.total`.** Those totals come from the
  same ES layer and can themselves be capped, so `length >= total` silently
  truncates big accounts while looking complete. The cursor running out is the
  only authority on the end of the data; `total` is a progress hint.
- **Filtering is entirely client-side and date-range only**: `lib/date-range.ts` (`DateFilter`, `resolveDateRange`, `filterByDateRange`) filters the already-fetched dataset by date; `components/dashboard/date-range-filter.tsx` is the UI. The filtered slices are computed in `app/page.tsx` and passed to each dashboard as props. The date filter bar is hidden on the AI assistant tab, which always sees the full dataset.
- **`calls` is always empty** in live data — GHL doesn't expose a public calls endpoint in the standard API. **`tasks` is populated** via the location-wide `/locations/:id/tasks/search` endpoint (`searchLocationTasks`), fetched concurrently with the other datasets.
- **Drill-downs resolve joins against the *unfiltered* set.** Dashboards take both
  `opportunities` (date-filtered, for display) and `allOpportunities` (everything, as a
  lookup table) — likewise `allContacts` / `allPautas` / `allAppointments`. An opportunity
  can be created outside the window that puts its contact on screen, so joining against the
  filtered slice silently drops real rows. Keep that pairing when adding a drawer.

### Internal type system

`lib/types.ts` defines the canonical internal types (`Contact`, `Opportunity`, `Pauta`, `Appointment`, `Call`, `Task`, `Message`, `Pipeline`). The API route transforms raw GHL shapes into these before returning JSON. Always work against the internal types in components — never import from `lib/ghl-client.ts` on the client side.

## GHL API Gotchas

> Full schema reference: `/Users/isaiasrios/Downloads/GHL-API-Schemas.md`

- **Version header required** on all requests: `Version: 2021-07-28` (legacy) or `2023-02-21` (current).
- **customFields shape differs between read and write**:
  - Write (create/update): `{ id, key, field_value }`
  - Read (contacts): `{ id, value }`
  - Read (opportunities): `{ id, fieldValue }`
- **Tags on contacts**: sending `tags` in update/upsert **overwrites all existing tags**. Use `/contacts/:id/tags` (POST/DELETE) for incremental changes.
- **Opportunity status** valid values: `open`, `won`, `lost`, `abandoned`, `all` (`all` is search-filter only).
- **`lostReasonId`** is only relevant when status is `"lost"`.
- **`/opportunities/search`** uses snake_case params (`location_id`, `pipeline_id`, etc.) — already handled by `useSnakeCaseLocationId` flag in `ghlFetch`.
- **Conversation `type`** is numeric in some endpoints: `1=Phone`, `2=Email`, `3=FB Messenger`, `4=Review`, `5=Group SMS`.
- **Required scopes**: `contacts.readonly/write`, `opportunities.readonly/write`, `conversations.readonly/write`.

## GHL MCP Server

An HTTP MCP server (`ghl-mcp`, configured in `.mcp.json`) connects directly to GoHighLevel's hosted MCP endpoint (`https://services.leadconnectorhq.com/mcp/`). It authenticates with the same `GHL_API_TOKEN` and `GHL_LOCATION_ID` env vars used by `lib/ghl-client.ts`.

- **Purpose**: lets Claude Code query/mutate live GHL data directly during development (inspecting real contacts, opportunities, pipelines, custom fields, conversations) without writing throwaway scripts. It is **not** part of the app's runtime data flow — the app always goes through `app/api/dashboard/route.ts` → `lib/ghl-client.ts`. Never wire MCP calls into application code.
- **Use it to**: verify real data shapes, discover pipeline/custom-field IDs, confirm API behavior, and validate transforms against production data before coding them in `route.ts`.
- **Tools** (prefixed `mcp__ghl-mcp__`), grouped:
  - `contacts_*` — get-contact, get-contacts, create/update/upsert-contact, add-tags, remove-tags, get-all-tasks
  - `opportunities_*` — get-opportunity, search-opportunity, get-pipelines, update-opportunity
  - `conversations_*` — search-conversation, get-messages, send-a-new-message
  - `locations_*` — get-location, get-custom-fields
  - `calendars_*` — get-calendar-events, get-appointment-notes
  - `payments_*` — list-transactions, get-order-by-id
  - `blogs_*`, `emails_*`, `social-media-posting_*` — content/marketing operations
- **Caution**: write tools (create/update/upsert/send/post) mutate live production data. Default to read-only tools; only use write tools when explicitly asked.

### UI components

- `components/ui/` — shadcn/ui components (generated, do not hand-edit)
- `components/dashboard/` — domain components; each dashboard component receives already-filtered data as props
- `components/dashboard/date-range-filter.tsx` is the only global filter UI; the `DateFilter` type lives in `lib/date-range.ts`
- Charts use Recharts via the shadcn chart wrapper (`components/ui/chart.tsx`)
- `components.json` controls shadcn/ui config (alias `@/components/ui`, Tailwind CSS v3)
- Shared chart chrome lives in `dashboard-ui.tsx`: `ChartCardHeader`, `ScopePill` (scope
  label + tooltip explaining a chart's rule), and `CardTone` (won/lost card tints — the
  light/dark pairs are tuned by eye, not numerically matched; don't "normalize" them)

**Chart conventions** — apply to every new chart:
- Use `NonZeroTooltipContent` so empty series don't render noise, and wire a drill-down
  drawer (`chart-drill-drawer.tsx`) — every chart should be clickable through to its records
- No visual encoding that requires a legend to decode
- Never nest a scroll container inside a card. For narrow scrollable panels use a plain
  `overflow-y-auto` div — Radix `ScrollArea` breaks `truncate`
