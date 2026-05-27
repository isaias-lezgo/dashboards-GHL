# Marketing Dashboard Panels 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new chart panels to the Marketing Dashboard — Leads by Ad ID, Leads by Landing URL, Paid Traffic Leads with Appointment, and Won Deals from Paid Traffic.

**Architecture:** All data is already fetched server-side. Tasks 1–2 plumb two new attribution fields (`adId`, `attributionUrl`) through the type system and API transform. Task 3 adds all four chart panels to `marketing-dashboard.tsx` using those fields plus the existing `appointments` prop.

**Tech Stack:** Next.js 15 App Router, TypeScript, Recharts via shadcn chart wrapper, Tailwind CSS v3.

---

## File Map

| File | Change |
|------|--------|
| `lib/types.ts` | Add `adId?: string` and `attributionUrl?: string` to `Contact` and `Opportunity` |
| `app/api/dashboard/route.ts` | Extract `utmAdId` → `adId` and `url` → `attributionUrl` in `transformContact` / `transformOpportunity`; widen `Attribution` type; propagate to opp enrichment |
| `components/dashboard/marketing-dashboard.tsx` | Add `isPaidTraffic`, four `useMemo` datasets, four chart cards |

---

### Task 1: Extend types with `adId` and `attributionUrl`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the two fields to `Contact`**

In `lib/types.ts`, find the `Contact` interface. After the existing `adType?: string` line (currently line 51), add:

```ts
  adId?: string
  attributionUrl?: string
```

Result (lines 49–53 of the file):
```ts
  // Computed attribution (derived from attributions array)
  source?: string
  campaign?: string
  adType?: string
  adId?: string
  attributionUrl?: string
```

- [ ] **Step 2: Add the two fields to `Opportunity`**

In `lib/types.ts`, find the `Opportunity` interface. After the existing `adType?: string` line (currently line 101), add:

```ts
  adId?: string
  attributionUrl?: string
```

Result (lines 98–103):
```ts
  // Computed attribution (derived from attributions array)
  campaign?: string
  adType?: string
  adId?: string
  attributionUrl?: string
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/isaiasrios/Software/DASHBOARDS_GHL_CLAUDE && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors (existing errors from `next.config.mjs` `ignoreBuildErrors` are fine; we just want no new type errors introduced by our additions).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add adId and attributionUrl attribution fields"
```

---

### Task 2: Extract `adId` and `attributionUrl` in the API route transform

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Widen the `Attribution` type**

In `app/api/dashboard/route.ts`, find the `Attribution` type definition (around line 32). Add `utmAdId` and `url`:

```ts
type Attribution = {
  isFirst?: boolean;
  utmCampaign?: string;
  utmContent?: string;
  utmMedium?: string;
  utmSource?: string;
  utmSessionSource?: string;
  adSource?: string;
  medium?: string;
  utmAdId?: string;
  url?: string;
  [key: string]: unknown;
};
```

- [ ] **Step 2: Extract `adId` and `attributionUrl` in `transformContact`**

In `app/api/dashboard/route.ts`, find `transformContact` (around line 71). The current return object ends with `adType: ...`. Extend it to also set `adId` and `attributionUrl`:

Replace this block inside the return:
```ts
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
```

With:
```ts
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    adId: firstAttr(ghl.attributions)?.utmAdId || undefined,
    attributionUrl: firstAttr(ghl.attributions)?.url || ghl.attributionSource?.url || undefined,
```

- [ ] **Step 3: Extract `adId` and `attributionUrl` in `transformOpportunity`**

In `app/api/dashboard/route.ts`, find `transformOpportunity` (around line 90). Same pattern — after the `adType` line in the return object:

Replace:
```ts
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
```

With:
```ts
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    adId: firstAttr(ghl.attributions)?.utmAdId || undefined,
    attributionUrl: firstAttr(ghl.attributions)?.url || undefined,
```

- [ ] **Step 4: Propagate `adId` and `attributionUrl` during opportunity enrichment**

In `app/api/dashboard/route.ts`, find the opportunity enrichment loop (around line 331):

```ts
        for (const opp of opportunities) {
          const contact = contactById.get(opp.contactId);
          if (contact) {
            if (!opp.campaign) opp.campaign = contact.campaign;
            if (!opp.adType) opp.adType = contact.adType;
            if (!opp.source) opp.source = contact.source;
          }
```

Add two lines after `if (!opp.source) ...`:
```ts
            if (!opp.adId) opp.adId = contact.adId;
            if (!opp.attributionUrl) opp.attributionUrl = contact.attributionUrl;
```

So the block becomes:
```ts
        for (const opp of opportunities) {
          const contact = contactById.get(opp.contactId);
          if (contact) {
            if (!opp.campaign) opp.campaign = contact.campaign;
            if (!opp.adType) opp.adType = contact.adType;
            if (!opp.source) opp.source = contact.source;
            if (!opp.adId) opp.adId = contact.adId;
            if (!opp.attributionUrl) opp.attributionUrl = contact.attributionUrl;
          }
```

- [ ] **Step 5: Also update the synthesized-contact block to copy these fields**

In `app/api/dashboard/route.ts`, find the synthesized contact block (around line 299). The `synth: Contact` object currently includes `source`, `campaign`, `adType`. Add `adId` and `attributionUrl`:

```ts
          const synth: Contact = {
            id: embedded.id,
            name:
              embedded.name?.trim() ||
              embedded.email ||
              embedded.phone ||
              "Sin nombre",
            email: embedded.email ?? "",
            phone: embedded.phone ?? "",
            tags: embedded.tags ?? [],
            dateAdded: raw.createdAt,
            createdAt: raw.createdAt,
            source: attr?.utmSource || attr?.adSource || raw.source || "direct",
            campaign: buildCampaignLabel(attr?.utmContent, attr?.utmCampaign),
            adType: attr?.utmMedium || attr?.utmSessionSource,
            adId: attr?.utmAdId || undefined,
            attributionUrl: attr?.url || undefined,
            assignedTo:
              raw.assignedTo && userMap.has(raw.assignedTo)
                ? userMap.get(raw.assignedTo)
                : raw.assignedTo,
          };
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/isaiasrios/Software/DASHBOARDS_GHL_CLAUDE && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat(api): extract adId and attributionUrl from GHL attributions"
```

---

### Task 3: Add four chart panels to the Marketing Dashboard

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

This task adds all four panels in one file. Work top-to-bottom: constants → helpers → useMemo data → JSX.

#### Step 1 — Add `isPaidTraffic` helper

- [ ] In `marketing-dashboard.tsx`, find the existing `isPaidSocial` function (around line 101). Add a new `isPaidTraffic` function directly below it:

```ts
const PAID_SEARCH_SOURCES = ["google", "bing", "yahoo", "baidu", "duckduckgo"]
const PAID_SEARCH_MEDIUMS = ["cpc", "ppc", "paid_search", "paidsearch", "google_ads", "sem"]

function isPaidTraffic(opp: Opportunity): boolean {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  return (
    PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) ||
    PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m)) ||
    PAID_SEARCH_SOURCES.some((s) => src.includes(s)) ||
    PAID_SEARCH_MEDIUMS.some((m) => med.includes(m))
  )
}
```

#### Step 2 — Add four `useMemo` datasets inside `MarketingDashboard`

- [ ] In `marketing-dashboard.tsx`, find the `paidSocialLeadCount` useMemo near the end of the data section (around line 456). Add four new useMemos directly below it:

```ts
  // Panel 2 — Leads by Ad ID
  const leadsByAdId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.adId || "Sin ID"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([adId, count]) => ({ adId, count }))
  }, [opportunities])

  // Panel 3 — Leads by Landing URL
  const leadsByUrl = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.attributionUrl || "Sin URL"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([url, count]) => ({ url, count }))
  }, [opportunities])

  // Panel 4a — Paid Traffic leads with at least one appointment
  const paidTrafficWithAppt = useMemo(() => {
    const apptContactIds = new Set(appointments.map((a) => a.contactId))
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o)) continue
      if (!apptContactIds.has(o.contactId)) continue
      const key = o.source || "Desconocido"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count }))
  }, [opportunities, appointments])

  // Panel 4b — Won deals from paid traffic, grouped by source
  const wonPaidTraffic = useMemo(() => {
    const counts = new Map<string, { count: number; value: number }>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o) || o.status !== "won") continue
      const key = o.source || "Desconocido"
      const prev = counts.get(key) ?? { count: 0, value: 0 }
      counts.set(key, { count: prev.count + 1, value: prev.value + o.value })
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([source, { count, value }]) => ({ source, count, value }))
  }, [opportunities])
```

#### Step 3 — Add the four chart cards to JSX

- [ ] In `marketing-dashboard.tsx`, find the closing `</DashboardShell>` tag (last line before the return closes, around line 895). Insert the four new `<DashboardCard>` blocks BEFORE the `<ChartDrillDrawer .../>` component.

Also add the `TrendingUp` icon import — find the existing Lucide import line (around line 22):

```ts
import { Tag, FileText, Calendar, BarChart3, Layers } from "lucide-react"
```

Change it to:

```ts
import { Tag, FileText, Calendar, BarChart3, Layers, TrendingUp } from "lucide-react"
```

Then add the four cards. Insert after the last `</DashboardCard>` (the "Pautas por Etapa" card ends around line 884) and before `<ChartDrillDrawer`:

```tsx
      {/* Panel 2 — Leads por ID de Anuncio */}
      {/* Panel 3 — Leads por URL de Aterrizaje */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader
            title="Leads por ID de Anuncio (Top 15)"
            total={leadsByAdId.reduce((s, e) => s + e.count, 0)}
            icon={Tag}
          />
          <ChartCardContent>
            {leadsByAdId.length === 0 ? (
              <ChartEmpty message="Sin datos de ID de anuncio." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Leads", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: Math.max(220, leadsByAdId.length * 44 + 20) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={leadsByAdId}
                      margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="adId"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        width={140}
                        tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v}
                      />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_, p) => p?.[0]?.payload?.adId ?? String(_)}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Leads"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) =>
                          openDrill(
                            `Ad ID: ${data.adId}`,
                            opportunities.filter((o) => (o.adId || "Sin ID") === data.adId)
                          )
                        }
                      >
                        {leadsByAdId.map((entry, i) => (
                          <Cell key={entry.adId} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Haz clic en una barra para ver los leads</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader
            title="Leads por URL de Aterrizaje (Top 15)"
            total={leadsByUrl.reduce((s, e) => s + e.count, 0)}
            icon={BarChart3}
          />
          <ChartCardContent>
            {leadsByUrl.length === 0 ? (
              <ChartEmpty message="Sin datos de URL de aterrizaje." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Leads", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: Math.max(220, leadsByUrl.length * 44 + 20) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={leadsByUrl}
                      margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="url"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        width={160}
                        tickFormatter={(v: string) => {
                          try {
                            const u = new URL(v)
                            const slug = u.pathname.replace(/\/$/, "").split("/").pop() || u.hostname
                            return slug.length > 22 ? slug.slice(0, 22) + "…" : slug
                          } catch {
                            return v.length > 22 ? v.slice(0, 22) + "…" : v
                          }
                        }}
                      />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_, p) => p?.[0]?.payload?.url ?? String(_)}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Leads"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) =>
                          openDrill(
                            `URL: ${data.url}`,
                            opportunities.filter((o) => (o.attributionUrl || "Sin URL") === data.url)
                          )
                        }
                      >
                        {leadsByUrl.map((entry, i) => (
                          <Cell key={entry.url} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Haz clic en una barra para ver los leads · URL completa en el tooltip</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      {/* Panel 4a — Tráfico Pagado con Cita */}
      {/* Panel 4b — Deals Ganados de Tráfico Pagado */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader
            title="Leads de Tráfico Pagado con Cita"
            total={paidTrafficWithAppt.reduce((s, e) => s + e.count, 0)}
            icon={Calendar}
          />
          <ChartCardContent>
            {paidTrafficWithAppt.length === 0 ? (
              <ChartEmpty message="Sin leads de tráfico pagado con cita." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Con cita", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: Math.max(220, paidTrafficWithAppt.length * 44 + 20) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={paidTrafficWithAppt}
                      margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="source"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        width={130}
                        tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + "…" : v}
                      />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_, p) => p?.[0]?.payload?.source ?? String(_)}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Con cita"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const apptContactIds = new Set(appointments.map((a) => a.contactId))
                          openDrill(
                            `Tráfico pagado con cita: ${data.source}`,
                            opportunities.filter(
                              (o) =>
                                isPaidTraffic(o) &&
                                (o.source || "Desconocido") === data.source &&
                                apptContactIds.has(o.contactId)
                            )
                          )
                        }}
                      >
                        {paidTrafficWithAppt.map((entry, i) => (
                          <Cell key={entry.source} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Leads de paid social + paid search que tienen al menos una cita agendada</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader
            title="Deals Ganados de Tráfico Pagado"
            total={wonPaidTraffic.reduce((s, e) => s + e.count, 0)}
            icon={TrendingUp}
          />
          <ChartCardContent>
            {wonPaidTraffic.length === 0 ? (
              <ChartEmpty message="Sin deals ganados de tráfico pagado." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Ganados", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: Math.max(220, wonPaidTraffic.length * 44 + 20) }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={wonPaidTraffic}
                      margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="source"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        width={130}
                        tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + "…" : v}
                      />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_, p) => {
                              const entry = p?.[0]?.payload
                              if (!entry) return String(_)
                              const val = entry.value as number
                              return val > 0
                                ? `${entry.source} · $${val.toLocaleString("es-MX")}`
                                : entry.source
                            }}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Ganados"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) =>
                          openDrill(
                            `Ganados de tráfico pagado: ${data.source}`,
                            opportunities.filter(
                              (o) =>
                                isPaidTraffic(o) &&
                                o.status === "won" &&
                                (o.source || "Desconocido") === data.source
                            )
                          )
                        }
                      >
                        {wonPaidTraffic.map((entry, i) => (
                          <Cell key={entry.source} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Oportunidades ganadas (won) de paid social + paid search · tooltip muestra valor total</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/isaiasrios/Software/DASHBOARDS_GHL_CLAUDE && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 5: Start dev server and verify all four panels render**

```bash
cd /Users/isaiasrios/Software/DASHBOARDS_GHL_CLAUDE && npm run dev
```

Open `http://localhost:3000` → switch to Marketing tab. Verify:
1. Two new chart cards appear in a 2-column row: "Leads por ID de Anuncio" and "Leads por URL de Aterrizaje"
2. Two more chart cards appear below: "Leads de Tráfico Pagado con Cita" and "Deals Ganados de Tráfico Pagado"
3. Empty state messages appear if live data has no matching records (that is correct behavior)
4. Clicking a bar in any of the four new charts opens the drill-down drawer with the correct opportunities

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing): add Leads by Ad ID, URL, Paid Traffic panels"
```

---

## Self-Review

### Spec coverage
- Panel 2 (Leads by Ad ID) ✅ — Task 1+2 add `adId`, Task 3 adds chart
- Panel 3 (Leads by URL) ✅ — Task 1+2 add `attributionUrl`, Task 3 adds chart
- Panel 4a (Paid Social with appointment) ✅ — Task 3 adds `paidTrafficWithAppt` and card
- Panel 4b (Closed deals from paid traffic) ✅ — Task 3 adds `wonPaidTraffic` and card
- Paid search included ✅ — `isPaidTraffic` covers both social and search sources/mediums
- Drill-down drawer on all four panels ✅ — `openDrill` called in each `onClick`
- `NonZeroTooltipContent` used in all tooltips ✅

### Placeholder scan
No TBD, TODO, or vague instructions found.

### Type consistency
- `adId` used consistently across types.ts, route.ts, and marketing-dashboard.tsx
- `attributionUrl` used consistently across all three files
- `isPaidTraffic` defined in Task 3 Step 1 and called in Steps 2 and 3 JSX onClick handlers
- `PAID_SEARCH_SOURCES` / `PAID_SEARCH_MEDIUMS` defined at module level before use
