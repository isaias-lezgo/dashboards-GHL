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
pnpm verify:ads          # lib/ads.ts — metric coercion, ratio recomputation, window clipping
pnpm verify:pipelines    # lib/pipeline-filter.ts — the derived contact set, orphan handling
pnpm check:ads [clientId] # read-only probe: which clients have Meta linked, and what the API returns
pnpm verify:attachments  # lib/attachments.ts + lib/attachment-tools.ts — tabular parse/query/join
pnpm verify:pagination   # lib/ghl-client.ts — offset→cursor handoff (hits live GHL, read-only)
pnpm verify:sync-store   # lib/sync-store.ts — freshness window, gzip round-trip, lock
                         #   (DB assertions run only when DATABASE_URL is set)
pnpm verify:oauth        # lib/ghl-oauth.ts — token sealing + single-winner refresh lock
pnpm verify:sso          # lib/ghl-sso.ts — CryptoJS-format decryption + tenant decision
pnpm check:oauth-sync <clientId> # read-only: full sync over PIT vs OAuth, diffs every count
pnpm verify:installations # lib/installations.ts + lib/ghl-webhook.ts — ids, Ed25519, uninstall cleanup
pnpm db:migrate          # creates project_sync + the OAuth token tables (idempotent)
npx tsc --noEmit         # REQUIRED: next build ignores TS errors, so a green build proves nothing
```

**No test framework, and not adopting one.** Instead, the pure modules where a silent
bug would be a *cross-tenant data leak* (roster, auth, limiter) or a silently wrong
number (ads, pipeline filter, attachments, sync store) have assertion scripts under
`scripts/verify-*.ts` (plain `node:assert/strict`, run via `tsx`). "Running a single
test" means running the one script for the module you touched. Everything else is
verified by driving the real app.

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
  defaults to that client's `locationId`. Use `pnpm add-client` to extend it safely.
- `DASHBOARD_AUTH_SECRET` — random string used to HMAC-sign the session cookie (`openssl rand -hex 32`)
- `ANTHROPIC_API_KEY` — used by `app/api/chat` (assistant), `analyze-report` (PDF analyses)
  and `analyze-contact`
- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` — Neon, injected by the Vercel Marketplace
  integration. **Optional**: without them the app simply syncs live from GHL on every
  load, which is exactly how it behaved before the cache existed.
- `GHL_APP_CLIENT_ID` / `GHL_APP_CLIENT_SECRET` / `GHL_APP_SSO_KEY` — the GHL
  Marketplace app (OAuth, **agency-only** distribution). `GHL_TOKEN_ENC_KEY` (64 hex,
  `openssl rand -hex 32`) seals the stored tokens; **changing it orphans them** and the
  agency must reinstall. See `lib/ghl-oauth.ts`. Not yet wired into `ghlFetch` — the
  roster's PITs still serve every client.
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
| `ads-campaigns` | on-demand per-campaign Meta spend breakdown (see "Meta ad spend") |
| `attachments/process` | parses assistant uploads (PDF via `unpdf`, CSV/Excel via `xlsx`) — **no GHL** |
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

Verification scripts: `pnpm verify:clients`, `verify:auth`, `verify:limiter`.

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
- `lib/ai-tools.ts` — the ~25 `TOOL_DEFINITIONS` and their executor. Most tools
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

### Meta ad spend (`/ad-publishing` reporting)

The CRM half of the dashboard knows how many leads arrived; this is the only part
that knows what they cost. Without it there is no CPL, no cost per cita, no ROAS.

| File | Responsibility |
|---|---|
| `lib/ghl-client.ts` (reporting section) | `getFacebookAdReporting` / `getFacebookReportingList` — the two GET endpoints. The rest of the `/ad-publishing` surface (integration, pages, campaigns, audiences) was already there and is still unused by the app. |
| `lib/ads.ts` | **Pure, client-safe.** Coercion, ratio recomputation, window clipping. Imported by both the server and the browser, so it must never import `lib/ghl-client`. |
| `lib/ads-sync.ts` | Server-side: fetch, classify, normalize. Never throws into `syncProject`. |
| `app/api/ads-campaigns/route.ts` | On-demand per-campaign breakdown for an explicit window. |
| `components/dashboard/ads-section.tsx` | The UI: notice banner, stat tiles, two charts, campaign table. |

Verify with `pnpm verify:ads` (pure module, `scripts/verify-ads.ts`).

**Scope: `adPublishing.readonly`.** Verified present on an existing client token
(kapitaliza) — the roster's PITs were created with it, so no token work was
needed. A token that lacks it 401s on every call, which `classifyError` maps to
the `unauthorized` status; the fix is to tick the scope in GHL → Settings →
Private Integrations.

**NEVER gate on `/ad-publishing/facebook/integration`.** That endpoint describes
GHL's Ad Manager *publishing* setup — connected pages, the default page, whether
campaigns can be created from inside GHL. **Reporting is independent of it.**
`fetchAdsReport` proved this the hard way: it checked the integration first and
refused to continue without it, which hid three clients with live spend behind a
"no conectado" banner. sahai 404s on that endpoint (`Integrations for location …
does not exist`) while its reporting returns MXN 21,755.49 for the same window
GHL's own Meta Ads report shows. The reporting call itself is the gate; the ad
account id is read off the reporting rows (`accountId`). The integration is
optional context only — `scripts/check-ads.ts` prints it labelled "informativa".

**`type=INTEGRATION`, not `AD_MANAGER`.** `AD_MANAGER` means campaigns built
inside GHL's Ad Manager; our clients run ads in Meta themselves and merely link
the ad account, which is `INTEGRATION`. Asking for the wrong one returns nothing,
not an error.

Everything below was verified against a live connected sub-account, and none of
it is in the public docs:

- **`grouped` is hard-capped at 25 rows and truncates SILENTLY.** A 365-day
  `groupBy=day` request returns the first 25 days; a 365-day `groupBy=week`
  request returns 25 weeks ending in March. Nothing in the response says it is
  short. `lib/ads-sync.ts` therefore splits the window into 25-day chunks and
  reassembles. Never widen a single request past `MAX_GROUPED_ROWS`.
- **`totals` sums ratio metrics instead of weighting them**, so its `cpc`/`cpm`/
  `ctr` are meaningless — a real response came back `ctr: "21.94"`,
  `cpm: "505.42"`. `totals` is also capped to the same 25 rows. We never read it:
  `sumAdDays()` recomputes every ratio from the summed components.
- **Every metric is a string** (`"spend": "13971.29"`), including ones the docs
  type as numbers, and `conversions` is a number at account level but a string at
  campaign level. Coerce with `num()`, which returns 0 rather than NaN — one NaN
  would poison every downstream sum.
- **`listType=campaigns` carries NO metrics under `INTEGRATION`** — just name,
  status and id. Only the `AD_MANAGER` branch fills in the campaign fields. The
  `ads` rows do carry spend, so per-campaign spend means listing campaigns then
  walking their ads. That N+1 is why the breakdown is an on-demand route and not
  part of the sync.
- **GHL's CDP attribution (`revenue`/`sales`/`leads` on those rows) is empty.**
  0 on every campaign of every account checked — and GHL's own Meta Ads report
  shows the same zeros, so it is an unpopulated GHL feature, not a bug either
  side. We ignore it and join ourselves; the fields were removed from
  `AdCampaignStat` so nobody renders a column of zeros again.
- **`/reporting/campaign/:id` takes GHL's Mongo `_id`, not the Meta campaign id**
  (`422 campaignId must be a mongodb id`), so it only works for campaigns created
  inside Ad Manager. Unused here.
- **Amounts are in the ad account's own currency**, read once from
  `getFacebookAdAccount`. An account in MXN rendered as USD is off ~18x; when the
  lookup fails the UI prints bare numbers rather than guessing a symbol.

Design invariants:

- **"Not connected" is a state, not an error.** Many sub-accounts have no Meta ad
  account linked, so `AdsReport.status` is a first-class field and the section
  renders an amber notice saying who fixes it. Never red, never a thrown error,
  and never allowed to blank the other twenty charts — `fetchAdsReport` returns a
  status for every failure path.
- **A MISSING `ads` is not a disconnected `ads`.** The cache is disposable and
  unversioned, so a row written before this feature shipped has no `ads` field at
  all. That is "we have not looked yet", and the section says exactly that
  (`AdsPendingNotice`) rather than reusing the disconnected notice — which would
  assert a fact we do not have, and the wrong one for any client who IS
  connected. This bit once, on stanza-residencial. Keep the two states distinct.
- **The window is CLIPPED to the days we hold, and the lead count is clipped with
  it.** Spend reaches back `ADS_WINDOW_DAYS` (365) while the CRM goes back to the
  account's first day. On "Todo el historial" an unclipped CPL would divide one
  year of spend by five years of leads and report a third of the real cost.
  `adsWindow()` intersects the two and the UI says so whenever it bites.
- **It clips in BOTH directions, and the reverse case is the one that bit.** A
  sub-account is routinely opened *after* its ad account was already spending.
  stanza-residencial holds spend from 2026-03-02 and its first contact is
  2026-07-15 — five months of spend over two months of leads, a CPL of **214.96
  against a true 50.98**. amir-cherit has the same shape, milder (228.65 →
  218.02). `adsWindow()` therefore takes a third bound, `crmFrom`, from
  `firstRecordedDay()` over the **unfiltered** contacts and opportunities.
  Derive it from a filtered slice and the clip chases its own tail as the date
  picker moves. Only days when no record could exist are removed: a zero after
  the CRM was already recording is a real zero, the same way an unlinked pauta
  is never priced at zero.
- **A `0` in the campaign table's leads column means three different things.**
  The campaign produced nothing; no Pauta record could be written yet; or it is
  a traffic-objective campaign that never produces a form. Only the first
  accuses the campaign. On amir-cherit **85 of 188 campaigns** sit at zero — 34%
  of all clicks — and nearly all of them ran before its Pauta object's first
  record (2026-03-01); "Casa Tabachines" shows 3 099 clicks whose single ad id
  appears in none of its 3 764 pautas, of any date. Ad rows come back aggregated
  for the window with no dates, so per-campaign precision does not exist:
  `hasUnobservableLeadDays()` is an account-level fact and the zero rows render
  "sin registro". Pick a window inside the pauta era and a zero means zero again.
- **The join footer must not speak while the ad rows are loading.** With an empty
  ad-id set `joinPautasToAds` classifies every pauta as belonging to an unlinked
  account, so amir-cherit read "3 764 de 3 764 pautas no aparecen aquí" for the
  20–40s its fan-out takes — an absence of data stated as a fact. Same mistake
  `AdsPendingNotice` exists to prevent, one level down.
- **Campaigns with no delivery in the window are dropped from the table.** GHL
  returns the account's whole campaign list whatever the window is — amir-cherit
  answers with the same 194 ads for 30 days as for 365, only the metrics move —
  so listing them fills the table with absences that read as failures.
- **CPL uses the CRM's lead count, not Meta's.** Meta's action types overlap
  (`lead`, `onsiteConversion.lead`, `onsiteConversion.leadGrouped` all fire for
  one lead) and which one means "lead" depends on the objective — a WhatsApp
  campaign's real lead is a conversation started. `metaLeadsFrom()` picks one,
  never sums, and is kept only as a cross-check.
- **Two charts, never a dual axis.** Spend and cost-per-lead are different scales;
  sharing a y-axis would flatten one to zero.
- **Daily rows, not a pre-aggregated total.** The dashboard filters client-side by
  date, so spend has to be re-summable over whatever window the user picks.

**The Meta↔CRM join is by AD ID, never by name.** The Pauta custom object stores
the Meta ad id in `id_de_pauta`, and an opportunity carries the same value in
`adId` (from `utmAdId`). `pautaAdId()` reads it; `joinPautasToAds()` counts
pautas per ad; `campaignsFromAds()` rolls that up. The names are NOT comparable —
one live ad is "Mazatlán si puede ser tuyo_imagen" in Meta and "Casas en Mazatlán
desde $1.29 MDP" in the Pauta record. A name join would look like it worked.

- **GHL links ONE Meta ad account per sub-account, and clients run several.**
  stanza-residencial has 14 ad accounts; only *Stanza Magnolia* is linked, and
  201 of its 326 pautas came from ads in the other 13. Their spend is not
  missing data, it is **unreachable** data — the endpoint will never return it.
  `AdJoin` therefore separates `unlinkedAccount` from `noAdId`, and both the
  campaign table and the pauta chart say so out loud. Never price those pautas
  at zero.
- **Cost divides by what the spend actually covers.** A pauta group's cost is
  `spend ÷ priced`, where `priced` counts only the pautas whose ad is in the
  linked account — never the group's full pauta count. Mixing a partial
  numerator with a complete denominator once shipped a $10.75 cost per pauta
  against a true $29.92. The chart tints such rows amber and names the coverage
  in a title.
- **Spend per group dedupes ad ids** (`spendForAdIds`). A group holds many pautas
  per ad, so summing per pauta multiplies each ad's cost by its own lead count —
  inflating precisely the number read as cost per lead.

**Who actually has Meta spend** (`pnpm check:ads`, 2026-09-01; amir-cherit
2026-09-07). Five of the eight external clients, not one — the number the
integration gate was hiding:

| Cliente | Reporting | Cuenta | Campañas |
|---|---|---|---|
| hausmen | ✅ | Hausmen (MXN) | 167 |
| amir-cherit | ✅ | Amir Cherit (MXN) | 189 |
| sahai | ✅ | HAI (MXN) | 91 |
| el-fundador-saki | ✅ | El Fundador (MXN) | 20 |
| stanza-residencial | ✅ | Stanza Magnolia (MXN) | 9 |
| kapitaliza | ❌ `disconnected`, sin ad account | — | — |
| rise-29 | ❌ `Ad Account not found` | — | — |
| terrenos-en-venta-jerry-medina | ❌ `Access Token not found` (caducado) | — | — |

The per-campaign fan-out is one request each and measured **19.9s for sahai's 91
campaigns** (332 ads) and **23.3s for amir-cherit's 189** (194 ads), so
`maxDuration = 300` on the route is comfortable. There is no one-shot shortcut:
`listType=ads` and `listType=adsets` without a `campaignId` both 422 with
`campaignId must be a string`. The window cannot be cached and re-sliced in the
browser either — the ad rows are the same set for any window but their metrics
are aggregated per request;
`MAX_CAMPAIGNS_FANNED_OUT` (200) is a guard that does not bite today — though
amir-cherit's 189 campaigns are the closest anyone has come to it.

Cross-checked against GHL's own "Meta Ads report" for stanza-residencial over
Aug 17 – Sep 1 2026: spend 4748.86, clicks 4049, impressions 110838, CPC 1.17 —
identical on all four. The ad-id join then produced 110 leads at $30.01 for
"SM | AG26 | Interacción" and 15 at $728.63 for "SM | JL26 | INT | Brianza",
matching the pauta chart's own rows for the same ads.

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
  2026-09-07: `hausmen`, `kapitaliza`, `rise-29`, `stanza-residencial`,
  `el-fundador-saki`, `sahai`, `terrenos-en-venta-jerry-medina`, `amir-cherit`.
  Condesa, Lezgo Suite, Plaza Bosques and Grand Center were moved to the internal
  panel and **deliberately removed** from the env roster. Since the Marketplace
  app, any sub-account with the app installed has a dashboard here too — Lezgo
  Suite does again, through its install (2026-10-28).
- **`claimSync` decides inside the `WHERE` of the UPDATE**, never read-then-write in
  TypeScript: that would leave a window where two requests both see the lock free.
  The lock self-heals after 10 minutes so a function dying mid-sync cannot freeze a
  client forever.
- **Stale-while-revalidate has a ceiling: `MAX_SERVE_AGE_MS` (6 h).** The
  background refresh updates the ROW, never the browser that triggered it, so a
  client nobody opened in weeks used to be shown weeks-old data on its first
  visit. rise-29 on 2026-09-21 got its 2026-08-31 snapshot, and the assistant,
  reading that browser copy, told the user September had zero leads (it had
  109). Past the ceiling the row is a miss: live sync with the loading screen.
  If that live sync fails, the old row is served as a fallback — old data still
  beats an error screen.
- **The assistant knows where its copy ends.** `syncedAt` goes into
  `buildDatasetSummary`, and rule 9 of the system prompt says to cite that date
  and point at "Actualizar" instead of concluding "there were no records".
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

### GHL Marketplace app (OAuth + SSO + installs)

A private Marketplace app replaces the per-client PITs and the password login.
Distribution **Sub-account**, "who can install" **agency only**; agency
`LkhcnqrWIwMDHdc6oN5F` (`AGENCY_COMPANY_ID` in `lib/ghl-sso.ts`).

| Piece | File |
|---|---|
| Install callback → Company token, sealed in Neon | `app/api/oauth/callback`, `lib/ghl-oauth.ts` |
| Custom Page (sub-account left menu) → SSO | `app/embed/page.tsx`, `app/api/auth/sso`, `lib/ghl-sso.ts` |

- **An agency install yields ONE Company token**; location tokens are minted from
  it (`/oauth/locationToken`) and cached in `ghl_location_token`. The Company
  refresh token is single-use — `claimRefresh` serializes it in the UPDATE's WHERE.
  `ghl_oauth_token` is NOT disposable like `project_sync`: drop it and the agency
  must reinstall.
- **No "ghl"/"highlevel" in any URL registered with the app** — GHL rejects them
  for white-label apps. That is why the Custom Page is `/embed`, not `/ghl`.
- **SSO decides the tenant by `activeLocation` only, never by `type`.** `type`
  describes the user: an agency admin inside a sub-account arrives as
  `type: "agency"` with `activeLocation` set (verified 2026-10-28). Never take the
  tenant from URL variables like `{{location.id}}` — they are user-editable.
- The SSO cookie is `SameSite=None; Partitioned`: inside GHL's iframe it is a
  third-party cookie. The password login keeps `Lax`.
- **`ghlFetch` prefers OAuth, falls back to the PIT** (`lib/ghl-token.ts`): the
  location token when the app is installed on that sub-account, the roster PIT
  otherwise. In-memory cache + in-flight dedupe + a 5-min negative cache, because
  ghlFetch runs hundreds of times per sync. A 401 on an OAuth token re-mints once.
  `GHL_OAUTH_DISABLED=1` is the kill switch. Before trusting OAuth for a client,
  run `pnpm check:oauth-sync <id>`: a missing scope does not fail the sync, it
  empties one dataset (sahai, 2026-10-28: identical on every count).
- **Installing the app IS turning the dashboard on** (owner's call, 2026-10-28).
  The roster is the env `DASHBOARD_CLIENTS` ∪ `dashboard_installation` (Neon),
  merged only in `lib/clients.ts` (`getRoster`); the env wins on a shared
  location. Install-only clients have no PIT and no password: they enter through
  GHL SSO only. The DB stays optional for env clients — if Neon fails, the roster
  is the env alone.
- **GHL's installed-locations list is the authority, not the webhook.** The
  INSTALL webhook (`app/api/oauth/webhook`) only triggers
  `reconcileInstallations()`; SSO from an unknown sub-account triggers it too,
  because GHL may not fire INSTALL for "future locations" installs. UNINSTALL acts
  on the signed payload: stamps `uninstalled_at` (rows are never deleted, so a
  reinstall gets its id back) and drops the location token and `project_sync` row.
  Live sessions die within `INSTALLS_CACHE_MS` (60 s).
- Webhooks are verified with GHL's **Ed25519** key (`X-GHL-Signature`); the RSA
  `X-WH-Signature` was retired 2026-09-01 and is not accepted. Verified against
  real GHL deliveries 2026-10-28.
- INSTALL/UNINSTALL are **not** in the portal's event list: GHL sends them to the
  Default webhook URL automatically. Do not tick other events — every contact
  change in every sub-account would hit the route. The portal probes the URL
  unsigned before saving and refuses anything but 2xx, hence the 200 on
  GET/HEAD/unsigned POST (which act on nothing).
- **A reinstall arrives as UNINSTALL then INSTALL**, and INSTALL comes in bursts
  (four in one second). The UNINSTALL drops that client's `project_sync` row, so
  the first load after a reinstall is a live sync — expected, not a regression.
- **OAuth is not slower than a PIT.** Same GHL limits (100 req/10 s, 200k/day per
  location), each token with its OWN counter, same per-request latency. hausmen
  alternating PIT/OAuth/OAuth/PIT: 30.6 / 31.2 / 41.2 / 31.0 s, zero 429s; the
  outlier was GHL variance in one phase. Single back-to-back runs are noise —
  compare alternating runs before concluding anything about speed.
- Verified over OAuth only (no PIT), 2026-10-28: Lezgo Suite synced in full —
  7 288 contacts, Meta `connected` — so `adPublishing.readonly` works via OAuth.

### Other docs in the repo

- `README.md` is **stale** (says Next 15, SWR, a "Conversaciones" tab). Trust this file
  and the code over it.
- `DESIGN.md` (palette, typography tokens) and `PRODUCT.md` (users, purpose, brand
  personality) are the design context — read them before UI/visual work.

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
- **Filtering is entirely client-side, along two dimensions**: date
  (`lib/date-range.ts` — `DateFilter`, `resolveDateRange`, `filterByDateRange`)
  and pipeline (`lib/pipeline-filter.ts`, below). Both filter the already-fetched
  dataset; `components/dashboard/filter-bar.tsx` is the sticky bar that holds
  their two controls. The filtered slices are computed in `app/page.tsx` and
  passed to each dashboard as props. The filter bar is hidden on the AI assistant
  tab, which always sees the full dataset.
- **`calls` is always empty** in live data — GHL doesn't expose a public calls endpoint in the standard API. **`tasks` is populated** via the location-wide `/locations/:id/tasks/search` endpoint (`searchLocationTasks`), fetched concurrently with the other datasets.
### Pipeline filter

`lib/pipeline-filter.ts` is the global pipeline filter — pure, UI-free, verified
by `pnpm verify:pipelines`. Multi-select; **an empty selection means "todos"**
and must stay a strict passthrough, since it is the panel's default state.

**The pipeline exists only on the opportunity**, and never will exist anywhere
else — GHL has no such concept outside one. Everything else in the payload is
therefore filtered by a set of contact ids DERIVED from the selected pipelines'
opportunities (`contactIdsInPipelines`). Every rule below follows from that.

- **Derive the contact set from the FULL opportunity list, never the
  date-filtered slice.** Pipeline membership is a fact about a contact, not about
  the active window: a contact whose only opportunity here was created two years
  ago still belongs. Deriving it from the filtered slice drops them plus their
  pautas, citas and mensajes, and understates exactly the accounts with the
  longest history. Same invariant the drill-down joins already carry.
- **Rows with no contact id are dropped while the filter is active**, unlike the
  date filter's undated rows, which are kept. An undated row is still one of
  *these* leads; an unattributable one belongs to no pipeline at all. Keeping the
  orphans was considered and rejected — it puts pautas on screen that the
  selected pipeline does not explain.
- **Only the selected pipelines reach the dashboards** (`selectedPipelines`, via
  the `pipelines` prop). This is what fixes the stage axis: both dashboards derive
  their stage order by walking that prop, so one pipeline selected turns an axis
  that merged every stage name in the account (17 distinct on amir-cherit's 23
  pipelines, 31 on hausmen's 6) into that pipeline's real stages in GHL's order.
  Ordered by the account's pipeline order, not click order, so the axis does not
  reshuffle as boxes are ticked.
- **Meta spend has NO pipeline dimension, so the Meta blocks ignore the filter
  and say so.** Meta reports per ad account. Narrowing the lead count while the
  spend stays account-wide multiplies the cost per lead by however small the
  chosen pipeline is — the same partial/complete mismatch as the `priced` rule
  above, inverted. `MarketingDashboard` therefore takes an `unscopedByPipeline`
  bundle (opportunities, pautas, and the full pauta history) which `AdsSection`
  and `CampaignActivityChart` use, and both render `PipelineScopeNotice`.
- **`isDePauta` must be rebuilt from the UNFILTERED pauta history for those
  blocks.** The predicate is a union that counts an opportunity as paid when its
  *contact* has a Pauta record, so a pipeline-filtered history silently makes it
  stricter and shrinks the lead count even though the opportunity list was never
  filtered. That is the third field of `unscopedByPipeline`, and it is the one
  that is easy to miss: leaving it out moved stanza-residencial's live CPL from
  $218.03 to $253.13 while every other number looked right.
- The AI assistant is deliberately **unaffected** — it always sees the whole
  dataset, and can filter by pipeline itself when asked.

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
- Global filters: `filter-bar.tsx` hosts `date-range-filter.tsx` (`DateFilter` type in `lib/date-range.ts`) and `pipeline-filter.tsx` (logic in `lib/pipeline-filter.ts`)
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
