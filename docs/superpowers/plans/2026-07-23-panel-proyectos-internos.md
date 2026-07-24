# Panel de Proyectos Internos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the password-is-identity login with a shared team password plus a project-picker home screen, so internal staff can open any of the six commercialized projects.

**Architecture:** The single `dash_session` cookie splits into two signed cookies: `dash_access` (may this person enter — verified by Edge middleware) and `dash_project` (which project — verified by `requireClient()`). Both reuse the existing `signToken`/`verifyToken` helpers unchanged. `app/page.tsx` becomes a thin server component that renders either the picker or today's dashboard. None of the ten API routes change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Tailwind v3 + shadcn/ui, pnpm. Verification via `scripts/verify-*.ts` (`node:assert/strict` under `tsx`) — there is no test framework and none is being adopted.

**Spec:** `docs/superpowers/specs/2026-07-23-panel-proyectos-internos-design.md`

## Global Constraints

- **Package manager is pnpm.** Never run `npm install` — it writes `package-lock.json` and leaves `pnpm-lock.yaml` stale, which fails the Vercel build with `ERR_PNPM_OUTDATED_LOCKFILE`.
- **`npx tsc --noEmit` must pass before every commit.** `next build` ignores TypeScript errors (see `next.config.mjs`), so a green build proves nothing.
- **Verify scripts are CJS.** This package has no `"type": "module"`, so `tsx` compiles to CommonJS where top-level `await` fails. Any async work goes in a `main()` with `main().catch(...)`.
- **Every project transition is a full page load** — `window.location.href = "..."`, never `router.push` / `router.refresh`. A soft navigation leaves the previous project's data mounted in the cached React tree.
- **Never pass `ghlToken` or `locationId` to a client component.** The picker receives only `{ id, name }` per project.
- **UI copy is Spanish; internal code vocabulary stays `client`.** The UI says "proyecto"; `ClientConfig`, `getClientById`, `withClient`, `DASHBOARD_CLIENTS` keep their names.
- **Brand rule:** rendered text never says "GoHighLevel" or "GHL" — the platform is "Lezgo Suite CRM".
- Team password value: `ProyectosLezgo1.$` — goes only in `.env.local` and Vercel, never in a committed file.
- App title on the picker: **"Proyectos Lezgo"**.

---

### Task 1: Local environment + roster cleanup

Removes the password model from `lib/clients.ts`. This is where the dead code from the old tenancy model goes away, and it is independently verifiable via `pnpm verify:clients`.

**Files:**
- Modify: `.env.local` (gitignored — not committed)
- Modify: `lib/clients.ts:7-20` (interface + `effectivePassword`), `:83-89` (password-collision check), `:113-122` (`findClientByPassword`)
- Modify: `scripts/verify-clients.ts`
- Modify: `scripts/add-client.ts:5`, `:41-48`, `:65-66`, `:98-99`, `:108-111`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ClientConfig` narrowed to `{ id: string; name: string; locationId: string; ghlToken: string }`. `effectivePassword` and `findClientByPassword` no longer exist — Task 2 must not import them.

- [ ] **Step 1: Write `.env.local` with the six projects**

Read the current `.env.local` first to preserve `ANTHROPIC_API_KEY` and the two `GHL_*` MCP vars. Then set these three lines (generate a fresh secret — do not reuse the existing one):

```bash
openssl rand -hex 32
```

```
DASHBOARD_ACCESS_PASSWORD=ProyectosLezgo1.$
DASHBOARD_AUTH_SECRET=<paste the openssl output>
DASHBOARD_CLIENTS=[{"id":"lezgo-suite","name":"Lezgo Suite","locationId":"uRFrk77agXq9is0a0gkp","ghlToken":"pit-e53c3b5f-40cf-4e90-ac01-52130a448923"},{"id":"condesa","name":"Condesa Cimatario","locationId":"6oEcFFkODK86TAc6Ir47","ghlToken":"pit-036425fa-7ee5-43fb-af8f-975f79cf0607"},{"id":"plaza-bosques","name":"Plaza Bosques / Meseta","locationId":"A6w7R97qPAwr5R8mCSWe","ghlToken":"pit-5cfc6723-9f72-4f77-a6c9-39db3389875b"},{"id":"grand-center","name":"Grand Center","locationId":"10ogCVn86kNZGNoCFPZd","ghlToken":"pit-9c58690c-f0c6-491b-91fb-10ad2ad91875"},{"id":"balvanera","name":"Balvanera","locationId":"qv9OO8ADTaoZfi8mbLLO","ghlToken":"pit-f28a82cc-0a56-4580-9847-4db365cd96d4"},{"id":"yconia","name":"Yconia","locationId":"eTkkNMO4zG5Fs5PxT3x0","ghlToken":"pit-bf38523e-c83d-4393-91ff-3a45ceb020a8"}]
```

Note `DASHBOARD_ACCESS_PASSWORD` contains `$`. In a `.env` file Next.js does not perform shell expansion, so no escaping is needed — but do not `export` this line from a shell script, where `$` would expand.

- [ ] **Step 2: Update `scripts/verify-clients.ts` to assert the new shape (test first)**

Replace the whole file:

```typescript
// Verification for lib/clients.ts. Run: pnpm verify:clients
import assert from "node:assert/strict";
import { parseClients, getClientById } from "../lib/clients";

const VALID = JSON.stringify([
  { id: "yconia", name: "Yconia", locationId: "loc-yconia", ghlToken: "pit-a" },
  { id: "condesa", name: "Condesa", locationId: "loc-condesa", ghlToken: "pit-b" },
]);

function throws(raw: string, needle: string, label: string) {
  assert.throws(
    () => parseClients(raw),
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      assert.ok(msg.includes(needle), `${label}: expected message to include "${needle}", got "${msg}"`);
      return true;
    },
    label,
  );
}

// --- parse + shape
const clients = parseClients(VALID);
assert.equal(clients.length, 2);
assert.equal(clients[0].id, "yconia");
assert.equal(clients[0].locationId, "loc-yconia");
assert.equal(clients[1].name, "Condesa");

// --- a stray `password` key in the JSON is ignored, not carried through.
// Rosters written under the old model must not smuggle a dead field into ClientConfig.
const legacy = parseClients(
  JSON.stringify([{ id: "a", name: "A", locationId: "l", ghlToken: "t", password: "old" }]),
);
assert.equal((legacy[0] as Record<string, unknown>).password, undefined);

// --- two projects MAY now share a locationId (it is no longer a password)
const shared = parseClients(
  JSON.stringify([
    { id: "a", name: "A", locationId: "same", ghlToken: "t1" },
    { id: "b", name: "B", locationId: "same", ghlToken: "t2" },
  ]),
);
assert.equal(shared.length, 2);

// --- validation failures
throws("not json", "not valid JSON", "malformed JSON");
throws(JSON.stringify({ id: "x" }), "must be a JSON array", "not an array");
throws("[]", "no clients configured", "empty array");
throws(JSON.stringify([{ id: "a", name: "A", locationId: "l" }]), "ghlToken", "missing ghlToken");
throws(JSON.stringify([{ id: "a", name: "A", locationId: "l", ghlToken: "" }]), "ghlToken", "empty ghlToken");
throws(JSON.stringify([{ id: "A.b", name: "A", locationId: "l", ghlToken: "t" }]), "invalid id", "id with a dot");
throws(
  JSON.stringify([
    { id: "a", name: "A", locationId: "l1", ghlToken: "t" },
    { id: "a", name: "B", locationId: "l2", ghlToken: "t" },
  ]),
  "duplicate id",
  "duplicate id",
);

// --- env-backed lookups
process.env.DASHBOARD_CLIENTS = VALID;
assert.equal(getClientById("yconia")?.name, "Yconia");
assert.equal(getClientById("nope"), null);

console.log("✅ lib/clients.ts — all assertions passed");
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
pnpm verify:clients
```

Expected: FAIL. `tsx` reports that `effectivePassword` / `findClientByPassword` are still exported but the new assertions about the dropped `password` field do not hold — specifically the legacy-key assertion fails because `parseClients` still copies `password` through.

- [ ] **Step 4: Strip the password model from `lib/clients.ts`**

Replace the interface and `effectivePassword` (lines 7-20) with:

```typescript
export interface ClientConfig {
  id: string;
  name: string;
  locationId: string;
  ghlToken: string;
}
```

Delete the `password` validation block (the `if (e.password !== undefined ...)` check) and drop the spread from the object literal, leaving:

```typescript
    const client: ClientConfig = {
      id: e.id as string,
      name: e.name as string,
      locationId: e.locationId as string,
      ghlToken: e.ghlToken as string,
    };
```

Delete the `seenPasswords` set, its declaration, and the whole collision block:

```typescript
    // DELETE THIS BLOCK
    const pw = effectivePassword(client);
    if (seenPasswords.has(pw)) {
      throw new Error(`DASHBOARD_CLIENTS: client "${client.id}" shares a password with another client`);
    }
    seenPasswords.add(pw);
```

Delete `findClientByPassword` entirely, and remove the now-unused `import { safeEqual } from "./auth";`.

Update the file's header comment to reflect that the roster no longer carries credentials for login:

```typescript
// lib/clients.ts
// The project roster — the seam between "where project config comes from" and
// everything downstream. Nothing outside this file knows the roster is backed by
// an env var, so swapping in a database later touches only this file.
//
// Note: `client` is the internal vocabulary; the UI calls these "proyectos".
// A project id may not contain a dot — it rides inside the dot-delimited
// dash_project cookie (see lib/auth.ts).
```

- [ ] **Step 5: Run the verification and confirm it passes**

```bash
pnpm verify:clients && npx tsc --noEmit
```

Expected: `✅ lib/clients.ts — all assertions passed`, then tsc exits 0.

If tsc reports `findClientByPassword` is still imported by `app/api/auth/login/route.ts:8`, that is expected — Task 2 fixes it. Leave the error and note it; do not patch the login route here.

- [ ] **Step 6: Update `scripts/add-client.ts`**

Change the header comment (line 5) to drop `--password`:

```typescript
//                  (optional: --id plaza-bosques)
```

In `collect()`, delete `const password = flag("password");` and the spread, leaving:

```typescript
    return {
      id: flag("id"),
      name: flagName,
      locationId,
      ghlToken,
    };
```

Delete the interactive password prompt line and its spread:

```typescript
    return { id, name, locationId, ghlToken };
```

Change the "Client name" prompt to "Project name (e.g. Plaza Bosques): " and the "Client id" prompt to `Project id [${suggestedId}]: `.

Update the validation comment (line 98-99) and the closing message:

```typescript
  // Validate the RESULT, not just the input — this is what catches duplicate ids
  // against projects already in the roster.
```

```typescript
  console.log(
    "\nPaste that into Vercel → Settings → Environment Variables → DASHBOARD_CLIENTS," +
      `\nthen redeploy. ${next.name} will appear as a button on the project picker.\n`,
  );
```

- [ ] **Step 7: Smoke-test the script**

```bash
pnpm add-client --name "Prueba Temporal" --location loc-test --token pit-test
```

Expected: prints a valid JSON blob containing all six existing projects plus `prueba-temporal`, and the closing line mentions the project picker. Nothing is written to disk — the script only prints. Do not paste the output anywhere.

- [ ] **Step 8: Commit**

```bash
git add lib/clients.ts scripts/verify-clients.ts scripts/add-client.ts
git commit -m "refactor(roster): eliminar el modelo de contraseñas de ClientConfig

La contraseña deja de ser la identidad del proyecto, así que password,
effectivePassword, findClientByPassword y la validación de colisión salen
del roster. Dos proyectos ya pueden compartir locationId."
```

---

### Task 2: Team-password gate (`dash_access`)

Replaces password-as-identity with a single shared password. After this task the app gates on the team password but still has no project selection — `requireClient()` is untouched and will fail, so the dashboard will 401. That is expected; Task 3 fixes it.

**Files:**
- Modify: `lib/auth.ts:6-7` (cookie constants)
- Modify: `middleware.ts:3`, `:18-21`
- Modify: `app/api/auth/login/route.ts` (whole password-check section)
- Modify: `app/api/auth/logout/route.ts`
- Modify: `app/login/page.tsx:18`, `:36-38`, `:51-52`, `:57`
- Modify: `scripts/verify-auth.ts`

**Interfaces:**
- Consumes: `ClientConfig` from Task 1 (no `password` field); `findClientByPassword` no longer exists.
- Produces: from `lib/auth.ts` — `ACCESS_COOKIE = "dash_access"`, `PROJECT_COOKIE = "dash_project"`, `ACCESS_PAYLOAD = "ok"`, and `COOKIE_OPTIONS`. `SESSION_COOKIE` is gone. `signToken(payload: string, expiryMs: number)` and `verifyToken(value: string | undefined): Promise<string | null>` keep their existing signatures — only their callers' interpretation of the payload changes.

- [ ] **Step 1: Extend `scripts/verify-auth.ts` (test first)**

Replace lines 13-50 (the body of `main()`) with:

```typescript
async function main() {
  // --- round trip: an arbitrary payload survives sign → verify.
  // The payload is a project id on dash_project and the literal "ok" on dash_access.
  const token = await signToken("yconia", Date.now() + HOUR);
  assert.equal(await verifyToken(token), "yconia");

  const access = await signToken("ok", Date.now() + HOUR);
  assert.equal(await verifyToken(access), "ok");

  // --- the token is dot-delimited: payload.expiry.signature
  assert.equal(token.split(".").length, 3, "token must have exactly 3 segments");
  assert.ok(token.startsWith("yconia."), "payload must be the first segment");

  // --- THE ISOLATION GUARANTEE: swapping the payload invalidates the signature.
  // On dash_project this is what stops a hand-edited cookie from pointing at
  // another project; on dash_access it stops a forged "ok" from being minted.
  const [, expiry, sig] = token.split(".");
  assert.equal(await verifyToken(`condesa.${expiry}.${sig}`), null, "tampered project id must be rejected");
  assert.equal(await verifyToken(`ok.${expiry}.${sig}`), null, "project token must not pass as an access token");

  const [, aExpiry, aSig] = access.split(".");
  assert.equal(await verifyToken(`yconia.${aExpiry}.${aSig}`), null, "access token must not pass as a project token");

  // --- other tampering
  assert.equal(await verifyToken(`yconia.${expiry}.deadbeef`), null, "bad signature rejected");
  assert.equal(await verifyToken(`yconia.${Number(expiry) + 1}.${sig}`), null, "tampered expiry rejected");

  // --- expiry is enforced
  const expired = await signToken("yconia", Date.now() - 1000);
  assert.equal(await verifyToken(expired), null, "expired token rejected");
  const expiredAccess = await signToken("ok", Date.now() - 1000);
  assert.equal(await verifyToken(expiredAccess), null, "expired access token rejected");

  // --- malformed input
  assert.equal(await verifyToken(undefined), null);
  assert.equal(await verifyToken(""), null);
  assert.equal(await verifyToken("garbage"), null);
  assert.equal(await verifyToken("only.two"), null);
  assert.equal(await verifyToken("a.b.c.d"), null);
  assert.equal(await verifyToken(`.${expiry}.${sig}`), null, "empty payload rejected");

  // --- two projects get distinguishable tokens
  const a = await signToken("yconia", Date.now() + HOUR);
  const b = await signToken("condesa", Date.now() + HOUR);
  assert.equal(await verifyToken(a), "yconia");
  assert.equal(await verifyToken(b), "condesa");

  // --- the cookie names are distinct, so an access cookie can never be read as a project cookie
  assert.notEqual(ACCESS_COOKIE, PROJECT_COOKIE);
  assert.equal(ACCESS_PAYLOAD, "ok");

  console.log("✅ lib/auth.ts — all assertions passed");
}
```

Update the import on line 9:

```typescript
import { signToken, verifyToken, ACCESS_COOKIE, PROJECT_COOKIE, ACCESS_PAYLOAD } from "../lib/auth";
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm verify:auth
```

Expected: FAIL — `ACCESS_COOKIE`, `PROJECT_COOKIE` and `ACCESS_PAYLOAD` are not exported from `lib/auth.ts` yet.

- [ ] **Step 3: Add the constants to `lib/auth.ts`**

Replace line 6:

```typescript
// Two cookies, two questions. dash_access answers "may this person enter at all?"
// and is the only one Edge middleware checks. dash_project answers "which project
// are they viewing?" and is resolved by requireClient() (lib/session.ts), which
// needs the roster and therefore must stay out of the Edge bundle.
export const ACCESS_COOKIE = "dash_access";
export const PROJECT_COOKIE = "dash_project";

// The signed payload of dash_access. It carries no identity — past the gate every
// internal user is equivalent — so a fixed sentinel is all that is needed.
export const ACCESS_PAYLOAD = "ok";

// Shared by every Set-Cookie in the app, so one of them can't drift insecure.
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;
```

Update the `signToken` doc comment to stop saying "clientId":

```typescript
// Token format: "<payload>.<expiryMs>.<hmac(payload.expiryMs)>".
// The payload is INSIDE the signature, so a hand-edited cookie fails verification.
// Contains no password and no PII.
```

And `verifyToken`'s:

```typescript
// Returns the signed payload on success, null on any failure (missing, malformed,
// expired, or bad signature). Callers decide what the payload means: the literal
// ACCESS_PAYLOAD for dash_access, a project id for dash_project.
```

- [ ] **Step 4: Run the verification and confirm it passes**

```bash
pnpm verify:auth
```

Expected: `✅ lib/auth.ts — all assertions passed`

- [ ] **Step 5: Point middleware at `dash_access`**

In `middleware.ts`, change the import (line 3) and the check (lines 15-21):

```typescript
import { ACCESS_COOKIE, ACCESS_PAYLOAD, verifyToken } from "@/lib/auth";
```

```typescript
  // Only verifies the gate cookie — it deliberately does NOT resolve the project,
  // which would drag the roster into the Edge bundle. Routes resolve the project
  // themselves via requireClient() (lib/session.ts).
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if ((await verifyToken(token)) === ACCESS_PAYLOAD) return NextResponse.next();
  return denied(req);
```

The `config.matcher` is unchanged: `/login` and `/api/auth` stay excluded so they remain reachable while unauthenticated.

- [ ] **Step 6: Rewrite the login route's password check**

In `app/api/auth/login/route.ts`, replace the imports (lines 3-8):

```typescript
import {
  ACCESS_COOKIE,
  ACCESS_PAYLOAD,
  COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  safeEqual,
  signToken,
} from "@/lib/auth";
```

Replace the misconfiguration guard (lines 47-50):

```typescript
  const expected = process.env.DASHBOARD_ACCESS_PASSWORD;
  if (!expected || !process.env.DASHBOARD_AUTH_SECRET) {
    console.error("[auth] DASHBOARD_ACCESS_PASSWORD or DASHBOARD_AUTH_SECRET not set");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
```

Replace the whole lookup block (lines 65-94) with:

```typescript
  // One shared team password. Constant-time compare: unlike the location ids this
  // replaced, this value is a real secret, so timing must not leak a prefix match.
  if (submitted === "" || !safeEqual(submitted, expected)) {
    recordFailure(ip);
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  // Success: clear failures and set the signed gate cookie. It names no project —
  // the picker sets dash_project separately.
  attempts.delete(ip);
  const expiryMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const token = await signToken(ACCESS_PAYLOAD, expiryMs);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS });
  return res;
```

Delete the now-unused `import { findClientByPassword, type ClientConfig } from "@/lib/clients";` and the `let client: ClientConfig | null = null;` try/catch.

Keep the per-IP rate limiter exactly as it is — with one shared password guarding six sub-accounts it matters more, not less.

- [ ] **Step 7: Make logout clear both cookies**

Replace the body of `app/api/auth/logout/route.ts`:

```typescript
// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, COOKIE_OPTIONS, PROJECT_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Both, always: leaving dash_project behind would drop the next person straight
  // into the previous project once they log back in.
  res.cookies.set(ACCESS_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  res.cookies.set(PROJECT_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
```

- [ ] **Step 8: Update the login page copy**

In `app/login/page.tsx`, change line 18:

```typescript
  useEffect(() => { document.title = "Acceso - Proyectos Lezgo" }, [])
```

Change the error copy (lines 36-38):

```typescript
        setError("Demasiados intentos. Espera unos minutos e intenta de nuevo.")
      } else {
        setError("Clave incorrecta.")
      }
```

Change the card header (lines 51-52):

```tsx
          <CardTitle>Proyectos Lezgo</CardTitle>
          <CardDescription>Ingresa la clave de acceso del equipo.</CardDescription>
```

Change the field label (line 57):

```tsx
              <Label htmlFor="password">Clave de acceso</Label>
```

- [ ] **Step 9: Typecheck and verify**

```bash
npx tsc --noEmit && pnpm verify:auth && pnpm verify:clients
```

Expected: tsc exits 0 (the `findClientByPassword` error from Task 1 Step 5 is now resolved), both scripts print their ✅ line.

- [ ] **Step 10: Drive the app**

```bash
pnpm dev
```

Visit `http://localhost:3000`. Expected: redirected to `/login`. Enter a wrong password → "Clave incorrecta." Enter `ProyectosLezgo1.$` → redirected to `/`, which now **fails to load data** (the dashboard fetch returns 401 because `requireClient()` still reads the old cookie name). That is the expected intermediate state; Task 3 fixes it.

- [ ] **Step 11: Commit**

```bash
git add lib/auth.ts middleware.ts app/api/auth app/login/page.tsx scripts/verify-auth.ts
git commit -m "feat(auth): clave de equipo compartida en lugar de contraseña-por-cliente

dash_session se parte en dash_access (el gate, lo valida el middleware) y
dash_project (cuál proyecto, lo valida requireClient). Esta task solo cablea
el gate; la selección de proyecto llega en la siguiente."
```

---

### Task 3: Project selection (`dash_project`)

Adds the two routes that set and clear the project cookie, and points `requireClient()` at it. After this task the app works end to end via curl, but there is still no UI to choose a project.

**Files:**
- Modify: `lib/session.ts:5-25`
- Create: `app/api/project/select/route.ts`
- Create: `app/api/project/clear/route.ts`

**Interfaces:**
- Consumes: `PROJECT_COOKIE`, `COOKIE_OPTIONS`, `SESSION_MAX_AGE_SECONDS`, `signToken`, `verifyToken` from Task 2; `getClientById`, `getClients`, `ClientConfig` from Task 1.
- Produces: `POST /api/project/select` accepting `{ "id": string }` → `200 {ok:true}` + `Set-Cookie: dash_project`, or `400 {error:"unknown_project"}`. `POST /api/project/clear` → `200 {ok:true}` + expired `dash_project`. `requireClient()` keeps its exact signature: `Promise<ClientConfig | null>`.

- [ ] **Step 1: Point `requireClient()` at the project cookie**

Replace `lib/session.ts` lines 5-25:

```typescript
import { cookies } from "next/headers";
import { PROJECT_COOKIE, verifyToken } from "./auth";
import { getClientById, type ClientConfig } from "./clients";

// Re-verifies the signed cookie itself rather than trusting a header injected by
// middleware — a header would be a spoofing surface, and an HMAC verify costs
// microseconds. Returns null when the cookie is invalid OR when the id no longer
// resolves, which means removing a project from the roster instantly invalidates
// the live sessions viewing it.
//
// Note this checks dash_project, NOT the dash_access gate. Middleware has already
// enforced the gate for every route that reaches here; this answers the separate
// question of WHICH project's credentials to use.
export async function requireClient(): Promise<ClientConfig | null> {
  const token = (await cookies()).get(PROJECT_COOKIE)?.value;
  const clientId = await verifyToken(token);
  if (!clientId) return null;
  try {
    return getClientById(clientId);
  } catch (err) {
    // Roster missing/invalid — fail closed rather than serving anyone.
    console.error("[session] Could not load project roster:", err);
    return null;
  }
}
```

`unauthorized()` at the bottom of the file is unchanged.

- [ ] **Step 2: Create the select route**

Create `app/api/project/select/route.ts`:

```typescript
// app/api/project/select/route.ts
// Sets the dash_project cookie. Sits behind the middleware gate, so reaching this
// route already proves dash_access is valid.
import { NextResponse } from "next/server";
import {
  COOKIE_OPTIONS,
  PROJECT_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signToken,
} from "@/lib/auth";
import { getClientById } from "@/lib/clients";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let id = "";
  try {
    const body = (await req.json()) as { id?: string };
    id = body.id ?? "";
  } catch {
    id = "";
  }

  // Validate against the roster BEFORE signing: signing an unknown id would mint a
  // cookie that passes verifyToken but resolves to null on every request, which
  // reads as "logged out" rather than as the bad input it is.
  let known = false;
  try {
    known = getClientById(id) !== null;
  } catch (err) {
    console.error("[project] Could not load project roster:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!known) {
    return NextResponse.json({ error: "unknown_project" }, { status: 400 });
  }

  const expiryMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const token = await signToken(id, expiryMs);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROJECT_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS });
  return res;
}
```

- [ ] **Step 3: Create the clear route**

Create `app/api/project/clear/route.ts`:

```typescript
// app/api/project/clear/route.ts
// Drops the project selection, sending the user back to the picker. The gate
// cookie survives — this is "cambiar proyecto", not "cerrar sesión".
import { NextResponse } from "next/server";
import { COOKIE_OPTIONS, PROJECT_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROJECT_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Drive the routes with curl**

With `pnpm dev` running.

**Do not use curl's cookie jar (`-c` / `-b`) here.** These cookies are set with
`secure: true`, and curl honours that flag — it will store them but refuse to send
them back over plain `http://localhost`, producing a misleading 401. Pass the
cookie explicitly with `-H 'Cookie: …'`, which curl sends unconditionally.

```bash
# 1. Log in and capture the gate cookie into a shell variable
ACCESS=$(curl -s -D - -o /dev/null -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"ProyectosLezgo1.$"}' \
  | grep -i '^set-cookie: dash_access=' | sed 's/.*dash_access=\([^;]*\).*/\1/')
echo "${ACCESS:0:20}"
```
Expected: prints `ok.` followed by the start of the expiry — confirming the payload
is the `ACCESS_PAYLOAD` sentinel, not a project id. The `-d` payload is in single
quotes so the shell does not expand the `$` in the password.

```bash
# 2. An unknown project is rejected
curl -s -w '\n%{http_code}\n' -X POST localhost:3000/api/project/select \
  -H "Cookie: dash_access=$ACCESS" \
  -H 'Content-Type: application/json' -d '{"id":"no-existe"}'
```
Expected: `{"error":"unknown_project"}` then `400`.

```bash
# 3. A real project is accepted and the cookie names it
curl -s -D - -o /dev/null -X POST localhost:3000/api/project/select \
  -H "Cookie: dash_access=$ACCESS" \
  -H 'Content-Type: application/json' -d '{"id":"balvanera"}' \
  | grep -i '^set-cookie: dash_project='
```
Expected: a `set-cookie` line whose value starts with `balvanera.` and which
carries `HttpOnly` and `Secure`.

```bash
# 4. Without the gate cookie, select is refused by middleware
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/project/select \
  -H 'Content-Type: application/json' -d '{"id":"balvanera"}'
```
Expected: `401`.

Clean up: `unset ACCESS`

- [ ] **Step 6: Commit**

```bash
git add lib/session.ts app/api/project
git commit -m "feat(project): rutas select/clear y requireClient sobre dash_project

requireClient conserva su firma exacta, así que las diez rutas de API que lo
consumen no cambian."
```

---

### Task 4: Split `app/page.tsx` into a server shell + client app

A **verbatim move** with no logic edits, done in its own commit so a regression here is trivially bisectable. `app/page.tsx` is ~330 lines of client component; it becomes a server component that decides which of two children to render.

**Files:**
- Create: `components/dashboard/dashboard-app.tsx` (today's `app/page.tsx`, moved)
- Modify: `app/page.tsx` (replaced with the server shell)

**Interfaces:**
- Consumes: `PROJECT_COOKIE`, `verifyToken` from Task 2; `getClientById` from Task 1.
- Produces: `export function DashboardApp()` — no props, a client component. `app/page.tsx` default-exports an `async` server component.

- [ ] **Step 1: Move the file verbatim**

```bash
git mv app/page.tsx components/dashboard/dashboard-app.tsx
```

- [ ] **Step 2: Rename the export only**

In `components/dashboard/dashboard-app.tsx`, change line 45 from:

```typescript
export default function DashboardPage() {
```

to:

```typescript
export function DashboardApp() {
```

Keep `"use client"` on line 1. Change **nothing else** — not the imports, not the JSX, not the hooks. The `@/` import alias resolves identically from the new location.

- [ ] **Step 3: Write the server shell**

Create `app/page.tsx`:

```tsx
// app/page.tsx
// Server shell. Decides between the project picker and the dashboard based on the
// dash_project cookie. The middleware gate has already run, so anyone reaching
// here holds a valid dash_access.
import { cookies } from "next/headers";
import { PROJECT_COOKIE, verifyToken } from "@/lib/auth";
import { getClientById, getClients } from "@/lib/clients";
import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { ProjectPicker } from "@/components/dashboard/project-picker";

export default async function Page() {
  const token = (await cookies()).get(PROJECT_COOKIE)?.value;
  const projectId = await verifyToken(token);
  const selected = projectId ? safeLookup(projectId) : null;

  if (selected) return <DashboardApp />;

  // Only id and name cross into the browser bundle — never ghlToken or locationId.
  const projects = safeRoster().map((c) => ({ id: c.id, name: c.name }));
  return <ProjectPicker projects={projects} />;
}

function safeLookup(id: string) {
  try {
    return getClientById(id);
  } catch (err) {
    console.error("[page] Could not load project roster:", err);
    return null;
  }
}

function safeRoster() {
  try {
    return getClients();
  } catch (err) {
    // A broken roster shows an empty picker rather than a Next.js error overlay.
    console.error("[page] Could not load project roster:", err);
    return [];
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exactly one error — `Cannot find module '@/components/dashboard/project-picker'`. Task 5 creates it. Do not stub the component here; move to Step 5.

- [ ] **Step 5: Commit the move**

```bash
git add app/page.tsx components/dashboard/dashboard-app.tsx
git commit -m "refactor(page): separar app/page.tsx en shell de servidor + DashboardApp

Movimiento textual: solo cambia el nombre del export y baja un nivel la
frontera \"use client\". El shell aún no compila — le falta ProjectPicker."
```

---

### Task 5: The project picker

**Files:**
- Create: `components/dashboard/project-picker.tsx`
- Modify: `components/dashboard/dashboard-app.tsx` (the header session button, at the lines that were `app/page.tsx:217-231`)

**Interfaces:**
- Consumes: `POST /api/project/select` and `POST /api/project/clear` from Task 3.
- Produces: `export function ProjectPicker({ projects }: { projects: { id: string; name: string }[] })` — a client component.

- [ ] **Step 1: Create the picker**

Create `components/dashboard/project-picker.tsx`:

```tsx
// components/dashboard/project-picker.tsx
"use client"

import { useEffect, useState } from "react"
import { ArrowRight, LogOut, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PickerProject {
  id: string
  name: string
}

export function ProjectPicker({ projects }: { projects: PickerProject[] }) {
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => { document.title = "Proyectos Lezgo" }, [])

  async function open(id: string) {
    setPending(id)
    try {
      const res = await fetch("/api/project/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setPending(null)
        return
      }
      // A full page load, not a router push. A soft navigation would leave the
      // previous project's contacts and chat history mounted in the cached React
      // tree — the same reason the logout button does this.
      window.location.href = "/"
    } catch {
      setPending(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Proyectos Lezgo</h1>
        <p className="mt-2 text-sm text-muted-foreground">Elige el proyecto que quieres revisar.</p>

        {projects.length === 0 ? (
          <p className="mt-10 text-sm text-destructive">
            No hay proyectos configurados. Revisa DASHBOARD_CLIENTS.
          </p>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending !== null}
                onClick={() => open(p.id)}
                className={cn(
                  "group flex items-center justify-between rounded-xl border border-border bg-card",
                  "px-6 py-7 text-left transition-colors duration-200",
                  "hover:border-foreground/25 hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <span className="text-lg font-medium text-foreground">{p.name}</span>
                {pending === p.id ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" })
            window.location.href = "/login"
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </Button>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Turn the dashboard's logout button into "Cambiar proyecto"**

In `components/dashboard/dashboard-app.tsx`, replace the `<Button>` that currently POSTs to `/api/auth/logout` (the one with `aria-label="Cerrar sesión"`) with:

```tsx
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              onClick={async () => {
                await fetch("/api/project/clear", { method: "POST" })
                // A full page load, not a router push: this drops all client-side
                // dashboard state, so the next project opened in this browser
                // can't show the previous project's data behind a cached React tree.
                window.location.href = "/"
              }}
              aria-label="Cambiar proyecto"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
```

Swap the icon import: in the `lucide-react` import block, replace `LogOut,` with `LayoutGrid,`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exits 0. If `LogOut` is reported as unused, the import swap in Step 2 was missed.

- [ ] **Step 4: Drive the full flow in the browser**

```bash
pnpm dev
```

Walk through and confirm each:

1. `http://localhost:3000` → redirected to `/login`.
2. Wrong clave → "Clave incorrecta."
3. `ProyectosLezgo1.$` → the picker, showing six buttons: Lezgo Suite, Condesa Cimatario, Plaza Bosques / Meseta, Grand Center, Balvanera, Yconia.
4. Click **Balvanera** → the loading screen appears and its sub-account name resolves to Balvanera's. Marketing charts render.
5. Click **Cambiar proyecto** (grid icon, top right) → back to the picker.
6. Click **Yconia** → loading screen resolves to Yconia's sub-account, and **no Balvanera data is visible at any point** during the transition.
7. Click **Cambiar proyecto**, then **Cerrar sesión** → `/login`. Navigating to `/` redirects back to `/login`.
8. In DevTools → Application → Cookies, edit `dash_project` to a different project id and reload. Expected: the dashboard's data requests return 401 (the signature no longer matches).

- [ ] **Step 5: Run every verification script**

```bash
pnpm verify:clients && pnpm verify:auth && pnpm verify:limiter && pnpm verify:attachments && npx tsc --noEmit
```

Expected: four ✅ lines, then tsc exits 0. `verify:limiter` passing confirms the per-location isolation survived this change untouched.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/project-picker.tsx components/dashboard/dashboard-app.tsx
git commit -m "feat(picker): panel de selección de proyecto

Botones grandes, uno por entrada del roster. El botón de sesión del header
pasa a ser \"Cambiar proyecto\"; \"Cerrar sesión\" vive ahora en el panel."
```

---

### Task 6: Documentation and deploy notes

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (the "Environment Variables" and "Multi-client (multi-tenancy)" sections)

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Update `.env.example`**

Replace lines 9-22:

```
# Dashboard access gate (server-side only, never exposed to the browser).
#
# DASHBOARD_ACCESS_PASSWORD: ONE shared password for the whole internal team.
#   It gates the deployment; past the gate any user may open any project.
#
# DASHBOARD_CLIENTS: JSON array — one entry per project we commercialize. Each
#   entry carries its own GHL token + location, selected via the project picker.
#   Use `pnpm add-client` to extend this safely.
#
#   [{"id":"yconia","name":"Yconia","locationId":"abc123","ghlToken":"pit-..."}]
#
# DASHBOARD_AUTH_SECRET: random string signing both cookies (openssl rand -hex 32).
#   Rotating it invalidates every live session.
DASHBOARD_ACCESS_PASSWORD=
DASHBOARD_CLIENTS=
DASHBOARD_AUTH_SECRET=
```

- [ ] **Step 2: Rewrite the CLAUDE.md environment section**

Replace the `DASHBOARD_CLIENTS` and `DASHBOARD_AUTH_SECRET` bullets under "Environment Variables":

```markdown
- `DASHBOARD_ACCESS_PASSWORD` — the one shared password for the internal team. Gates
  the whole deployment; past the gate any user may open any project.
- `DASHBOARD_CLIENTS` — JSON array of projects, one per GHL sub-account:
  `[{"id","name","locationId","ghlToken"}]`. Use `pnpm add-client` to extend it safely.
- `DASHBOARD_AUTH_SECRET` — random string used to HMAC-sign both session cookies
  (`openssl rand -hex 32`). Rotating it invalidates every live session.
```

And update the closing line of that section:

```markdown
All are server-side only. `DASHBOARD_CLIENTS` is read in `lib/clients.ts`;
`DASHBOARD_AUTH_SECRET` in `lib/auth.ts`, `app/api/auth/login/route.ts`,
`app/api/project/select/route.ts`, and `middleware.ts` — never exposed to the browser.
```

- [ ] **Step 3: Replace the "Multi-client (multi-tenancy)" section**

Replace that whole section — including the "Password model" paragraph, which no longer describes reality — with:

```markdown
### Internal projects & the access gate

This deployment is **internal**. It serves the projects the company commercializes
for third parties, to company staff. The client-facing product — where a client's
password is their identity — is a *separate* deployment and shares no state with
this one.

**Vocabulary warning:** the UI says "proyecto" everywhere, but the internal code
still says `client` (`ClientConfig`, `getClientById`, `withClient`,
`DASHBOARD_CLIENTS`). This is deliberate — renaming would touch ~20 files without
changing behavior. When reading this code, "client" means "one of our projects",
not "a paying customer".

Two cookies, two questions:

| Cookie | Payload | Verified by | Answers |
|---|---|---|---|
| `dash_access` | `ok.<expiry>.<hmac>` | `middleware.ts` | may this person enter at all? |
| `dash_project` | `<clientId>.<expiry>.<hmac>` | `requireClient()` (`lib/session.ts`) | which project are they viewing? |

1. `lib/clients.ts` — the roster, parsed from `DASHBOARD_CLIENTS`. This is the
   **seam**: nothing downstream knows the roster comes from an env var, so swapping
   in a database later touches only this file. Project ids may not contain dots —
   they ride inside the dot-delimited cookie.
2. Login (`app/api/auth/login/route.ts`) compares the submitted value against
   `DASHBOARD_ACCESS_PASSWORD` with `safeEqual` and signs `dash_access`. It keeps a
   per-IP rate limiter (5 attempts / 15 min) — soft, since Vercel resets it on cold
   starts, but it matters more with one password than it did with per-client ones.
3. `app/page.tsx` is a **server shell**: it reads `dash_project` and renders either
   `project-picker.tsx` or `dashboard-app.tsx`. The picker receives only
   `{ id, name }` per project — **never `ghlToken` or `locationId`**, which would
   put credentials in the browser bundle.
4. `POST /api/project/select` validates the id against the roster before signing.
   `POST /api/project/clear` drops the selection, keeping the gate.
5. Middleware verifies **only** `dash_access`. It deliberately does not resolve the
   project — that would drag the roster into the Edge bundle.
6. Every GHL-touching route calls `requireClient()` (`lib/session.ts`), which
   re-verifies `dash_project` **itself** rather than trusting a middleware-injected
   header, which would be a spoofing surface.
7. The route runs its GHL work inside `withClient(client, ...)`
   (`lib/ghl-context.ts`, an `AsyncLocalStorage`). `ghlFetch` reads credentials via
   `currentClient()`, which is why none of its ~113 exported functions needed a
   signature change. `currentClient()` **fails closed** — it throws rather than
   falling back to a default token.
8. `lib/ghl-limiter.ts` keys the concurrency semaphore, token bucket, and 429
   cooldown **by location id**, because GHL's budget is per location. Shared, one
   project's 429 would freeze every other project's sync.

**NEVER** replace the AsyncLocalStorage context with a module-level "current client"
variable: one serverless instance serves overlapping requests, so that would
silently render project A's dashboard using project B's token. The users being
internal does not change this — it is a correctness bug, not just a leak.

**Every project transition must be a full page load** (`window.location.href`),
never `router.push` / `router.refresh`. A soft navigation leaves the previous
project's contacts, opportunities and chat history mounted in the cached React
tree. This applies to the picker, "Cambiar proyecto", and logout alike.

The two streaming routes (`dashboard`, `dashboard-messages`) enter the context
**inside** the `ReadableStream` `start()` callback — the stream outlives the
handler's return, so wrapping the handler would leave the pump running outside the
context.

`app/api/chat` and `app/api/analyze-report` never touch GHL (they work off data the
browser already holds), so they need no client context — only the middleware gate.

Verification scripts (no test framework in this repo): `pnpm verify:clients`,
`verify:auth`, `verify:limiter`.
```

- [ ] **Step 4: Fix the stale `npm run add-client` references**

`CLAUDE.md` still says `npm run add-client` in the Commands block's comment and in the `DASHBOARD_CLIENTS` bullet. Change both to `pnpm add-client`, consistent with the pnpm rule already stated further down that file.

- [ ] **Step 5: Update the data-flow diagram**

In the "Data flow" block, the line `↓  requireClient()  → resolves the cookie's client id to a ClientConfig (lib/session.ts)` becomes:

```
    ↓  requireClient()  → resolves dash_project to a ClientConfig (lib/session.ts)
```

And add `auth/login` / `auth/logout`'s neighbours to the route table — insert one row:

```markdown
| `project/select` / `project/clear` | which project the session is viewing — **no GHL** |
```

- [ ] **Step 6: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: panel de proyectos internos y las dos cookies

Reemplaza la sección de multi-tenancy: la contraseña ya no es identidad.
Documenta la ambigüedad client/proyecto en el vocabulario del código."
```

- [ ] **Step 7: Deploy checklist (do not run — hand to the user)**

Print this for the user rather than executing it:

```
En Vercel → Settings → Environment Variables, en el MISMO despliegue:
  1. DASHBOARD_ACCESS_PASSWORD  = ProyectosLezgo1.$        (nueva)
  2. DASHBOARD_AUTH_SECRET      = <el mismo valor de .env.local>  (rotada)
  3. DASHBOARD_CLIENTS          = los seis proyectos, sin campos "password"
  4. Redeploy.

Rotar el secreto sin desplegar el código nuevo solo cierra la sesión de todos
en la app vieja. Los dos cambios van juntos.
```

---

## Notes for the implementer

- **Task 1 Step 5 and Task 4 Step 4 each end with a known, expected tsc error.** They are the only two places where a red typecheck is correct. Everywhere else, tsc must be green before committing.
- **`pnpm verify:limiter` and `pnpm verify:attachments` should never change.** If either starts failing, something outside this plan's scope broke — stop and investigate rather than editing the script.
- The GHL private-integration tokens in Task 1 Step 1 were pasted into a chat transcript. Mention to the user that rotating them in GHL is worthwhile if that transcript is retained or shared.
