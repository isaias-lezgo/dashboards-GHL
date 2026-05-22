# Analizar Contacto con IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Analizar con IA" button to the contact detail drawer that fetches the contact's appointments from GHL and sends all CRM data to Claude Haiku for analysis, displaying the result in a dialog.

**Architecture:** Three-layer change — (1) GHL client gets a new `getOpportunityById` helper that returns calendar events, (2) a new server-side API route `POST /api/analyze-contact` orchestrates the GHL fetch and Claude call, (3) the `DetailDrawer` component gains the button, local state, and result dialog. No new npm dependencies needed.

**Tech Stack:** Next.js 15 App Router, TypeScript, Anthropic SDK (`@anthropic-ai/sdk`), Tailwind CSS, shadcn/ui (`Dialog`), `react-markdown`, `lucide-react`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/ghl-client.ts` | Modify | Add `GHLOpportunityDetail` interface + `getOpportunityById()` |
| `app/api/analyze-contact/route.ts` | Create | POST handler: validate → fetch GHL → call Claude → return analysis |
| `components/dashboard/detail-drawer.tsx` | Modify | Button + state + Dialog with ReactMarkdown |

---

## Task 1: Add `getOpportunityById` to GHL client

**Files:**
- Modify: `lib/ghl-client.ts` (after the `GHLOpportunityDetail` definition, around line 234)

- [ ] **Step 1: Add `GHLOpportunityDetail` interface and `getOpportunityById` function**

Open `lib/ghl-client.ts`. After the closing `}` of `GHLOpportunitiesResponse` (around line 234), add:

```typescript
export interface GHLOpportunityDetail extends GHLOpportunity {
  calendarEvents: GHLCalendarEvent[];
}

export interface GHLOpportunityDetailResponse {
  opportunity: GHLOpportunityDetail;
}

export async function getOpportunityById(id: string): Promise<GHLOpportunityDetail> {
  const resp = await ghlFetch<GHLOpportunityDetailResponse>(
    `/opportunities/${id}`,
    { noQueryLocationId: true }
  );
  return resp.opportunity;
}
```

Note: `GHLCalendarEvent` is already defined in the file (around line 378). `noQueryLocationId: true` prevents appending `?locationId=...` — the opportunity ID already uniquely identifies the resource.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run build 2>&1 | tail -20
```

Expected: build completes (TypeScript errors are ignored per `next.config.mjs`, but no new red errors in the `lib/ghl-client.ts` module)

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE"
git add lib/ghl-client.ts
git commit -m "feat(ghl): add getOpportunityById with calendarEvents"
```

---

## Task 2: Create `POST /api/analyze-contact` route

**Files:**
- Create: `app/api/analyze-contact/route.ts`

- [ ] **Step 1: Create the file with all types, prompt, and handler**

Create `app/api/analyze-contact/route.ts` with this complete content:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getOpportunityById } from "@/lib/ghl-client";

// ─── Request types ────────────────────────────────────────────────────────────

interface ContactPayload {
  name: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  campaign?: string;
  assignedTo?: string;
}

interface OpportunityPayload {
  id: string;
  name: string;
  pipelineName: string;
  stage: string;
  status: string;
  value: number;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
}

interface TaskPayload {
  title: string;
  type: string;
  status: string;
  dueDate?: string;
}

interface CallPayload {
  direction: string;
  status: string;
  durationSeconds: number;
  createdAt: string;
}

interface AnalyzeContactBody {
  opportunityId: string;
  contact: ContactPayload;
  opportunity: OpportunityPayload;
  tasks: TaskPayload[];
  calls: CallPayload[];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un analista de ventas experto en CRM y GoHighLevel. Recibirás el perfil completo de un contacto/lead: información personal, oportunidad de venta, tareas, llamadas y citas. Genera un reporte conciso, accionable y en español.

Tu reporte debe seguir EXACTAMENTE este formato Markdown:

## Perfil del lead
Una o dos oraciones: quién es, de dónde vino (fuente/campaña), en qué etapa del pipeline está y quién lo atiende.

## Calidad del lead
Clasifica como **🔥 Hot**, **☀️ Warm**, o **❄️ Cold** y justifica en una oración. Considera: valor de la oportunidad, etapa del pipeline, fuente, tags, urgencia aparente.

## Estado de la oportunidad
Pipeline, etapa actual, valor monetario, estado (open/won/lost/abandoned). Si está perdida, menciona la razón. Si está ganada, felicita brevemente.

## Citas programadas
Solo incluye esta sección si hay citas. Lista cada cita con: fecha, estado y notas si las hay. Si no hay citas, omite esta sección completamente.

## Tareas pendientes
Solo incluye esta sección si hay tareas con status "pending". Lista título, tipo y fecha de vencimiento. Si no hay tareas pendientes, omite esta sección completamente.

## Próximos pasos sugeridos
1. Acción concreta #1 — qué hacer, cuándo, cómo
2. Acción concreta #2
3. Acción concreta #3

## Señales de alerta
Solo incluye esta sección si detectas: oportunidad estancada sin actividad reciente, lead caliente sin citas agendadas, tareas vencidas, oportunidad de alto valor sin seguimiento. Si todo está en orden, omite esta sección completamente.

Reglas:
- Sé directo y conciso. Nada de relleno corporativo.
- Usa el nombre del contacto cuando te refieras a él.
- Si los datos de llamadas y tareas están vacíos, trabaja con lo que tienes y menciónalo brevemente.
- Fechas en formato legible (dd/mm/yyyy).`;

// ─── Context serializer ───────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-MX");
  } catch {
    return iso;
  }
}

function buildContext(
  body: AnalyzeContactBody,
  calendarEvents: Array<{ title?: string; startTime: string; endTime: string; appointmentStatus?: string; notes?: string }>
): string {
  const { contact, opportunity, tasks, calls } = body;

  const lines: string[] = [];

  // Contact section
  lines.push("=== CONTACTO ===");
  lines.push(`Nombre: ${contact.name}`);
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.phone) lines.push(`Teléfono: ${contact.phone}`);
  if (contact.tags?.length) lines.push(`Tags: ${contact.tags.join(", ")}`);
  if (contact.source) lines.push(`Fuente: ${contact.source}`);
  if (contact.campaign) lines.push(`Campaña: ${contact.campaign}`);
  if (contact.assignedTo) lines.push(`Asignado a: ${contact.assignedTo}`);

  // Opportunity section
  lines.push("\n=== OPORTUNIDAD ===");
  lines.push(`Nombre: ${opportunity.name}`);
  lines.push(`Pipeline: ${opportunity.pipelineName}`);
  lines.push(`Etapa: ${opportunity.stage}`);
  lines.push(`Estado: ${opportunity.status}`);
  lines.push(`Valor: $${opportunity.value.toLocaleString("es-MX")}`);
  if (opportunity.lostReason) lines.push(`Razón de pérdida: ${opportunity.lostReason}`);
  if (opportunity.assignedTo) lines.push(`Asignado a: ${opportunity.assignedTo}`);
  lines.push(`Creada: ${formatDate(opportunity.createdAt)}`);
  lines.push(`Última actualización: ${formatDate(opportunity.updatedAt)}`);

  // Calendar events
  if (calendarEvents.length > 0) {
    lines.push("\n=== CITAS ===");
    for (const ev of calendarEvents) {
      const start = formatDate(ev.startTime);
      const status = ev.appointmentStatus ?? "sin estado";
      const title = ev.title ?? "Cita";
      lines.push(`- ${title} | ${start} | Estado: ${status}${ev.notes ? ` | Notas: ${ev.notes}` : ""}`);
    }
  } else {
    lines.push("\n=== CITAS ===\n(Sin citas registradas)");
  }

  // Tasks
  if (tasks.length > 0) {
    lines.push("\n=== TAREAS ===");
    for (const t of tasks) {
      const due = t.dueDate ? formatDate(t.dueDate) : "sin fecha";
      lines.push(`- [${t.status.toUpperCase()}] ${t.title} | Tipo: ${t.type} | Vence: ${due}`);
    }
  } else {
    lines.push("\n=== TAREAS ===\n(Sin tareas registradas)");
  }

  // Calls
  if (calls.length > 0) {
    lines.push("\n=== LLAMADAS ===");
    for (const c of calls) {
      const mins = Math.floor(c.durationSeconds / 60);
      const secs = c.durationSeconds % 60;
      const dur = c.status === "completed" ? `${mins}:${String(secs).padStart(2, "0")}` : "no contestada";
      lines.push(`- ${formatDate(c.createdAt)} | ${c.direction} | ${c.status} | ${dur}`);
    }
  } else {
    lines.push("\n=== LLAMADAS ===\n(Sin llamadas registradas)");
  }

  return lines.join("\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no está configurada en el servidor" },
      { status: 500 }
    );
  }

  let body: AnalyzeContactBody;
  try {
    body = (await req.json()) as AnalyzeContactBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo de petición inválido" }, { status: 400 });
  }

  if (!body.opportunityId || !body.contact?.name || !body.opportunity?.id) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: opportunityId, contact.name, opportunity.id" },
      { status: 400 }
    );
  }

  // Fetch calendar events from GHL — failures are non-fatal
  let calendarEvents: Array<{ title?: string; startTime: string; endTime: string; appointmentStatus?: string; notes?: string }> = [];
  try {
    const oppDetail = await getOpportunityById(body.opportunityId);
    calendarEvents = oppDetail.calendarEvents ?? [];
  } catch (err) {
    console.warn("[analyze-contact] Could not fetch opportunity detail for calendar events:", err);
  }

  const contextText = buildContext(body, calendarEvents);
  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Analiza el siguiente perfil de contacto del CRM:\n\n${contextText}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    return NextResponse.json({
      analysis: textBlock?.text ?? "No se pudo generar el análisis.",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "API key de Anthropic inválida" }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Límite de tasa alcanzado, intenta de nuevo en un momento" },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[analyze-contact] Anthropic API error:", error.status, error.message);
      return NextResponse.json(
        { error: `Error de Anthropic API: ${error.message}` },
        { status: 502 }
      );
    }
    console.error("[analyze-contact] Unknown error:", error);
    return NextResponse.json({ error: "Error desconocido al generar el análisis" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run build 2>&1 | tail -20
```

Expected: build completes without new errors related to `app/api/analyze-contact/route.ts`

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE"
git add app/api/analyze-contact/route.ts
git commit -m "feat(api): add POST /api/analyze-contact endpoint"
```

---

## Task 3: Update `DetailDrawer` — button + dialog

**Files:**
- Modify: `components/dashboard/detail-drawer.tsx`

- [ ] **Step 1: Add missing imports**

At the top of `components/dashboard/detail-drawer.tsx`, the existing imports block starts with:
```typescript
import { useState } from "react"
```

Replace that first import line and add the new ones so the imports section reads:

```typescript
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Opportunity, Contact, Task, Call } from "@/lib/types"
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Calendar,
  DollarSign,
  User,
  ExternalLink,
  Sparkles,
  Loader2,
} from "lucide-react"
```

Note: `CheckCircle2` was already imported but unused — leave it to avoid a diff noise commit.

- [ ] **Step 2: Add analysis state variables inside `DetailDrawer`**

Inside the `DetailDrawer` function, after the existing `const [taskFilter, ...]` line:

```typescript
const [taskFilter, setTaskFilter] = useState<"all" | "open" | "completed">("all")
const [isAnalyzing, setIsAnalyzing] = useState(false)
const [analysisResult, setAnalysisResult] = useState<string | null>(null)
const [analysisError, setAnalysisError] = useState<string | null>(null)
const [analysisOpen, setAnalysisOpen] = useState(false)
```

- [ ] **Step 3: Add `handleAnalyze` function**

After the state declarations and before the early-return `if (!opportunity)` guard, add:

```typescript
async function handleAnalyze() {
  if (!opportunity || !contact) return
  setIsAnalyzing(true)
  setAnalysisError(null)
  try {
    const res = await fetch("/api/analyze-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunityId: opportunity.id,
        contact: {
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          tags: contact.tags,
          source: contact.source,
          campaign: contact.campaign,
          assignedTo: contact.assignedTo,
        },
        opportunity: {
          id: opportunity.id,
          name: opportunity.name,
          pipelineName: opportunity.pipelineName,
          stage: opportunity.stage,
          status: opportunity.status,
          value: opportunity.value,
          lostReason: opportunity.lostReason,
          createdAt: opportunity.createdAt,
          updatedAt: opportunity.updatedAt,
          assignedTo: opportunity.assignedTo,
        },
        tasks: oppTasks.map((t) => ({
          title: t.title,
          type: t.type,
          status: t.status,
          dueDate: t.dueDate,
        })),
        calls: contactCalls.map((c) => ({
          direction: c.direction,
          status: c.status,
          durationSeconds: c.durationSeconds,
          createdAt: c.createdAt,
        })),
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setAnalysisError(data.error ?? "Error desconocido")
    } else {
      setAnalysisResult(data.analysis)
    }
    setAnalysisOpen(true)
  } catch {
    setAnalysisError("No se pudo conectar con el servidor de análisis.")
    setAnalysisOpen(true)
  } finally {
    setIsAnalyzing(false)
  }
}
```

Important: `handleAnalyze` uses `opportunity`, `contact`, `oppTasks`, and `contactCalls` — these are all defined later in the function body. Move this function definition to **after** those variables are computed (after the `filteredTasks` and `timelineItems` definitions, just before the `return` statement).

- [ ] **Step 4: Add the "Analizar con IA" button in the header**

Locate the existing button group in the JSX (around line 174 in the original file):

```tsx
{locationId && (
  <div className="mt-3 flex flex-wrap gap-2">
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1.5"
    >
      <a
        href={`https://login.lezgosuite.com/v2/location/${locationId}/opportunities/${opportunity.id}?tab=Opportunity+Details`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink className="h-3 w-3" />
        Ver oportunidad
      </a>
    </Button>
    {contact && (
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
      >
        <a
          href={`https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-3 w-3" />
          Ver contacto
        </a>
      </Button>
    )}
  </div>
)}
```

Replace it with:

```tsx
{locationId && (
  <div className="mt-3 flex flex-wrap gap-2">
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1.5"
    >
      <a
        href={`https://login.lezgosuite.com/v2/location/${locationId}/opportunities/${opportunity.id}?tab=Opportunity+Details`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink className="h-3 w-3" />
        Ver oportunidad
      </a>
    </Button>
    {contact && (
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
      >
        <a
          href={`https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-3 w-3" />
          Ver contacto
        </a>
      </Button>
    )}
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1.5"
      onClick={handleAnalyze}
      disabled={isAnalyzing}
    >
      {isAnalyzing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {isAnalyzing ? "Analizando…" : "Analizar con IA"}
    </Button>
  </div>
)}
```

- [ ] **Step 5: Add the analysis Dialog**

At the very end of the component's JSX, just before the closing `</Sheet>` tag (after `</Tabs>` and before `</SheetContent>`), add:

```tsx
      <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              Análisis IA — {contact?.name ?? "Contacto"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Generado por Claude · Basado en datos del CRM y citas
            </DialogDescription>
          </DialogHeader>
          {analysisError ? (
            <p className="text-sm text-destructive mt-2">{analysisError}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
              <ReactMarkdown>{analysisResult ?? ""}</ReactMarkdown>
            </div>
          )}
        </DialogContent>
      </Dialog>
```

Place this block right before `</SheetContent>` and after `</Tabs>`.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run build 2>&1 | tail -20
```

Expected: build completes without new errors in `components/dashboard/detail-drawer.tsx`.

- [ ] **Step 7: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE"
git add components/dashboard/detail-drawer.tsx
git commit -m "feat(ui): add Analizar con IA button and dialog to DetailDrawer"
```

---

## Task 4: Manual end-to-end verification

**Files:** None — browser testing only

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run dev
```

Open http://localhost:3000

- [ ] **Step 2: Open the Sales tab and click a row to open the DetailDrawer**

Verify the "Analizar con IA" button appears in the header next to the external link buttons.

- [ ] **Step 3: Click "Analizar con IA"**

Expected sequence:
1. Button shows spinner + "Analizando…" and becomes disabled
2. After 3–8 seconds, a Dialog opens
3. Dialog title: "Análisis IA — {nombre del contacto}"
4. Body: formatted Markdown with sections (## Perfil del lead, ## Calidad del lead, etc.)
5. Sections "Citas programadas" and "Tareas pendientes" appear only if there is data

- [ ] **Step 4: Verify error handling**

If the server returns an error (e.g., temporarily remove `ANTHROPIC_API_KEY` from `.env.local`):
- Button should re-enable
- Dialog should open with the error message in red
- App should not crash

- [ ] **Step 5: Verify the Dialog can be re-opened**

After closing the dialog, click the button again — it should call the API again and show a fresh analysis.

---

## Summary of changes

| File | Change |
|---|---|
| `lib/ghl-client.ts` | +`GHLOpportunityDetail`, +`GHLOpportunityDetailResponse`, +`getOpportunityById` |
| `app/api/analyze-contact/route.ts` | New file — full POST handler |
| `components/dashboard/detail-drawer.tsx` | +2 imports (`ReactMarkdown`, `Dialog*`, `Sparkles`, `Loader2`), +4 state vars, +`handleAnalyze`, +button, +Dialog |
