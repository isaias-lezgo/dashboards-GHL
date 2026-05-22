# Leads por Tipo de Anuncio — Mini Donut + Bar Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current standalone donut PieChart with a side-by-side layout: compact donut (left) + ranked bar breakdown list (right), with drill-down on each row.

**Architecture:** Single-file change to `components/dashboard/marketing-dashboard.tsx`. Swap state variable, remove `renderActiveShape`, and replace the card's JSX block. No new files, no data changes.

**Tech Stack:** React, Recharts (`PieChart`, `Pie`, `Sector`, `Cell`), Tailwind CSS

---

### Task 1: Refactor state and remove renderActiveShape

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx:112-124`

- [ ] **Step 1: Remove `renderActiveShape` and rename state**

Replace lines 112–124 (the `renderActiveShape` function and the `activePieIndex` state) with the following. Delete the function entirely and rename the state:

```tsx
// DELETE the entire renderActiveShape function block (lines 112-120):
// function renderActiveShape(props: any) { ... }

// On line 124, change:
//   const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined)
// To:
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)
```

After the edit, lines 112–124 should look like:

```tsx
const iconCls = "h-4 w-4 shrink-0 text-muted-foreground"

export function MarketingDashboard({ opportunities, contacts, pautas, tasks = [], calls = [] }: MarketingDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)
```

- [ ] **Step 2: Remove `Tooltip` from recharts imports (line 15)**

`Tooltip` is imported from `recharts` at line 15 and is only used in the pie chart block we're replacing. Remove it.

```tsx
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Legend,
  PieChart,
  Pie,
  Sector,
} from "recharts"
```

(`Sector` stays — it's used in the new `activeShape` inline prop.)

- [ ] **Step 3: Verify the file compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors referencing `activePieIndex`, `renderActiveShape`, or `Tooltip`.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "refactor(marketing): rename activePieIndex→hoveredAdType, remove renderActiveShape"
```

---

### Task 2: Replace the donut card JSX

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx:513-566`

- [ ] **Step 1: Replace the entire card content block**

Find the comment `{/* 6. Leads por Tipo de Anuncio (donut) */}` at line 513. Replace everything from the opening `<Card>` to its closing `</Card>` (lines 514–566) with the following:

```tsx
        {/* 6. Leads por Tipo de Anuncio — donut + bar breakdown */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Tag className={iconCls} />
            <CardTitle className="text-sm font-semibold">Leads por Tipo de Anuncio</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            {leadsByAdType.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de tipo de anuncio.
              </div>
            ) : (() => {
              const total = leadsByAdType.reduce((s, e) => s + e.value, 0)
              const maxVal = leadsByAdType[0].value
              return (
                <div className="flex items-center gap-4">
                  {/* Left: compact donut with absolutely-positioned center label */}
                  <div style={{ width: 160, height: 200, flexShrink: 0, position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leadsByAdType}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={72}
                          dataKey="value"
                          nameKey="adType"
                          startAngle={90}
                          endAngle={-270}
                          activeIndex={hoveredAdType}
                          activeShape={(props: any) => (
                            <Sector
                              cx={props.cx}
                              cy={props.cy}
                              innerRadius={props.innerRadius}
                              outerRadius={props.outerRadius + 5}
                              startAngle={props.startAngle}
                              endAngle={props.endAngle}
                              fill={props.fill}
                            />
                          )}
                        >
                          {leadsByAdType.map((entry) => (
                            <Cell key={entry.adType} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center text overlay — absolute positioning is more reliable than SVG text children in Recharts */}
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        textAlign: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div style={{ color: "white", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{total}</div>
                      <div style={{ color: "#6b7280", fontSize: 9, marginTop: 2 }}>LEADS</div>
                    </div>
                  </div>

                  {/* Right: ranked bar list */}
                  <div className="flex flex-1 flex-col gap-y-2.5 overflow-y-auto">
                    {leadsByAdType.map((entry, i) => {
                      const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                      const barWidth = maxVal > 0 ? (entry.value / maxVal) * 100 : 0
                      const label = entry.adType.length > 18 ? entry.adType.slice(0, 18) + "…" : entry.adType
                      return (
                        <div
                          key={entry.adType}
                          className="cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-accent/20 transition-colors"
                          onClick={() =>
                            openDrill(
                              `Tipo de Anuncio: ${entry.adType}`,
                              opportunities.filter((o) => (o.adType || "Otro") === entry.adType)
                            )
                          }
                          onMouseEnter={() => setHoveredAdType(i)}
                          onMouseLeave={() => setHoveredAdType(undefined)}
                        >
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-xs text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground tabular-nums ml-2 shrink-0">
                              {entry.value} · {pct}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded bg-[#1f2937] overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{ width: `${barWidth}%`, backgroundColor: entry.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Haz clic en una fila para ver los leads
            </p>
          </CardContent>
        </Card>
```

- [ ] **Step 2: Check the dev server renders correctly**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run dev
```

Open `http://localhost:3000`, switch to Marketing tab. Verify:
- Donut ring visible on the left with total count centered
- Ranked list on the right with color-matched bars
- Hovering a row highlights (expands) the corresponding donut segment
- Clicking a row opens the drill drawer filtered to that ad type
- No white-background tooltip visible

- [ ] **Step 3: Build check**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run build 2>&1 | tail -20
```

Expected: build completes, no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing): replace donut chart with mini donut + bar breakdown"
```
