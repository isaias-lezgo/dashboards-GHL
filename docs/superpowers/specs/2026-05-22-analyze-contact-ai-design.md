# Diseño: Botón "Analizar contacto con IA" en el Drawer de Contacto

**Fecha:** 2026-05-22  
**Autor:** Isaias + Claude  
**Estado:** Aprobado

---

## Resumen

Agregar un botón "Analizar con IA" en el header del `DetailDrawer` que, al hacer clic, realiza un análisis completo del contacto usando Claude Haiku y muestra el resultado en un Dialog con Markdown.

Los datos analizados son: contacto, oportunidad, tareas, llamadas **y citas** (calendar events). Las citas se obtienen on-demand de GHL (`/opportunities/:id`) al momento del clic.

---

## Alcance

**Incluye:**
- Botón "Analizar con IA" en el header del `DetailDrawer`
- Nuevo endpoint `POST /api/analyze-contact`
- Nueva función `getOpportunityById()` en `lib/ghl-client.ts`
- Dialog con resultado renderizado como ReactMarkdown
- Estados: loading, success, error

**Excluye:**
- Mensajes/conversaciones (no se incluyen en el análisis)
- Persistencia del análisis (no se guarda en ningún lado)
- Análisis en batch de múltiples contactos

---

## Arquitectura

### Flujo de datos

```
[DetailDrawer] usuario clic "Analizar con IA"
    ↓ estado: loading
POST /api/analyze-contact
    body: { opportunityId, contact, opportunity, tasks, calls }
        ↓ server-side
    ghlFetch GET /opportunities/{opportunityId}
        → extrae calendarEvents[]
        ↓
    Anthropic Claude Haiku
        system: CONTACT_ANALYSIS_PROMPT (cached)
        user: contexto serializado del contacto
        ↓
    { analysis: "##Resumen...", usage: {...} }
        ↓ client
[Dialog] abre con ReactMarkdown(analysis)
```

### Archivos modificados/creados

| Archivo | Tipo | Descripción |
|---|---|---|
| `app/api/analyze-contact/route.ts` | **Nuevo** | Endpoint POST que orquesta GHL fetch + Claude |
| `lib/ghl-client.ts` | **Modificar** | Añadir `getOpportunityById(id)` |
| `components/dashboard/detail-drawer.tsx` | **Modificar** | Botón + Dialog + estado de análisis |

---

## API Contract

### Request
```
POST /api/analyze-contact
Content-Type: application/json
```

```json
{
  "opportunityId": "string",
  "contact": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "tags": ["string"],
    "source": "string",
    "campaign": "string",
    "assignedTo": "string"
  },
  "opportunity": {
    "id": "string",
    "name": "string",
    "pipelineName": "string",
    "stage": "string",
    "status": "open | won | lost | abandoned",
    "value": 0,
    "lostReason": "string",
    "createdAt": "string",
    "updatedAt": "string",
    "assignedTo": "string"
  },
  "tasks": [
    {
      "title": "string",
      "type": "call | email | followup | other",
      "status": "pending | completed",
      "dueDate": "string"
    }
  ],
  "calls": [
    {
      "direction": "inbound | outbound",
      "status": "completed | missed | no-answer",
      "durationSeconds": 0,
      "createdAt": "string"
    }
  ]
}
```

### Response (200)
```json
{
  "analysis": "## Perfil del lead\n...",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "cacheReadTokens": 0,
    "cacheCreationTokens": 0
  }
}
```

### Response (error)
```json
{ "error": "mensaje descriptivo en español" }
```

**Códigos de error:** 400 (validación), 500 (API key), 429 (rate limit), 502 (Anthropic error)

---

## GHL Client: `getOpportunityById`

```typescript
// GET /opportunities/:id
// Returns opportunity object including calendarEvents[]
export async function getOpportunityById(id: string): Promise<GHLOpportunityDetail>
```

`GHLOpportunityDetail` incluye los campos ya existentes en `GHLOpportunity` más:
- `calendarEvents: GHLCalendarEvent[]` — citas vinculadas a esta oportunidad

---

## Prompt del sistema (Claude)

El prompt se llama `CONTACT_ANALYSIS_SYSTEM_PROMPT` y usa `cache_control: { type: "ephemeral" }`.

**Instrucciones al modelo:**
- Analista de ventas experto en CRM
- Responde en español
- Usa el nombre del contacto
- Sé directo, sin relleno

**Secciones de salida (Markdown):**

```markdown
## Perfil del lead
Una o dos oraciones: quién es, de dónde vino, en qué etapa está.

## Calidad del lead
**🔥 Hot** / **☀️ Warm** / **❄️ Cold** + justificación en una oración.
Considera: valor de oportunidad, etapa del pipeline, fuente, tags, urgencia.

## Estado de la oportunidad
Pipeline, etapa, valor, asignado, estado. Si está perdida, mencionar la razón.

## Citas programadas
Solo si hay citas. Lista con fecha, estado, notas. Si no hay, omitir sección.

## Tareas pendientes
Solo si hay tareas pendientes. Lista con título, tipo, fecha de vencimiento.

## Próximos pasos sugeridos
1. Acción concreta #1 (qué, cuándo, cómo)
2. Acción concreta #2
3. Acción concreta #3

## Señales de alerta
Solo si hay: oportunidad estancada, sin citas agendadas para lead caliente,
tareas vencidas, lead sin seguimiento reciente. Si todo está bien, omitir.
```

---

## UI: DetailDrawer

### Botón

Ubicación: header del drawer, en el mismo `div` que los botones "Ver oportunidad" y "Ver contacto".

```tsx
<Button
  variant="outline"
  size="sm"
  className="h-7 text-xs gap-1.5"
  onClick={handleAnalyze}
  disabled={isAnalyzing}
>
  {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
  {isAnalyzing ? "Analizando…" : "Analizar con IA"}
</Button>
```

- Solo visible cuando `locationId` está disponible (misma condición que los otros botones)
- `disabled` mientras `isAnalyzing === true`

### Estado local

```typescript
const [isAnalyzing, setIsAnalyzing] = useState(false)
const [analysisResult, setAnalysisResult] = useState<string | null>(null)
const [analysisError, setAnalysisError] = useState<string | null>(null)
const [analysisOpen, setAnalysisOpen] = useState(false)
```

### Dialog

```tsx
<Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
  <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        Análisis IA — {contact?.name}
      </DialogTitle>
      <DialogDescription>Generado por Claude · Basado en CRM y citas</DialogDescription>
    </DialogHeader>
    {analysisError ? (
      <p className="text-sm text-destructive">{analysisError}</p>
    ) : (
      <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
        {analysisResult ?? ""}
      </ReactMarkdown>
    )}
  </DialogContent>
</Dialog>
```

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| GHL fetch falla | El análisis continúa sin citas; el servidor lo indica en el contexto |
| API key no configurada | Error 500 → mensaje en el dialog |
| Rate limit Anthropic | Error 429 → mensaje en el dialog |
| Oportunidad no encontrada | Error 400 → mensaje en el dialog |

---

## Dependencias nuevas

- `react-markdown` — ya usada en `conversations-dashboard.tsx`, no es nueva
- `Sparkles`, `Loader2` de `lucide-react` — `Loader2` ya importada en el proyecto; `Sparkles` ya existe en `conversations-dashboard.tsx`

No se requieren nuevas dependencias npm.
