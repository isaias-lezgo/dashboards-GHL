# GHL Data-Retrieval Endpoint Fixes — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project has **no test runner** (see CLAUDE.md), so "verify" steps use `npm run build`, `npm run lint`, and live cross-checks against the `ghl-mcp` MCP server instead of unit tests.

**Goal:** Fix four real data-retrieval bugs found during a live MCP audit of the GHL integration so the dashboard and the AI analyze-contact feature show correct lost reasons, appointment locations, contact names, and calendar events.

**Architecture:** All GHL calls live server-side in `lib/ghl-client.ts` and are consumed by `app/api/dashboard/route.ts` (dashboard stream) and `app/api/analyze-contact/route.ts` (AI report). Internal types are in `lib/types.ts`. Fixes are confined to those three files. No runtime data-flow changes — only field mapping/type corrections.

**Tech Stack:** Next.js 15 (App Router), TypeScript, GoHighLevel REST API (`services.leadconnectorhq.com`), `ghl-mcp` MCP server for live verification.

---

## Background — what the live MCP audit proved (2026-05-28)

Verified against location `uRFrk77agXq9is0a0gkp` ("Lezgo Suite"):

1. **Lost reason:** every `lost` opportunity returns `lostReasonId: null`. The real reason is in the opportunity **custom field** "Motivo de Perdido" (id `2157x7N2q58gfTcSj5ZT`, returned as `fieldValueString`, e.g. `"Falta de Respuesta"`). The current `getLostReasons()` → `/locations/{id}/customValues` lookup is the wrong namespace and never resolves anything.
2. **Calendar events:** `GET /opportunities/{id}` returns **no** calendar events. They only appear from `GET /opportunities/search` with `getCalendarEvents=true`, under the **misspelled** key `calenders` (not `calendarEvents`). So `analyze-contact` always shows "Sin citas registradas".
3. **Appointment location:** `/calendars/events` events have **no** `location` field — the meeting link/place is in `address`. `route.ts` reads `ev.location`, always empty.
4. **Contact names:** `/contacts/` returns lowercased `firstName`/`lastName` plus proper-case `firstNameRaw`/`lastNameRaw`/`contactName`. The code builds names from the lowercase fields, so the dashboard shows "ricardo a. cortes lima" instead of "Ricardo A. Cortes Lima".

Known-good reference IDs for verification:
- Opportunity **with** a confirmed appointment: `yVfM51KLPoHrHTA6ZjXM` (its `calenders[0]` has `calendarId: LeomdQuvC0Tm0FTlObAX`, `appoinmentStatus: confirmed`, `startTime: 2026-05-29T10:00:00-06:00`).
- A `lost` opportunity with the custom-field reason: `NkURSECz7Qo6hdfY6seM` → "Motivo de Perdido" = `"Falta de Respuesta"`.
- A user id that returns calendar events: `g4lTMmyu0FJpAqbnN4K3`.

---

## File Structure

- **Modify** `lib/ghl-client.ts` — add `address?` to `GHLCalendarEvent`; add `contactName`/`firstNameRaw`/`lastNameRaw` to `GHLContact`; add `GHLOpportunityCalendarEntry` + `calenders?` on `GHLOpportunity`; rewrite `getOpportunityById` to use the search endpoint; remove dead `getLostReasons` + `GHLCustomValue`.
- **Modify** `app/api/dashboard/route.ts` — source lost reason from the "Motivo de Perdido" custom field; drop the `getLostReasons`/`lostReasonMap` path; map appointment `location` from `ev.address`.
- **Modify** `lib/types.ts` — update the doc comment on `Opportunity.lostReason` (now resolved from a custom field, not custom values). No structural type change required.

---

## Task 1: Fix contact names (Bug #4)

**Files:**
- Modify: `lib/ghl-client.ts` (the `GHLContact` interface, ~line 114-181)
- Modify: `app/api/dashboard/route.ts:77` (`transformContact` name line)

- [ ] **Step 1: Add the raw/contactName fields to `GHLContact`**

In `lib/ghl-client.ts`, find the `GHLContact` interface and add three fields next to the existing `name?` field. Locate:

```ts
  name?: string;
  firstName?: string;
  lastName?: string;
```

Replace with:

```ts
  name?: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  firstNameRaw?: string;
  lastNameRaw?: string;
```

- [ ] **Step 2: Prefer proper-case names in `transformContact`**

In `app/api/dashboard/route.ts`, find (line ~77):

```ts
    name: ghl.name || `${ghl.firstName || ""} ${ghl.lastName || ""}`.trim() || "Unknown",
```

Replace with:

```ts
    name:
      ghl.name?.trim() ||
      `${ghl.firstNameRaw ?? ""} ${ghl.lastNameRaw ?? ""}`.trim() ||
      ghl.contactName?.trim() ||
      `${ghl.firstName ?? ""} ${ghl.lastName ?? ""}`.trim() ||
      "Unknown",
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both succeed (no new errors).

- [ ] **Step 4: Commit**

```bash
git add lib/ghl-client.ts app/api/dashboard/route.ts
git commit -m "fix(ghl): use proper-case contact names from firstNameRaw/lastNameRaw

The /contacts/ list endpoint returns lowercased firstName/lastName; the
proper-case values live in firstNameRaw/lastNameRaw/contactName. Prefer
those so the dashboard stops rendering lowercased names."
```

---

## Task 2: Fix appointment location (Bug #3)

**Files:**
- Modify: `lib/ghl-client.ts` (`GHLCalendarEvent` interface, ~line 440-453)
- Modify: `app/api/dashboard/route.ts:495` (appointment push)

- [ ] **Step 1: Add `address` to `GHLCalendarEvent`**

In `lib/ghl-client.ts`, find:

```ts
  appointmentStatus?: string;
  assignedUserId?: string;
  notes?: string;
  location?: string;
  dateAdded: string;
```

Replace with:

```ts
  appointmentStatus?: string;
  assignedUserId?: string;
  notes?: string;
  address?: string;
  location?: string;
  dateAdded: string;
```

- [ ] **Step 2: Map appointment location from `address`**

In `app/api/dashboard/route.ts`, find (line ~495):

```ts
                  notes: ev.notes,
                  location: ev.location,
                });
```

Replace with:

```ts
                  notes: ev.notes,
                  location: ev.address ?? ev.location,
                });
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add lib/ghl-client.ts app/api/dashboard/route.ts
git commit -m "fix(ghl): map appointment location from calendar event address

/calendars/events returns the meeting link/place in `address`, not
`location`, so appointment.location was always empty."
```

---

## Task 3: Fix lost-reason resolution (Bug #1)

**Files:**
- Modify: `app/api/dashboard/route.ts` (import line 1-18, `transformOpportunity` ~line 118, the `Promise.allSettled` block ~line 191-204, the lostReason map ~line 239-242, the post-loop mapping ~line 348-350)
- Modify: `lib/ghl-client.ts` (remove dead `getLostReasons` + `GHLCustomValue`, ~line 511-521)
- Modify: `lib/types.ts:92` (doc comment only)

- [ ] **Step 1: Source lost reason from the custom field in `transformOpportunity`**

In `app/api/dashboard/route.ts`, find (line ~118):

```ts
    lostReason: ghl.lostReasonId,
```

Replace with:

```ts
    lostReason:
      ghl.status === "lost"
        ? customFieldsResolved["Motivo de Perdido"] || undefined
        : undefined,
```

(`customFieldsResolved` is already computed at the top of `transformOpportunity`.)

- [ ] **Step 2: Remove `getLostReasons` from the import block**

In `app/api/dashboard/route.ts`, find in the import list:

```ts
  getUsers,
  getLostReasons,
  getCustomFields,
```

Replace with:

```ts
  getUsers,
  getCustomFields,
```

- [ ] **Step 3: Drop `getLostReasons()` from the parallel fetch**

Find (line ~191-204):

```ts
        const [pipelinesResult, usersResult, lostReasonsResult, customFieldsResult] =
          await Promise.allSettled([
            getPipelines(),
            getUsers(),
            getLostReasons(),
            getCustomFields(),
          ]);

        send({ type: "progress", message: "Cargando pipelines y configuración…" });

        const pipelinesRaw = pipelinesResult.status === "fulfilled" ? pipelinesResult.value : { pipelines: [] };
        const usersRaw = usersResult.status === "fulfilled" ? usersResult.value : { users: [] };
        const lostReasonsRaw = lostReasonsResult.status === "fulfilled" ? lostReasonsResult.value : { customValues: [] };
        const customFieldsRaw = customFieldsResult.status === "fulfilled" ? customFieldsResult.value : { customFields: [] };
```

Replace with:

```ts
        const [pipelinesResult, usersResult, customFieldsResult] =
          await Promise.allSettled([
            getPipelines(),
            getUsers(),
            getCustomFields(),
          ]);

        send({ type: "progress", message: "Cargando pipelines y configuración…" });

        const pipelinesRaw = pipelinesResult.status === "fulfilled" ? pipelinesResult.value : { pipelines: [] };
        const usersRaw = usersResult.status === "fulfilled" ? usersResult.value : { users: [] };
        const customFieldsRaw = customFieldsResult.status === "fulfilled" ? customFieldsResult.value : { customFields: [] };
```

- [ ] **Step 4: Remove the now-unused `lostReasonMap` block**

Find (line ~238-242):

```ts
        // Build lost reason map
        const lostReasonMap = new Map<string, string>();
        for (const cv of lostReasonsRaw.customValues) {
          lostReasonMap.set(cv.id, cv.name);
        }

```

Delete it entirely (including the trailing blank line).

- [ ] **Step 5: Remove the post-loop lostReason remapping**

Find (line ~348-350, inside the `for (const opp of opportunities)` loop):

```ts
          if (opp.lostReason && lostReasonMap.has(opp.lostReason)) {
            opp.lostReason = lostReasonMap.get(opp.lostReason);
          }
```

Delete those three lines. The surrounding loop (the `if (contact) { ... }` block above it) stays.

- [ ] **Step 6: Delete dead `getLostReasons` + `GHLCustomValue` from the client**

In `lib/ghl-client.ts`, find:

```ts
// ============ CUSTOM VALUES / LOST REASONS ============

export interface GHLCustomValue {
  id: string;
  name: string;
  fieldKey: string;
}

export async function getLostReasons(): Promise<{ customValues: GHLCustomValue[] }> {
  return ghlFetch<{ customValues: GHLCustomValue[] }>("/locations/:locationId/customValues");
}

```

Delete the whole block (it is now unreferenced — confirmed in Step 2).

- [ ] **Step 7: Update the `Opportunity.lostReason` doc comment**

In `lib/types.ts`, find (line ~92):

```ts
  lostReason?: string   // computed: resolved from lostReasonId via custom values lookup
```

Replace with:

```ts
  lostReason?: string   // computed: from the "Motivo de Perdido" opportunity custom field (lostReasonId is always null in this location)
```

- [ ] **Step 8: Confirm no other references to the removed symbols**

Run: `grep -rn "getLostReasons\|GHLCustomValue\|lostReasonMap\|lostReasonsRaw" app/ lib/`
Expected: **no output** (all references removed).

- [ ] **Step 9: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 10: Commit**

```bash
git add app/api/dashboard/route.ts lib/ghl-client.ts lib/types.ts
git commit -m "fix(ghl): resolve lost reason from Motivo de Perdido custom field

lostReasonId is always null in this location; the real reason lives in the
opportunity custom field 'Motivo de Perdido'. Source it from there and drop
the dead /locations/{id}/customValues lookup and lostReasonMap."
```

---

## Task 4: Fix analyze-contact calendar events (Bug #2)

**Files:**
- Modify: `lib/ghl-client.ts` (`GHLOpportunity` interface ~line 216-267; `getOpportunityById` ~line 287-293; `GHLOpportunityDetailResponse` ~line 283-285)
- No change needed in `app/api/analyze-contact/route.ts` — it already reads `oppDetail.calendarEvents`.

- [ ] **Step 1: Add the embedded calendar-entry type + `calenders` field**

In `lib/ghl-client.ts`, immediately **before** `export interface GHLOpportunity {`, add:

```ts
// Calendar entries embedded by /opportunities/search when getCalendarEvents=true.
// Note GHL's misspellings: the array key is `calenders` and the status field is
// `appoinmentStatus`.
export interface GHLOpportunityCalendarEntry {
  id: string;
  contactId?: string;
  calendarId?: string;
  assignedUserId?: string;
  startTime: string;
  endTime: string;
  status?: string;
  appoinmentStatus?: string;
  title?: string;
  notes?: string;
}

```

- [ ] **Step 2: Add `calenders?` to `GHLOpportunity`**

In the `GHLOpportunity` interface, find:

```ts
  contact: {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
  };
```

Add directly above it:

```ts
  // Present only when fetched via /opportunities/search with getCalendarEvents=true
  calenders?: GHLOpportunityCalendarEntry[];
  contact: {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
  };
```

- [ ] **Step 3: Rewrite `getOpportunityById` to use the search endpoint**

In `lib/ghl-client.ts`, find:

```ts
export async function getOpportunityById(id: string): Promise<GHLOpportunityDetail> {
  const resp = await ghlFetch<GHLOpportunityDetailResponse>(
    `/opportunities/${id}`,
    { noQueryLocationId: true }
  );
  return resp.opportunity;
}
```

Replace with:

```ts
export async function getOpportunityById(id: string): Promise<GHLOpportunityDetail> {
  // GET /opportunities/{id} does NOT return calendar events. The search endpoint
  // with getCalendarEvents=true does — under the misspelled key `calenders`.
  const resp = await ghlFetch<GHLOpportunitiesResponse>("/opportunities/search", {
    useSnakeCaseLocationId: true,
    params: { id, getCalendarEvents: true, limit: 1 },
  });
  const opp = resp.opportunities[0];
  if (!opp) throw new Error(`Opportunity ${id} not found`);
  const calendarEvents: GHLCalendarEvent[] = (opp.calenders ?? []).map((c) => ({
    id: c.id,
    calendarId: c.calendarId ?? "",
    contactId: c.contactId ?? "",
    status: c.status ?? "",
    startTime: c.startTime,
    endTime: c.endTime,
    appointmentStatus: c.appoinmentStatus ?? c.status,
    assignedUserId: c.assignedUserId,
    title: c.title,
    notes: c.notes,
    dateAdded: c.startTime,
  }));
  return { ...opp, calendarEvents };
}
```

- [ ] **Step 4: Remove the now-unused `GHLOpportunityDetailResponse`**

In `lib/ghl-client.ts`, find:

```ts
export interface GHLOpportunityDetailResponse {
  opportunity: GHLOpportunityDetail;
}

```

Delete it. (Confirm in Step 6 it has no other references.)

- [ ] **Step 5: Verify the call site still type-checks**

Open `app/api/analyze-contact/route.ts` and confirm line ~237-238 is unchanged and still reads:

```ts
    const oppDetail = await getOpportunityById(body.opportunityId);
    calendarEvents = oppDetail.calendarEvents ?? [];
```

No edit required — just confirm.

- [ ] **Step 6: Confirm no dangling references**

Run: `grep -rn "GHLOpportunityDetailResponse" app/ lib/`
Expected: **no output**.

- [ ] **Step 7: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add lib/ghl-client.ts
git commit -m "fix(ghl): fetch opportunity calendar events via search endpoint

GET /opportunities/{id} returns no calendar events; the search endpoint with
getCalendarEvents=true returns them under the misspelled `calenders` key. Map
those into calendarEvents so analyze-contact stops reporting 'Sin citas'."
```

---

## Task 5: Live verification against MCP

This project has no test suite, so verify behavior by running the app and comparing against known MCP values.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (leave running; serves on http://localhost:3000)

- [ ] **Step 2: Pull the dashboard stream and check the three dashboard-side fixes**

Run:

```bash
curl -sN http://localhost:3000/api/dashboard | grep '"type":"data"' > /tmp/ghl-data.json
```

Then inspect `/tmp/ghl-data.json`:
- **Bug #4 (names):** confirm at least one contact `name` has uppercase letters (e.g. matches `Ricardo`/`Laura`/`Guillermina`), not all-lowercase.
  Run: `grep -o '"name":"[A-ZÁÉÍÓÚÑ][^"]*"' /tmp/ghl-data.json | head`
  Expected: proper-case names appear.
- **Bug #3 (location):** confirm at least one appointment has a `location` containing `meet.google.com`.
  Run: `grep -o '"location":"https://meet.google.com[^"]*"' /tmp/ghl-data.json | head`
  Expected: at least one match (the audit saw many Google Meet links in `address`).
- **Bug #1 (lost reason):** confirm at least one opportunity carries a real `lostReason` string.
  Run: `grep -o '"lostReason":"[^"]*"' /tmp/ghl-data.json | sort | uniq -c`
  Expected: values like `"Falta de Respuesta"` (matches the "Motivo de Perdido" picklist), not empty.

- [ ] **Step 3: Cross-check Bug #2 (analyze-contact calendar events)**

The audit confirmed opportunity `yVfM51KLPoHrHTA6ZjXM` has a confirmed appointment on 2026-05-29. Verify `getOpportunityById` now surfaces it. If `ANTHROPIC_API_KEY` is set in `.env.local`, exercise the endpoint:

```bash
curl -s -X POST http://localhost:3000/api/analyze-contact \
  -H 'Content-Type: application/json' \
  -d '{
    "opportunityId": "yVfM51KLPoHrHTA6ZjXM",
    "contact": { "name": "Guillermina Pérez Perez" },
    "opportunity": { "id": "yVfM51KLPoHrHTA6ZjXM", "name": "Guillermina - inmobiliaria", "pipelineName": "Ventas", "stage": "Primera Cita", "status": "open", "value": 0 }
  }' | python3 -m json.tool
```

Expected: the `analysis` text includes a **"Citas programadas"** section referencing 29/05/2026 — proving calendar events now flow through (previously this section was always omitted).

If `ANTHROPIC_API_KEY` is **not** set (endpoint returns the 500 "ANTHROPIC_API_KEY no está configurada" before fetching), skip the AI call and instead confirm via MCP that the data source is correct: `mcp__ghl-mcp__opportunities_search-opportunity` with `query_id=yVfM51KLPoHrHTA6ZjXM` and `query_getCalendarEvents=true` returns a non-empty `calenders` array. The code in Task 4 maps exactly that array.

- [ ] **Step 4: Stop the dev server** (Ctrl-C) and clean up `/tmp/ghl-data.json`.

- [ ] **Step 5: Final commit if any verification tweaks were needed** (otherwise nothing to commit).

---

## Task 6: Fetch opportunity custom fields (Bug #5 — found during Task 5 verification)

**Discovered:** `getCustomFields()` sent no `model` param, so GHL's `/locations/{id}/customFields` returned **only contact** custom fields. Every opportunity custom field (incl. "Motivo de Perdido") was missing from the id→name map, so opportunity `customFieldsResolved` was silently empty and the Task 3 lost-reason fix couldn't resolve. Confirmed in payload: contact field "Origen de Lead" resolved 1548×, opportunity fields ~0×.

**Files:** Modify `lib/ghl-client.ts` (`getCustomFields`).

- [x] **Step 1: Request all models**

Find:

```ts
export async function getCustomFields(): Promise<GHLCustomFieldsResponse> {
  return ghlFetch<GHLCustomFieldsResponse>("/locations/:locationId/customFields");
}
```

Replace with:

```ts
export async function getCustomFields(): Promise<GHLCustomFieldsResponse> {
  // Without ?model=all the endpoint returns ONLY contact custom fields, so
  // opportunity fields (e.g. "Motivo de Perdido") never make it into the
  // id→name map and stay unresolved.
  return ghlFetch<GHLCustomFieldsResponse>("/locations/:locationId/customFields", {
    params: { model: "all" },
  });
}
```

- [x] **Step 2: Re-verify** — dashboard payload now shows `lostReason` populated (139 lost opps across 5 picklist values) and opportunity fields resolved (Motivo de Perdido 144×, Tipo de Implementación 35×, Periodo de Facturación 46×). This was a prerequisite for Bug #1.

---

## Verification results (2026-05-28)

- **Bug #4 (names):** ✅ proper-case names now appear ("Ricardo A. Cortes Lima"). Remaining leading-lowercase names are genuinely lowercase in source data.
- **Bug #3 (location):** ✅ 125 appointments now carry Google Meet links (mapped from `address`); was 0 before.
- **Bug #1 (lost reason):** ✅ 139 lost opps now carry reasons — only after the Task 6 `model=all` fix.
- **Bug #5 (custom fields):** ✅ all opportunity custom fields now resolve.
- **Bug #2 (calendar events):** ✅ data path verified — `getOpportunityById` query returns `calenders` for opp `yVfM51KLPoHrHTA6ZjXM` (appt 2026-05-29), function ran with no fetch warning. End-to-end AI output couldn't be checked: the Anthropic call fails on a **billing** error (low credit balance), unrelated to the code.

**Build:** `npm run build` ✅ clean. `tsc --noEmit` ✅ no errors in touched files. (ESLint not installed in this environment.)

## Self-Review notes

- **Spec coverage:** Task 1 → Bug #4, Task 2 → Bug #3, Task 3 → Bug #1, Task 4 → Bug #2, Task 5 → verification of all four. Audit findings #5–#7 (outdated calendar-fan-out comment, type-only inaccuracies, dead `getTags`/`getContactTasks`) are intentionally **out of scope** — they are non-functional and the user prioritized #1–#4.
- **Type consistency:** `getOpportunityById` returns `GHLOpportunityDetail` (= `GHLOpportunity` + `calendarEvents: GHLCalendarEvent[]`), unchanged signature, so `analyze-contact` needs no edit. The new `GHLOpportunityCalendarEntry` is only referenced by `GHLOpportunity.calenders` and `getOpportunityById`. `ghlFetch` params already accept `string | number | boolean | undefined`, so `getCalendarEvents: true` and `id` are valid.
- **No placeholders:** every edit shows exact old/new strings.
