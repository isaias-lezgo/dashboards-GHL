# Pautas Drawer Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the Pautas drill-down drawer so each card shows all Pauta properties, the associated GHL Contact, and that contact's Opportunities.

**Architecture:** Extend `Pauta` with `contactId` (from GHL associations) and `properties` (all raw fields); update `fetchAllPautas()` to populate them server-side; rewrite `PautasList` in the drawer to render three sections per card: pauta fields → contact → opportunities. All contact/opportunity resolution is pure client-side filtering — no new API calls at render time.

**Tech Stack:** Next.js 15 App Router, TypeScript, Recharts, shadcn/ui, Tailwind CSS, lucide-react, framer-motion.

---

## File Map

| File | Change |
|---|---|
| `lib/types.ts` | Add `contactId?` and `properties?` to `Pauta` |
| `lib/ghl-client.ts` | Add `associations?` to `GHLCustomObjectRecord` |
| `app/api/dashboard/route.ts` | Update `fetchAllPautas()` to extract contactId + all properties |
| `components/dashboard/chart-drill-drawer.tsx` | Enrich `PautasList`; pass new props from `ChartDrillDrawer` |

---

### Task 1: Extend `Pauta` type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `contactId` and `properties` to the `Pauta` interface**

Open `lib/types.ts`. Find the `Pauta` interface (currently at the bottom of the file):

```ts
export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
}
```

Replace it with:

```ts
export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
  contactId?: string
  properties?: Record<string, string>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors (there may be pre-existing errors the project ignores — that's fine as long as no new ones appear related to `Pauta`).

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add lib/types.ts && git commit -m "feat(types): add contactId and properties to Pauta"
```

---

### Task 2: Extend `GHLCustomObjectRecord` to capture associations

**Files:**
- Modify: `lib/ghl-client.ts`

- [ ] **Step 1: Add `associations` to `GHLCustomObjectRecord`**

Open `lib/ghl-client.ts`. Find:

```ts
export interface GHLCustomObjectRecord {
  id: string;
  properties: Record<string, string | string[] | null>;
  createdAt?: string;
  updatedAt?: string;
}
```

Replace with:

```ts
export interface GHLCustomObjectRecord {
  id: string;
  properties: Record<string, string | string[] | null>;
  createdAt?: string;
  updatedAt?: string;
  associations?: Record<string, unknown>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add lib/ghl-client.ts && git commit -m "feat(ghl-client): add associations field to GHLCustomObjectRecord"
```

---

### Task 3: Update `fetchAllPautas()` to extract contactId and all properties

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Add a helper that resolves contactId from raw associations**

Open `app/api/dashboard/route.ts`. Add this helper function immediately before `fetchAllPautas`:

```ts
function resolveContactIdFromAssociations(associations: Record<string, unknown> | undefined): string | undefined {
  if (!associations) return undefined;

  // Try the most common GHL key shapes for a contact association
  const candidates = [
    associations["contact"],
    associations["contacts"],
    associations["Contact"],
  ];

  for (const val of candidates) {
    if (typeof val === "string" && val.trim()) return val.trim();
    if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0].trim();
    // GHL sometimes wraps associations as [{ id: "...", objectType: "contact" }]
    if (Array.isArray(val) && val[0] && typeof (val[0] as any).id === "string") {
      return (val[0] as any).id;
    }
  }

  return undefined;
}
```

- [ ] **Step 2: Rewrite the `fetchAllPautas` mapping to extract contactId and all properties**

Find the current `fetchAllPautas` function:

```ts
async function fetchAllPautas(): Promise<Pauta[]> {
  try {
    // List all custom objects to find the Pautas schema key
    const schemasResp = await getCustomObjects();
    const stub = schemasResp.objects.find(
      (s) =>
        s.labels.singular.toLowerCase().includes("pauta") ||
        s.labels.plural.toLowerCase().includes("pautas")
    );
    if (!stub) {
      console.warn("[GHL] Pautas custom object schema not found");
      return [];
    }

    const records = await getAllCustomObjectRecords(stub.key);
    return records.map((r) => ({
      id: r.id,
      tipo: String(r.properties["tipo"] ?? "") || "Sin tipo",
      nombrePauta: String(r.properties["nombre_pauta"] ?? "") || "Sin nombre",
      createdAt: r.createdAt ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[GHL] Pautas fetch failed:", err);
    return [];
  }
}
```

Replace with:

```ts
async function fetchAllPautas(): Promise<Pauta[]> {
  try {
    const schemasResp = await getCustomObjects();
    const stub = schemasResp.objects.find(
      (s) =>
        s.labels.singular.toLowerCase().includes("pauta") ||
        s.labels.plural.toLowerCase().includes("pautas")
    );
    if (!stub) {
      console.warn("[GHL] Pautas custom object schema not found");
      return [];
    }

    const records = await getAllCustomObjectRecords(stub.key);

    // Log raw association shape from first record once — helps confirm the key at runtime
    if (records[0]?.associations !== undefined) {
      console.log("[GHL] Pauta associations sample:", JSON.stringify(records[0].associations));
    } else {
      console.warn("[GHL] Pauta record has no 'associations' field — contactId will be empty. Raw keys:", Object.keys(records[0] ?? {}));
    }

    // Keys to exclude from the generic properties display (already rendered in the card header)
    const SKIP_PROPERTY_KEYS = new Set(["tipo", "nombre_pauta", "id"]);

    return records.map((r) => {
      // Collect all non-empty properties except the ones shown in the header
      const properties: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.properties)) {
        if (SKIP_PROPERTY_KEYS.has(k)) continue;
        if (v === null || v === undefined) continue;
        const str = Array.isArray(v) ? v.join(", ") : String(v);
        if (str.trim()) properties[k] = str.trim();
      }

      return {
        id: r.id,
        tipo: String(r.properties["tipo"] ?? "") || "Sin tipo",
        nombrePauta: String(r.properties["nombre_pauta"] ?? "") || "Sin nombre",
        createdAt: r.createdAt ?? new Date().toISOString(),
        contactId: resolveContactIdFromAssociations(r.associations),
        properties,
      };
    });
  } catch (err) {
    console.error("[GHL] Pautas fetch failed:", err);
    return [];
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add app/api/dashboard/route.ts && git commit -m "feat(api): extract contactId and all properties from Pauta records"
```

---

### Task 4: Rewrite `PautasList` and wire props in `ChartDrillDrawer`

**Files:**
- Modify: `components/dashboard/chart-drill-drawer.tsx`

This is the main UI task. We enrich `PautasList` with three sections per card and pass the required props from `ChartDrillDrawer`.

- [ ] **Step 1: Add `Mail` and `Phone` to the lucide-react import**

Open `components/dashboard/chart-drill-drawer.tsx`. Find the lucide-react import line:

```ts
import { DollarSign, User, Tag, FileText, ChevronRight, TrendingUp } from "lucide-react"
```

Replace with:

```ts
import { DollarSign, User, Tag, FileText, ChevronRight, TrendingUp, Mail, Phone } from "lucide-react"
```

- [ ] **Step 2: Add `contacts` and `allOpportunities` to the `PautasList` call inside `ChartDrillDrawer`**

Find the existing call to `PautasList` in the body of `ChartDrillDrawer`:

```tsx
) : showPautas ? (
  <PautasList pautas={drill.pautas!} />
```

Replace with:

```tsx
) : showPautas ? (
  <PautasList pautas={drill.pautas!} contacts={contacts} allOpportunities={allOpportunities} />
```

- [ ] **Step 3: Replace the `PautasList` function with the enriched version**

Find and delete the entire existing `PautasList` function:

```ts
function PautasList({ pautas }: { pautas: Pauta[] }) {
  return (
    <>
      {pautas.map((p, i) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground truncate">
                {p.nombrePauta}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">{p.tipo}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground pl-5">
            {new Date(p.createdAt).toLocaleDateString("es-MX")}
          </p>
        </motion.div>
      ))}
    </>
  )
}
```

Replace with:

```tsx
const OPP_STATUS_ORDER: Record<string, number> = { open: 0, won: 1, lost: 2, abandoned: 3 }

function PautasList({
  pautas,
  contacts,
  allOpportunities,
}: {
  pautas: Pauta[]
  contacts: Contact[]
  allOpportunities: Opportunity[]
}) {
  return (
    <>
      {pautas.map((p, i) => {
        const contact = p.contactId ? contacts.find((c) => c.id === p.contactId) : undefined
        const opps = contact
          ? allOpportunities
              .filter((o) => o.contactId === contact.id)
              .sort((a, b) => (OPP_STATUS_ORDER[a.status] ?? 3) - (OPP_STATUS_ORDER[b.status] ?? 3))
          : []

        // Extra properties to display (excludes tipo/nombrePauta which are in the header)
        const extraProps = Object.entries(p.properties ?? {})

        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* ── Pauta section ── */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground truncate">
                    {p.nombrePauta}
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{p.tipo}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5 mb-2">
                {new Date(p.createdAt).toLocaleDateString("es-MX")}
              </p>
              {extraProps.length > 0 && (
                <div className="pl-5 flex flex-wrap gap-x-3 gap-y-1">
                  {extraProps.map(([k, v]) => (
                    <span key={k} className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">{k.replace(/_/g, " ")}:</span>{" "}
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Contact section ── */}
            <div className="border-t border-border px-4 py-3 bg-muted/20">
              {!p.contactId ? (
                <p className="text-[11px] text-muted-foreground italic">Sin contacto asociado</p>
              ) : !contact ? (
                <p className="text-[11px] text-muted-foreground italic">Contacto no encontrado</p>
              ) : (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{contact.name}</span>
                  </div>
                  <div className="flex items-center gap-3 pl-5 text-[11px] text-muted-foreground">
                    {contact.email && (
                      <span className="flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="flex items-center gap-1 shrink-0">
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Opportunities section ── */}
            {contact && (
              <div className="border-t border-border px-4 py-3">
                {opps.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Sin oportunidades</p>
                ) : (
                  <div className="space-y-1.5">
                    {opps.map((opp) => (
                      <div key={opp.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <DollarSign className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="text-[11px] text-foreground truncate">{opp.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STAGE_CLASSES[opp.stage] ?? "bg-muted text-muted-foreground"}`}>
                            {opp.stage}
                          </span>
                          <span className="text-[11px] font-semibold text-foreground tabular-nums">
                            ${opp.value.toLocaleString("es-MX")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )
      })}
    </>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add components/dashboard/chart-drill-drawer.tsx && git commit -m "feat(drawer): enrich PautasList with contact and opportunity sections"
```

---

### Task 5: Smoke-test in the browser

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 2: Verify the Pautas charts render without errors**

Navigate to the Marketing tab. Confirm "Pautas por Tipo" and "Pautas por Nombre (Top 30)" charts appear.

- [ ] **Step 3: Click a bar on "Pautas por Tipo"**

The drawer should open. For each card, verify:
- Pauta header shows `nombrePauta` + `[tipo]` badge + `createdAt`
- Extra properties (if any) appear as `campo: valor` chips below the date
- Contact section shows name + email + phone (or "Sin contacto asociado" if no link)
- Opportunities section shows opportunity rows or "Sin oportunidades"

- [ ] **Step 4: Click a bar on "Pautas por Nombre (Top 30)"**

Repeat the same verification for that chart.

- [ ] **Step 5: Check the server logs for the association debug line**

In the terminal running `npm run dev`, look for either:
```
[GHL] Pauta associations sample: { ... }
```
or:
```
[GHL] Pauta record has no 'associations' field — contactId will be empty.
```

**If you see the warning** (no associations field): the `contactId` extraction needs adjustment. Open `app/api/dashboard/route.ts`, find `resolveContactIdFromAssociations`, and look at the raw keys logged in the warning. Add a candidate key matching what GHL actually returns, then save and re-test.

- [ ] **Step 6: Commit if all looks good**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add -p && git commit -m "chore: verified pautas drawer enrichment in browser"
```
