# Panel de Proyectos Internos — Design

**Date:** 2026-07-23
**Status:** Approved (pending spec review)

## Goal

This deployment stops being client-facing and becomes **internal**. It serves the
projects the company commercializes on behalf of third parties, to an internal
audience. The product sold to external clients — where a client's password is
their identity — is a *separate* deployment and is unaffected by this design.

The login page therefore stops asking "who are you?" (nobody here is a tenant)
and the first screen becomes a **project picker**: large buttons, one per
project, that open that project's dashboard.

This supersedes the identity half of `2026-07-13-multi-client-dashboard-design.md`.
The credential-context machinery from that design (`withClient`, the per-location
limiter, `requireClient`) is **kept intact** — see "What does not change".

## Scope decisions

- **The password is no longer an identity.** One shared team password
  (`DASHBOARD_ACCESS_PASSWORD`) gates the deployment; past the gate, any internal
  user may open any project. Removing the gate entirely was considered and
  rejected: the deployment is public on Vercel, and an ungated URL would expose
  the contacts, opportunities and conversations of all six projects.
- **The selected project lives in a cookie, not in the URL.** A `/p/<id>` route
  would give shareable links, but every API route would then have to accept the
  project id as a request parameter — ten routes changed for a nice-to-have.
  Deliberately deferred; this design does not preclude it.
- **`client` stays as the internal vocabulary.** The UI says "proyecto"
  everywhere; `ClientConfig`, `getClientById`, `withClient` and
  `DASHBOARD_CLIENTS` keep their names. A rename would touch ~20 files without
  changing behavior. The ambiguity is documented in `CLAUDE.md` instead.
- **No per-project metrics on the picker buttons.** Rendering them would require
  syncing all six sub-accounts from GHL before the user has chosen one.
- **No user accounts, no roles, no audit log.** Everyone past the gate is
  equivalent.

## The two cookies

Today `dash_session` does two jobs at once: it proves the visitor is allowed in
*and* it names the tenant. Those two facts now have different lifetimes and
different trust requirements, so they split:

| Cookie | Payload | Verified by | Answers |
|---|---|---|---|
| `dash_access` | `ok.<expiryMs>.<hmac>` | `middleware.ts` | may this person enter at all? |
| `dash_project` | `<clientId>.<expiryMs>.<hmac>` | `requireClient()` (`lib/session.ts`) | which project are they viewing? |

Both are HMAC-signed with the existing `DASHBOARD_AUTH_SECRET` and both reuse
`signToken` / `verifyToken` from `lib/auth.ts` unchanged — the token format is
already `<payload>.<expiryMs>.<hmac>`, so `ok` is just another payload. No new
crypto code.

`dash_project` does not strictly *need* a signature, since an internal user is
allowed to view any project. It is signed anyway for two reasons: it keeps
`verifyToken` as the single parsing path for cookies (an unsigned cookie would
let arbitrary strings reach `getClientById`), and it preserves an existing
property — **removing a project from `DASHBOARD_CLIENTS` instantly invalidates
the live sessions viewing it**, because `requireClient()` returns null when the
id no longer resolves.

Both cookies keep the current attributes: `httpOnly`, `secure`, `sameSite: lax`,
`path: /`, and `SESSION_MAX_AGE_SECONDS` (7 days).

Middleware verifies **only** `dash_access`. It must not resolve the project —
that would drag the roster into the Edge bundle, which is exactly why the current
design keeps `lib/session.ts` separate from `lib/auth.ts`.

## Routes

```
GET  /login                  clave de acceso (one field)
POST /api/auth/login         verifies DASHBOARD_ACCESS_PASSWORD → sets dash_access
POST /api/auth/logout        clears BOTH cookies
GET  /                       no dash_project  → project picker
GET  /                       has dash_project → that project's dashboard
POST /api/project/select     { id } validated against the roster → sets dash_project
POST /api/project/clear      clears dash_project → back to the picker
```

`/api/project/*` sit behind the middleware matcher (they require `dash_access`);
`/login` and `/api/auth/*` stay excluded from it, as today.

### `app/page.tsx` split

`app/page.tsx` is currently a large client component. It becomes a thin **server**
component that reads `dash_project` and renders one of two children:

- `components/dashboard/project-picker.tsx` — new.
- `components/dashboard/dashboard-app.tsx` — today's `app/page.tsx` client
  component, moved verbatim. Its tab state, date-filter state and data hooks are
  unchanged.

The move is mechanical: no logic edits, only the `"use client"` boundary shifting
down one level.

### Header

The header button that today POSTs to `/api/auth/logout` (`app/page.tsx:222`)
becomes **"Cambiar proyecto"** → `POST /api/project/clear` → `router.refresh()`.
"Cerrar sesión" moves to the picker screen, where it clears both cookies and
redirects to `/login` — leaving the dashboard header with exactly one session
control instead of two.

## Login

`app/login/page.tsx` keeps its shape — one field, one button. Copy changes from
"Dashboard protegido / Ingresa la contraseña" to the team framing, and the field
label becomes "Clave de acceso".

`app/api/auth/login/route.ts` replaces `findClientByPassword(submitted)` with a
`safeEqual(submitted, process.env.DASHBOARD_ACCESS_PASSWORD)` check, then signs
`dash_access`. Constant-time comparison still matters — the value is now a real
secret rather than a public location id.

**The per-IP rate limiter is kept** (5 attempts / 15 min, in-memory). With a
single shared password guarding six sub-accounts it matters more than it did
under per-client passwords, not less. Its known limitation is unchanged: on
Vercel the state is per-instance and resets on cold starts, so it is a soft
mitigation against scripted guessing, not a distributed limiter.

## The picker

A centered, full-height screen: the title **"Proyectos Lezgo"**, and a responsive
grid of large buttons — one per entry in `DASHBOARD_CLIENTS`, in roster order,
showing only `name`. Clicking POSTs to `/api/project/select` and refreshes.

The list is rendered from the roster on the server, so adding a project to
`DASHBOARD_CLIENTS` adds a button with no code change.

## Roster cleanup

The password model in `lib/clients.ts` becomes dead code and is removed rather
than left to rot:

- `ClientConfig.password` — deleted.
- `effectivePassword()` — deleted.
- `findClientByPassword()` — deleted.
- The duplicate-effective-password validation in `parseClients()` — deleted.

`parseClients()` keeps everything else: required-field checks, the `ID_RE` format
check (ids still may not contain dots, since they ride inside a dot-delimited
token), and the duplicate-id check.

Downstream:

- `scripts/add-client.ts` — drops the `--password` flag and its interactive
  prompt, and stops printing "logs in with: …".
- `scripts/verify-clients.ts` — drops the password assertions, keeps roster
  parsing, id validation and `getClientById`.
- `scripts/verify-auth.ts` — keeps its cookie-tamper rejection test, now
  exercised against both the `ok` payload and a `clientId` payload.

## What does not change

Two mechanisms from the multi-client design stay, because they are correctness
concerns rather than tenant-isolation concerns:

- **`withClient` / `AsyncLocalStorage`** (`lib/ghl-context.ts`). One serverless
  instance serves overlapping requests. A module-level "current client" variable
  would serve project A's dashboard using project B's token — still true when the
  users are internal.
- **`lib/ghl-limiter.ts` keyed by location id.** GHL's rate budget is per
  sub-account. Sharing one bucket would let a 429 on Balvanera freeze the sync
  for Yconia.

Also unchanged: all ten API routes (`requireClient()` keeps its signature and
return type, only the cookie name it reads changes), `lib/ghl-client.ts`, both
dashboards, the AI assistant, and the PDF export.

## Environment

```
DASHBOARD_ACCESS_PASSWORD   new — the shared team password
DASHBOARD_AUTH_SECRET       ROTATED (openssl rand -hex 32) — signs both cookies
DASHBOARD_CLIENTS           six projects, no `password` fields
ANTHROPIC_API_KEY           unchanged
```

`DASHBOARD_AUTH_SECRET` is rotated as part of this change, not carried over.

To be precise about what does the work: the cookie **rename** is what actually
ends the old sessions — middleware now looks for `dash_access`, and no browser
holds one, so every pre-migration visitor lands on `/login` regardless of the
secret. Rotating the secret is defense in depth: it retires a key that signed
tokens minted under the password-is-identity model, so a captured old cookie
cannot be replayed if a `dash_session`-reading path is ever reintroduced by
mistake. Rotate it in Vercel **at the same time** as the deploy.

The six projects: Lezgo Suite, Condesa Cimatario, Plaza Bosques / Meseta,
Grand Center, Balvanera, Yconia.

`.env.example` is updated to describe the new variable and to drop the
`password` field from its `DASHBOARD_CLIENTS` example. Real values go only in
`.env.local` (gitignored) and Vercel's environment settings.

**Token hygiene:** the GHL private-integration tokens for the six projects were
pasted into a chat transcript while specifying this work. They should be rotated
in GHL if that transcript is shared or retained.

## Verification

No test framework in this repo (and none being adopted). Verification is:

```bash
pnpm verify:clients   # roster parsing after the password removal
pnpm verify:auth      # both cookie payloads, incl. tamper rejection
pnpm verify:limiter   # unchanged — proves per-location isolation survived
npx tsc --noEmit      # REQUIRED: next build ignores TS errors
```

Plus driving the real app: wrong password rejected → correct password reaches the
picker → each of the six buttons opens the right sub-account (confirm via the
location name in the loading screen) → "Cambiar proyecto" returns to the picker →
"Cerrar sesión" returns to `/login` → a hand-edited cookie is rejected.

## Risks

- **One password for six sub-accounts.** If it leaks, everything leaks at once.
  Mitigated by: it is a real rotatable secret (unlike the location ids it
  replaces), it lives only in Vercel's env, and rotating it is a one-line change
  that invalidates nothing else. The 7-day cookie means a rotation takes up to
  seven days to lock out an existing session; forcing an immediate lockout means
  also rotating `DASHBOARD_AUTH_SECRET`.
- **`app/page.tsx` is large and moving it risks a silent regression.** Mitigated
  by making the move verbatim in its own step, with no logic edits, verified by
  `tsc --noEmit` and by loading a project before any other change is layered on.
