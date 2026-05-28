# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev        # Start Next.js dev server (localhost:3000)
npm run build      # Production build (TypeScript errors are ignored — see next.config.mjs)
npm run start      # Serve production build
npm run lint       # Run ESLint
```

There are no automated tests in this project.

## Environment Variables

Two vars are required in `.env.local`:
- `GHL_API_TOKEN` — GoHighLevel Private Integration Token (bearer auth)
- `GHL_LOCATION_ID` — GHL location/sub-account ID

Both are read exclusively server-side inside `lib/ghl-client.ts`.

## Architecture

This is a single-page Next.js 15 (App Router) dashboard that surfaces GoHighLevel CRM data in two views: **Marketing** and **Sales**.

### Current state

- `components/dashboard/marketing-dashboard.tsx` — **empty, being rebuilt from scratch**
- `components/dashboard/sales-dashboard.tsx` — **empty, being rebuilt from scratch**
- **Removed**: `kpi-strip.tsx` and `ai-insights.tsx` have been deleted and are no longer referenced anywhere

### Data flow

```
GHL REST API (services.leadconnectorhq.com)
    ↓  server-side only
lib/ghl-client.ts  (raw GHL types + fetch helpers)
    ↓
app/api/dashboard/route.ts  (GET — transforms GHL → internal types, fetches in parallel)
    ↓  JSON
hooks/use-dashboard-data.ts  (SWR, 60 s dedup, falls back to mock data on error)
    ↓
app/page.tsx  (tab state, filter state, applies client-side filters, renders dashboard)
    ↓
components/dashboard/{marketing,sales}-dashboard.tsx
```

### Key design decisions

- **Mock data fallback** (`lib/mock-data.ts`): when the GHL API is unavailable or returns an error, the UI transparently shows mock data. `app/page.tsx` uses `data?.contacts ?? mockContacts` patterns throughout.
- **All GHL API calls are server-only**: `lib/ghl-client.ts` is never imported from client components — only from `app/api/dashboard/route.ts`. This keeps the token out of the browser bundle.
- **`/opportunities/search` uses `location_id` (snake_case)** while most other endpoints use `locationId` (camelCase). The `useSnakeCaseLocationId` flag in `ghlFetch` handles this quirk.
- **Filtering is entirely client-side**: `lib/filter-helpers.ts` filters the already-fetched dataset. Date range filtering passes `startDate`/`endDate` params to the API route, which currently does not forward them to GHL (the GHL endpoints don't uniformly support them), so date filtering is effectively client-side too.
- **`calls` and `tasks` arrays are always empty** in live data. GHL doesn't expose a public calls endpoint in the standard API; tasks require per-contact fetches. `lib/mock-data.ts` provides realistic stand-ins for UI development.

### Internal type system

`lib/types.ts` defines the canonical internal types (`Contact`, `Opportunity`, `Call`, `Task`, `Message`, `Pipeline`). The API route transforms raw GHL shapes into these before returning JSON. Always work against the internal types in components — never import from `lib/ghl-client.ts` on the client side.

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
- `components/dashboard/filter-bar.tsx` defines and exports the `Filters` interface used everywhere
- Charts use Recharts via the shadcn chart wrapper (`components/ui/chart.tsx`)
- `components.json` controls shadcn/ui config (alias `@/components/ui`, Tailwind CSS v3)
