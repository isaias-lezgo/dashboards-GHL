# Proyectos Lezgo — Dashboard

Internal sales and marketing dashboard for the real-estate projects the company
commercializes. One deployment serves every project: staff enter a shared team
password, pick a project from the home screen, and see that project's live CRM
data.

The client-facing product — where each client logs in with their own password and
sees only their own sub-account — is a **separate deployment** built from the same
codebase. Don't confuse the two.

![Dashboard Screenshot](sales-dashboard-dark.png)

---

## What it does

Pulls live data from a Lezgo Suite CRM sub-account and surfaces it in three tabs:

**Marketing** — Lead volume by source, campaign performance, pipeline stage
distribution, and paid-vs-organic breakdown. Answers where leads come from and
which campaigns convert.

**Ventas** — Manager-focused view of individual rep performance: KPI strip,
leads per rep by pipeline stage, win/loss ratio, won revenue per rep, open
pipeline value by stage, new opportunities over time, lost reasons by rep, and
the Lead→Apartado decision-cycle table.

**Asistente IA** — A chat assistant that answers questions about the loaded
dataset. It runs an agent loop in the browser with ~22 tools, most of which query
the data the page already holds; it can render charts, export CSVs, and generate
PDF reports. This tab always sees the full, unfiltered dataset.

Marketing and Ventas share one filter: a date range (Semana / Mes / 3 meses /
6 meses / Todo / Personalizado). Filtering is instant and client-side. Both tabs
can export a branded PDF report of their own charts.

---

## Access model

The password is **not** an identity here — it is a gate. Two signed cookies split
the two questions:

| Cookie | Answers | Verified by |
|---|---|---|
| `dash_access` | may this person enter at all? | `middleware.ts` (Edge) |
| `dash_project` | which project are they viewing? | `requireClient()` (`lib/session.ts`) |

Flow: `/login` (team password) → project picker → dashboard. "Cambiar proyecto"
in the header returns to the picker; "Cerrar sesión" on the picker clears both
cookies.

Every project transition is a **full page load**, never a soft navigation — a
cached React tree would otherwise show the previous project's data to the next
one.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.7 |
| Package manager | pnpm (see the warning below) |
| UI Components | shadcn/ui + Radix UI |
| Charts | Recharts 2.15 |
| Styling | Tailwind CSS v3 |
| Data fetching | Custom streaming fetcher over NDJSON — no SWR, no caching |
| PDF export | pdfmake, hand-drawn canvas charts |
| AI | Anthropic SDK (browser-side agent loop, server holds no session state) |
| CRM | GoHighLevel REST API v2021-07-28 / 2023-02-21 |

---

## Getting started

### Prerequisites

- Node.js 20+
- pnpm
- A GoHighLevel **Private Integration** token and location id per project

### 1. Clone and install

```bash
git clone <repo-url>
cd <repo-folder>
pnpm install
```

> **Use pnpm, never `npm install`.** The Vercel deploy runs
> `pnpm install --frozen-lockfile` against `pnpm-lock.yaml`. Running `npm install`
> writes `package-lock.json` and leaves the pnpm lockfile stale, which fails the
> build with `ERR_PNPM_OUTDATED_LOCKFILE`.

### 2. Configure environment

Create `.env.local` in the project root — see `.env.example` for the annotated
version.

```env
DASHBOARD_ACCESS_PASSWORD='your-team-password'
DASHBOARD_AUTH_SECRET=<openssl rand -hex 32>
DASHBOARD_CLIENTS=[{"id":"yconia","name":"Yconia","locationId":"...","ghlToken":"pit-..."}]
ANTHROPIC_API_KEY=sk-ant-...
```

Every value is read exclusively server-side and never reaches the browser. Use
`pnpm add-client` to extend the roster safely — it reuses the app's own validator,
so it can't emit a roster the app would reject at startup.

> If the access password contains `$`, single-quote it here so dotenv doesn't try
> to expand it. In the Vercel UI paste it **unquoted** — quotes there would become
> part of the password.

### 3. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How data flows

```
browser → middleware.ts (verifies dash_access)
        ↓
app/page.tsx  (server shell: dash_project → picker or dashboard)
        ↓
app/api/dashboard/route.ts
  • requireClient() resolves dash_project to a project's GHL credentials
  • withClient() establishes the per-request credential context
  • Fetches contacts, opportunities, pautas, appointments, tasks concurrently
  • Resolves IDs → human-readable names (stages, users, lost reasons)
  • Streams progress + final payload as NDJSON
        ↓
hooks/use-dashboard-data.ts  (streaming fetcher; refresh() re-runs the full sync)
        ↓
components/dashboard/dashboard-app.tsx  (tab state, date filter, orchestration)
        ↓
components/dashboard/{marketing,sales}-dashboard.tsx
```

**There is no mock-data fallback.** If the API errors, the UI renders against
empty arrays rather than inventing numbers.

---

## Project structure

```
app/
  page.tsx                       # Server shell: picker vs. dashboard
  login/page.tsx                 # Team-password gate
  api/dashboard/route.ts         # GHL fetch + transform + NDJSON stream
  api/project/{select,clear}/    # Which project the session is viewing
  api/{chat,analyze-report}/     # Anthropic — never touch GHL
components/
  dashboard/
    dashboard-app.tsx            # The client app: tabs, filters, orchestration
    project-picker.tsx           # Home screen
    marketing-dashboard.tsx      # Marketing tab charts
    sales-dashboard.tsx          # Ventas tab charts
    conversations-chat.tsx       # Asistente IA tab
    date-range-filter.tsx        # The only global filter UI
  ui/                            # shadcn/ui generated components
lib/
  clients.ts                     # Project roster (the env-var seam)
  auth.ts / session.ts           # Cookie signing + resolution
  ghl-client.ts                  # GHL API fetch helpers (server-only)
  ghl-limiter.ts                 # Rate limiting, keyed PER LOCATION
  pauta.ts                       # Single source of truth for "de pauta"
  ai-tools.ts / ai-context.ts    # Assistant tools + system prompt
  date-range.ts                  # Date filtering
  types.ts                       # Internal type system
  pdf/                           # Report rendering
hooks/
  use-dashboard-data.ts          # Main sync
  use-agent-loop.ts              # Browser-side AI agent loop
```

---

## Environment variables

| Variable | Description |
|---|---|
| `DASHBOARD_ACCESS_PASSWORD` | Shared team password gating the whole deployment |
| `DASHBOARD_CLIENTS` | JSON array of projects: `[{id, name, locationId, ghlToken}]` |
| `DASHBOARD_AUTH_SECRET` | Random string signing both cookies; rotating it ends every session |
| `ANTHROPIC_API_KEY` | Used by the assistant, PDF analyses, and contact analysis |
| `GHL_API_TOKEN` / `GHL_LOCATION_ID` | **Not read by the app.** Only for the dev GHL MCP server (`.mcp.json`) |

---

## Available commands

```bash
pnpm dev        # Start dev server at localhost:3000
pnpm build      # Production build (TypeScript errors are ignored — see next.config.mjs)
pnpm start      # Serve production build
pnpm add-client # Add a project to the roster (prompts, validates, prints the blob)

npx tsc --noEmit         # REQUIRED: next build ignores TS errors, so a green build proves nothing
pnpm verify:clients      # lib/clients.ts     — roster parsing
pnpm verify:auth         # lib/auth.ts        — cookie signing, incl. tamper rejection
pnpm verify:limiter      # lib/ghl-limiter.ts — per-location isolation
pnpm verify:attachments  # lib/attachments.ts — tabular parse/query/join
```

**There is no test framework, and one is not being adopted.** The four modules
where a silent bug would leak one project's data into another's view have
assertion scripts under `scripts/verify-*.ts` (plain `node:assert/strict` via
`tsx`). Run them after touching auth, the roster, or the limiter. Everything else
is verified by driving the real app.

---

## Notes

- **`calls` is always empty** in live data — GHL doesn't expose a public calls
  endpoint in the standard API. **`tasks` is populated** via the location-wide
  `/locations/:id/tasks/search` endpoint.
- **Date filtering is client-side.** The GHL opportunity and contact endpoints
  don't uniformly support date-range params, so data is filtered after fetching.
- **Lost reasons** resolve from the native `lostReasonId` against the location's
  catalog, falling back to a "Motivo/Razón de Perdido" custom field.
- **Drill-downs join against the unfiltered dataset.** An opportunity can be
  created outside the window that puts its contact on screen, so joining against
  the filtered slice would silently drop real rows.
- **Brand rule:** rendered output never says "GoHighLevel" or "GHL" — the platform
  is presented as **Lezgo Suite CRM**. `sanitizeBrand()` enforces this in PDFs and
  the AI prompts carry the same rule.
- The UI is in **Spanish** — designed for a Mexican real-estate team.

See `CLAUDE.md` for the architectural detail and the invariants that must not be
broken.
