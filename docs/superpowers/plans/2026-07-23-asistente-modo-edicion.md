# Asistente IA — Modo edición (custom fields) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al Asistente IA la capacidad de editar custom fields de GoHighLevel (valores en contactos/oportunidades y definiciones de campo), con un toggle que habilita las herramientas de escritura y una tarjeta de confirmación obligatoria antes de cada mutación.

**Architecture:** El toggle decide si el servidor envía las herramientas de escritura al modelo. Cuando el modelo emite una herramienta de escritura, una puerta en el loop del agente (`use-agent-loop.ts`) la intercepta antes de ejecutarla, muestra una tarjeta con el diff leído del registro real, y solo tras aprobación hace POST a una ruta única (`/api/ghl-write`) con lista blanca de acciones. La lectura de definiciones viaja del servidor al navegador en el frame `data` del sync existente.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React, Anthropic SDK, pnpm, tsx (verify scripts). Sin framework de tests: la lógica peligrosa se cubre con scripts `scripts/verify-*.ts` (node:assert/strict); UI/rutas/loop se verifican manejando la app real + `npx tsc --noEmit`.

## Global Constraints

- **Package manager: pnpm.** Nunca `npm install`. Añadir deps con `pnpm add`.
- **`npx tsc --noEmit` debe pasar** — `next build` ignora errores de TS, así que un build verde no prueba nada.
- **Verify scripts son CJS:** este paquete no tiene `"type":"module"`, así que `tsx` compila a CJS y **top-level `await` falla**. Envolver en `main()` y llamar `main().catch(...)`. Registrar cada script nuevo en `package.json` como `verify:<algo>` y en la lista de comandos.
- **Contexto por request obligatorio:** toda ruta que toca GHL corre dentro de `requireClient()` + `withClient(client, ...)`. `ghlFetch` lee credenciales vía `currentClient()`, que **falla cerrado**. Nunca una variable module-level de "cliente actual".
- **Marca:** el texto que ve el usuario nunca dice "GoHighLevel"/"GHL" — es "Lezgo Suite CRM".
- **Ámbar `#F59B1B` (= `primary`)** solo marca dónde va la atención (hover/focus/pendiente). No decorar con él.
- **Sin borrado:** no existe acción de borrado de valores ni de definiciones, ni de "quitar opción", en ninguna capa.
- **API de custom fields = v1 por location** (`/contacts/:id`, `/opportunities/:id`, `/locations/:locationId/customFields`). **NO** Custom Fields V2 (no soporta contact/opportunity). Opciones = `picklistOptions: string[]`.
- **Toda escritura pasa por la puerta del loop.** La aprobación nunca se hereda: un `tool_use` de escritura = una tarjeta.

---

## Estructura de archivos

**Nuevos:**
- `lib/custom-field-merge.ts` — lógica pura de fusión de opciones + validación de payloads de escritura (unit-testable).
- `app/api/ghl-write/route.ts` — ruta única de escritura con lista blanca de acciones.
- `components/dashboard/chat-write-confirm.tsx` — tarjeta de confirmación + recibo sellado.
- `scripts/verify-write-tools.ts` — cobertura `WRITE_TOOLS` ⊇ definiciones + sin acción de borrado.
- `scripts/verify-custom-field-merge.ts` — la fusión nunca omite una opción existente + validaciones.

**Modificados:**
- `lib/ghl-client.ts` — 4 helpers de escritura (`updateContactCustomFields`, `updateOpportunityCustomFields`, `createCustomFieldDef`, `updateCustomFieldDef`) + corregir tipo `GHLCustomField`.
- `app/api/dashboard/route.ts` — emitir `customFieldDefs` en el frame `data`.
- `hooks/use-dashboard-data.ts` — `customFieldDefs` en `DashboardData` + tipo `CustomFieldDef`.
- `lib/types.ts` — exportar `CustomFieldDef`.
- `lib/ai-tools.ts` — `ChatDataset.customFieldDefs`; herramienta lectora `list_field_definitions`; `WRITE_TOOL_DEFINITIONS` + `WRITE_TOOLS`; ejecutor de `list_field_definitions`.
- `components/dashboard/dashboard-app.tsx` — pasar `customFieldDefs` al `dataset`.
- `app/api/chat/route.ts` — recibir `writeEnabled`, concatenar herramientas de escritura y bloque de reglas condicionalmente.
- `hooks/use-agent-loop.ts` — la puerta: `pendingWrite`, cola, `resolveWrite`, POST, parche optimista, recibos; pasar `writeEnabled` a `/api/chat`.
- `components/dashboard/conversations-chat.tsx` — el toggle; render de la tarjeta y los recibos.

---

## Task 1: Plumbing de `customFieldDefs` (servidor → navegador)

Lleva las definiciones de campo (id, nombre, tipo, opciones) desde el sync hasta el `dataset` del chat. Sin esto, el modelo no puede escribir con el id correcto ni validar opciones. Deliverable independiente: el navegador tiene las definiciones (verificable con `tsc` + un log).

**Files:**
- Modify: `lib/types.ts` (añadir tipo `CustomFieldDef` al final)
- Modify: `lib/ghl-client.ts:775-786` (corregir `GHLCustomField`)
- Modify: `app/api/dashboard/route.ts:415` (construir defs) y `:618` (emitir en frame `data`)
- Modify: `hooks/use-dashboard-data.ts:39-57` (`DashboardData`)
- Modify: `lib/ai-tools.ts` (`ChatDataset`, ~línea con `export interface ChatDataset`)
- Modify: `components/dashboard/dashboard-app.tsx:332-341` (pasar al dataset)

**Interfaces:**
- Produces: `CustomFieldDef` = `{ id: string; name: string; objectKey: "contact" | "opportunity"; dataType: string; fieldKey?: string; picklistOptions?: string[] }` — exportado de `lib/types.ts`.
- Produces: `DashboardData.customFieldDefs: CustomFieldDef[]` y `ChatDataset.customFieldDefs: CustomFieldDef[]`.

- [ ] **Step 1: Corregir el tipo `GHLCustomField`** (la anotación `options` está obsoleta; la API real devuelve `picklistOptions: string[]` y `model` puede ser un objeto custom).

En `lib/ghl-client.ts`, reemplazar la interfaz (líneas ~775-786):

```ts
export interface GHLCustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
  model?: string; // "contact" | "opportunity" | "custom_objects.<key>"
  locationId?: string;
  position?: number;
  placeholder?: string;
  required?: boolean;
  standard?: boolean;
  picklistOptions?: string[]; // opciones para *_OPTIONS / RADIO / CHECKBOX (string[] plano)
}
```

- [ ] **Step 2: Añadir el tipo `CustomFieldDef`** al final de `lib/types.ts`:

```ts
export interface CustomFieldDef {
  id: string
  name: string
  objectKey: "contact" | "opportunity"
  dataType: string // TEXT | LARGE_TEXT | NUMERICAL | SINGLE_OPTIONS | MULTIPLE_OPTIONS | DATE | CHECKBOX | RADIO
  fieldKey?: string
  picklistOptions?: string[]
}
```

- [ ] **Step 3: Construir las defs en el route del dashboard.** En `app/api/dashboard/route.ts`, justo después del bloque que llena `customFieldMap` (tras la línea ~417 `customFieldMap.set(cf.id, cf.name)`), añadir:

```ts
// Definiciones de campo que viajan al navegador para el modo edición del
// asistente: solo contact/opportunity (se descartan custom_objects.*).
const customFieldDefs = customFieldsRaw.customFields
  .filter((cf) => cf.model === "contact" || cf.model === "opportunity")
  .map((cf) => ({
    id: cf.id,
    name: cf.name,
    objectKey: cf.model as "contact" | "opportunity",
    dataType: cf.dataType ?? "TEXT",
    fieldKey: cf.fieldKey,
    picklistOptions: cf.picklistOptions,
  }));
```

- [ ] **Step 4: Emitir `customFieldDefs` en el frame `data`.** En el objeto `send({ type: "data", ... })` (~línea 618), añadir la propiedad junto a `pautas`:

```ts
            pautas,
            customFieldDefs,
            locationId: client.locationId,
```

- [ ] **Step 5: Tipar en `DashboardData`.** En `hooks/use-dashboard-data.ts`, importar el tipo y añadir el campo:

```ts
import type { /* …existentes… */, CustomFieldDef } from "@/lib/types"
```
```ts
  pautas: Pauta[];
  customFieldDefs: CustomFieldDef[];
  locationId: string;
```

- [ ] **Step 6: Añadir a `ChatDataset`.** En `lib/ai-tools.ts`, en `export interface ChatDataset`, añadir:

```ts
  calls: Call[];
  customFieldDefs: CustomFieldDef[];
```
Importar `CustomFieldDef` de `@/lib/types` donde se importan los otros tipos.

- [ ] **Step 7: Pasar al dataset del chat.** En `components/dashboard/dashboard-app.tsx`, dentro del literal `dataset={{ … }}` (~línea 332):

```ts
              tasks: data?.tasks ?? [],
              calls: data?.calls ?? [],
              customFieldDefs: data?.customFieldDefs ?? [],
```

- [ ] **Step 8: Verificar que compila y que las defs llegan.**

Run: `npx tsc --noEmit`
Expected: sin errores.

Luego arrancar la app (`pnpm dev`), abrir un proyecto, ir a Asistente IA y en la consola del navegador confirmar que el dataset trae defs. Verificación temporal — pegar en la consola tras cargar:
```js
// En la pestaña Asistente IA, tras el sync:
console.log(document.title) // solo para orientarse; la verificación real es el tsc verde
```
La prueba dura es `tsc` verde + que Task 2 (abajo) devuelva defs reales.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/ghl-client.ts app/api/dashboard/route.ts hooks/use-dashboard-data.ts lib/ai-tools.ts components/dashboard/dashboard-app.tsx
git commit -m "feat(asistente): plumb customFieldDefs del sync al dataset del chat"
```

---

## Task 2: Herramienta lectora `list_field_definitions`

El modelo necesita descubrir id/tipo/opciones antes de escribir. Va SIEMPRE (también con el toggle apagado), porque es lectura pura sobre datos que el navegador ya tiene. Deliverable: en el chat, pedir "qué campos de oportunidad existen" devuelve la lista real.

**Files:**
- Modify: `lib/ai-tools.ts` (definición en `TOOL_DEFINITIONS`; case en `executeTool`; función `listFieldDefinitions`)

**Interfaces:**
- Consumes: `ChatDataset.customFieldDefs` (Task 1).
- Produces: tool `list_field_definitions`, ejecutada por `executeTool` (ya despachada por el loop existente para tools no-especiales).

- [ ] **Step 1: Añadir la definición de la herramienta.** En `lib/ai-tools.ts`, dentro de `TOOL_DEFINITIONS` (junto a `list_fields`), añadir:

```ts
  {
    name: "list_field_definitions",
    description:
      "Lista las definiciones de custom fields editables (de contactos y oportunidades): id, nombre, tipo de dato y opciones válidas. LLAMA ESTO ANTES de escribir un valor o de crear/editar un campo, para usar el id correcto y valores de picklist exactos. Los tipos con opciones (SINGLE_OPTIONS, MULTIPLE_OPTIONS, RADIO, CHECKBOX) solo aceptan valores de su lista.",
    input_schema: {
      type: "object",
      properties: {
        objectKey: {
          type: "string",
          enum: ["contact", "opportunity", "all"],
          description: "Filtra por objeto. 'all' devuelve ambos.",
        },
      },
      required: ["objectKey"],
    },
  },
```

- [ ] **Step 2: Implementar la función ejecutora.** En `lib/ai-tools.ts` (junto a las otras funciones de tool, p. ej. cerca de `listFields`):

```ts
function listFieldDefinitions(input: ToolInput, data: ChatDataset): ToolOutput {
  const objectKey = typeof input.objectKey === "string" ? input.objectKey : "all";
  const defs = data.customFieldDefs.filter(
    (d) => objectKey === "all" || d.objectKey === objectKey,
  );
  return {
    count: defs.length,
    fields: defs.map((d) => ({
      id: d.id,
      name: d.name,
      objectKey: d.objectKey,
      dataType: d.dataType,
      options: d.picklistOptions ?? undefined,
    })),
  };
}
```

- [ ] **Step 3: Despachar en `executeTool`.** En el `switch (name)` de `executeTool`, junto a `case "list_fields":`:

```ts
    case "list_field_definitions":
      return listFieldDefinitions(input, data);
```

- [ ] **Step 4: Verificar en la app.**

Run: `npx tsc --noEmit`
Expected: sin errores.

En la app (Asistente IA), preguntar: *"¿Qué campos de oportunidad puedo editar?"* — el modelo debe llamar `list_field_definitions` y responder con nombres reales (p. ej. "Presupuesto", "Origen de Lead") con sus opciones.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(asistente): tool list_field_definitions (lectura de definiciones)"
```

---

## Task 3: Fusión de opciones + validación (lógica pura, con verify script)

El corazón peligroso del No-negociable 6: editar una definición reemplaza el arreglo de opciones completo en GHL, así que hay que fusionar y **rechazar** si una opción existente desaparecería. Aislado en un módulo puro para poder probarlo en Node. Deliverable: verify script verde.

**Files:**
- Create: `lib/custom-field-merge.ts`
- Create: `scripts/verify-custom-field-merge.ts`
- Modify: `package.json` (script `verify:cf-merge`)

**Interfaces:**
- Produces: `mergePicklistOptions(existing: string[], toAdd: string[]): { merged: string[] } | { error: string }` — fusiona preservando el orden existente y agregando las nuevas; nunca omite una existente (no puede: parte de `existing`). Devuelve `error` si `toAdd` está vacío o si todas ya existen (no-op).
- Produces: `validateFieldValueUpdates(updates, defsByName): { ok: true } | { ok: false; error: string }` — valida que cada campo exista y que, para tipos con opciones, el valor esté en la lista.

- [ ] **Step 1: Escribir el test que falla.** Crear `scripts/verify-custom-field-merge.ts`:

```ts
// Verificación para lib/custom-field-merge.ts. Run: pnpm verify:cf-merge
// CJS: envolver en main().
import assert from "node:assert/strict";
import {
  mergePicklistOptions,
  validateFieldValueUpdates,
} from "../lib/custom-field-merge";

async function main() {
  // --- La fusión agrega sin borrar y preserva orden.
  const m1 = mergePicklistOptions(["Show", "No show"], ["Cancelada"]);
  assert.ok("merged" in m1);
  assert.deepEqual(m1.merged, ["Show", "No show", "Cancelada"]);

  // --- NUNCA omite una opción existente (No-negociable 6): toda existente sigue presente.
  const existing = ["A", "B", "C"];
  const m2 = mergePicklistOptions(existing, ["D"]);
  assert.ok("merged" in m2);
  for (const e of existing) assert.ok(m2.merged.includes(e), `${e} debe seguir presente`);

  // --- Duplicados no se re-agregan (case-insensitive).
  const m3 = mergePicklistOptions(["Alta", "Baja"], ["alta", "Media"]);
  assert.ok("merged" in m3);
  assert.deepEqual(m3.merged, ["Alta", "Baja", "Media"]);

  // --- No-op (todas ya existen) es error, no una escritura vacía.
  const m4 = mergePicklistOptions(["Alta"], ["alta"]);
  assert.ok("error" in m4, "agregar solo duplicados debe ser error");

  // --- toAdd vacío es error.
  const m5 = mergePicklistOptions(["Alta"], []);
  assert.ok("error" in m5);

  // --- Validación de valores: campo inexistente -> error.
  const defsByName = new Map([
    ["Presupuesto", { dataType: "SINGLE_OPTIONS", picklistOptions: ["1M", "2M"] }],
    ["Notas", { dataType: "TEXT", picklistOptions: undefined }],
  ]);
  const v1 = validateFieldValueUpdates([{ fields: { NoExiste: "x" } }], defsByName);
  assert.equal(v1.ok, false);

  // --- Valor fuera de la lista de opciones -> error.
  const v2 = validateFieldValueUpdates([{ fields: { Presupuesto: "9M" } }], defsByName);
  assert.equal(v2.ok, false);

  // --- Valor válido de opción -> ok.
  const v3 = validateFieldValueUpdates([{ fields: { Presupuesto: "2M" } }], defsByName);
  assert.equal(v3.ok, true);

  // --- TEXT acepta cualquier string.
  const v4 = validateFieldValueUpdates([{ fields: { Notas: "lo que sea" } }], defsByName);
  assert.equal(v4.ok, true);

  console.log("verify:cf-merge OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Registrar el script y correrlo para verlo fallar.**

En `package.json`, en `scripts`, añadir:
```json
    "verify:cf-merge": "tsx scripts/verify-custom-field-merge.ts",
```
Run: `pnpm verify:cf-merge`
Expected: FALLA — `Cannot find module '../lib/custom-field-merge'`.

- [ ] **Step 3: Implementar `lib/custom-field-merge.ts`:**

```ts
// Lógica pura para las escrituras de custom fields del asistente. Sin efectos
// de red — probable en Node (scripts/verify-custom-field-merge.ts).

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Fusiona opciones nuevas sobre las existentes SIN borrar ninguna existente.
 * GHL reemplaza el arreglo completo al editar, así que enviamos existentes +
 * nuevas. Devuelve error si no hay nada nuevo que agregar (no-op) o si toAdd
 * viene vacío — nunca una escritura que reduzca el conjunto.
 */
export function mergePicklistOptions(
  existing: string[],
  toAdd: string[],
): { merged: string[] } | { error: string } {
  if (!Array.isArray(toAdd) || toAdd.length === 0)
    return { error: "No hay opciones nuevas que agregar." };
  const present = new Set(existing.map(norm));
  const merged = [...existing];
  let added = 0;
  for (const opt of toAdd) {
    const clean = String(opt).trim();
    if (!clean) continue;
    if (present.has(norm(clean))) continue;
    present.add(norm(clean));
    merged.push(clean);
    added++;
  }
  if (added === 0)
    return { error: "Todas las opciones indicadas ya existen; nada que agregar." };
  return { merged };
}

interface DefLite {
  dataType: string;
  picklistOptions?: string[];
}

const OPTION_TYPES = new Set([
  "SINGLE_OPTIONS",
  "MULTIPLE_OPTIONS",
  "RADIO",
  "CHECKBOX",
]);

/**
 * Valida un lote de actualizaciones de VALORES contra las definiciones.
 * Cada campo debe existir; para tipos con opciones, el valor debe estar en la
 * lista (case-insensitive). Falla cerrado con el primer problema.
 */
export function validateFieldValueUpdates(
  updates: Array<{ fields: Record<string, string> }>,
  defsByName: Map<string, DefLite>,
): { ok: true } | { ok: false; error: string } {
  for (const u of updates) {
    for (const [name, value] of Object.entries(u.fields ?? {})) {
      const def = defsByName.get(name);
      if (!def) return { ok: false, error: `El campo "${name}" no existe.` };
      if (OPTION_TYPES.has(def.dataType)) {
        const opts = def.picklistOptions ?? [];
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          const match = opts.some((o) => norm(o) === norm(String(v)));
          if (!match)
            return {
              ok: false,
              error: `"${v}" no es una opción válida de "${name}". Opciones: ${opts.join(", ")}.`,
            };
        }
      }
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Correr el verify script.**

Run: `pnpm verify:cf-merge`
Expected: `verify:cf-merge OK`.

- [ ] **Step 5: Añadir el comando a la lista de CLAUDE.md** (documentación). En `CLAUDE.md`, en el bloque de Verification, añadir la línea:
```
pnpm verify:cf-merge     # lib/custom-field-merge.ts — fusión de opciones (no borra) + validación de valores
```

- [ ] **Step 6: Commit**

```bash
git add lib/custom-field-merge.ts scripts/verify-custom-field-merge.ts package.json CLAUDE.md
git commit -m "feat(asistente): fusión de opciones y validación de valores (lógica pura + verify)"
```

---

## Task 4: Helpers de escritura en `lib/ghl-client.ts`

Los 4 wrappers de `ghlFetch` que efectivamente mutan GHL. Deliverable: helpers tipados que compilan; se ejercitan de verdad desde la ruta (Task 5).

**Files:**
- Modify: `lib/ghl-client.ts` (añadir helpers al final, antes del cierre)

**Interfaces:**
- Produces:
  - `updateContactCustomFields(contactId: string, fields: Array<{ id: string; field_value: string | string[] }>): Promise<unknown>`
  - `updateOpportunityCustomFields(opportunityId: string, fields: Array<{ id: string; field_value: string | string[] }>): Promise<unknown>`
  - `createCustomFieldDef(body: { name: string; dataType: string; model: "contact" | "opportunity"; picklistOptions?: string[] }): Promise<GHLCustomField>`
  - `updateCustomFieldDef(fieldId: string, body: { name?: string; picklistOptions?: string[] }): Promise<GHLCustomField>`

- [ ] **Step 1: Añadir los helpers.** En `lib/ghl-client.ts`, después de `getCustomFields` (o al final del bloque de custom fields):

```ts
// ============ CUSTOM FIELD WRITES (modo edición del asistente) ============

/** PUT /contacts/:id — actualiza valores de custom fields de un contacto.
 *  Forma de escritura: { id, field_value } (distinta de la lectura { id, value }). */
export async function updateContactCustomFields(
  contactId: string,
  fields: Array<{ id: string; field_value: string | string[] }>,
): Promise<unknown> {
  return ghlFetch(`/contacts/${contactId}`, {
    method: "PUT",
    body: { customFields: fields },
    noQueryLocationId: true, // el endpoint no espera ?locationId
  });
}

/** PUT /opportunities/:id — actualiza valores de custom fields de una oportunidad. */
export async function updateOpportunityCustomFields(
  opportunityId: string,
  fields: Array<{ id: string; field_value: string | string[] }>,
): Promise<unknown> {
  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: { customFields: fields },
    noQueryLocationId: true,
  });
}

/** POST /locations/:locationId/customFields — crea una definición de campo. */
export async function createCustomFieldDef(body: {
  name: string;
  dataType: string;
  model: "contact" | "opportunity";
  picklistOptions?: string[];
}): Promise<GHLCustomField> {
  const res = await ghlFetch<{ customField: GHLCustomField }>(
    "/locations/:locationId/customFields",
    { method: "POST", body },
  );
  return res.customField;
}

/** PUT /locations/:locationId/customFields/:id — renombra / agrega opciones. */
export async function updateCustomFieldDef(
  fieldId: string,
  body: { name?: string; picklistOptions?: string[] },
): Promise<GHLCustomField> {
  const res = await ghlFetch<{ customField: GHLCustomField }>(
    `/locations/:locationId/customFields/${fieldId}`,
    { method: "PUT", body },
  );
  return res.customField;
}
```

- [ ] **Step 2: Confirmar que compila.**

Run: `npx tsc --noEmit`
Expected: sin errores.

> Nota de verificación en vivo (se hará en Task 5 con la app, no aquí): la forma exacta de la respuesta de create/update (`{ customField }` vs objeto plano) puede variar. Si al ejercitar Task 5 la respuesta llega distinta, ajustar el `.customField` de estos dos helpers. Los helpers de valores (`updateContact*`) no dependen de la forma de respuesta.

- [ ] **Step 3: Commit**

```bash
git add lib/ghl-client.ts
git commit -m "feat(asistente): helpers de escritura de custom fields (valores + definiciones)"
```

---

## Task 5: Ruta única `/api/ghl-write` con lista blanca

El único punto donde la escritura sale a GHL. Lista blanca de acciones (sin borrado), fallas parciales sin abortar, fusión de opciones aplicada aquí. Deliverable: la ruta acepta una acción válida y rechaza una desconocida; verify script del contrato de acciones.

**Files:**
- Create: `app/api/ghl-write/route.ts`
- Create: `scripts/verify-write-tools.ts` (también cubre Task 6; se crea aquí la parte de acciones)
- Modify: `package.json` (`verify:write-tools`)

**Interfaces:**
- Consumes: helpers de Task 4; `mergePicklistOptions`, `validateFieldValueUpdates` de Task 3.
- Produces: `POST /api/ghl-write` con body `{ action, payload }`. Acciones y payloads:
  - `set_contact_fields` — `payload: { updates: Array<{ contactId: string; fields: Record<string, string|string[]> }> }`
  - `set_opportunity_fields` — `payload: { updates: Array<{ opportunityId: string; fields: Record<string, string|string[]> }> }`
  - `create_custom_field` — `payload: { objectKey, name, dataType, options?: string[] }`
  - `update_custom_field` — `payload: { fieldId, name?, addOptions?: string[] }`
- Produces: respuesta `{ ok: number; failed: number; failures: Array<{ id: string; name?: string; error: string }> }` para lotes; para definiciones `{ ok: 1, field: {...} }` o `{ ok: 0, failed: 1, failures: [...] }`.
- Produces (exportado para el verify): `export const WRITE_ACTIONS = ["set_contact_fields","set_opportunity_fields","create_custom_field","update_custom_field"] as const;`

- [ ] **Step 1: Escribir el verify de acciones (falla primero).** Crear `scripts/verify-write-tools.ts`:

```ts
// Verificación del contrato de escritura. Run: pnpm verify:write-tools
// CJS: envolver en main().
import assert from "node:assert/strict";
import { WRITE_ACTIONS } from "../app/api/ghl-write/route";
import { WRITE_TOOL_DEFINITIONS, WRITE_TOOLS } from "../lib/ai-tools";

async function main() {
  // --- Ninguna acción de escritura es un borrado (No-negociable 3).
  for (const a of WRITE_ACTIONS) {
    assert.ok(!/delete|remove|borrar|drop/i.test(a), `acción sospechosa: ${a}`);
  }

  // --- WRITE_TOOLS cubre EXACTAMENTE las definiciones de escritura (No-negociable 2).
  const names = WRITE_TOOL_DEFINITIONS.map((t) => t.name);
  assert.equal(WRITE_TOOLS.size, names.length, "WRITE_TOOLS y definiciones difieren en tamaño");
  for (const n of names) assert.ok(WRITE_TOOLS.has(n), `${n} falta en WRITE_TOOLS`);

  // --- Cada herramienta de escritura corresponde a una acción de la ruta.
  for (const n of names) {
    assert.ok((WRITE_ACTIONS as readonly string[]).includes(n), `${n} no tiene acción en la ruta`);
  }

  console.log("verify:write-tools OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

En `package.json`:
```json
    "verify:write-tools": "tsx scripts/verify-write-tools.ts",
```
Run: `pnpm verify:write-tools`
Expected: FALLA — no existe `app/api/ghl-write/route` ni `WRITE_TOOL_DEFINITIONS`.

- [ ] **Step 2: Implementar la ruta.** Crear `app/api/ghl-write/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireClient } from "@/lib/session";
import { withClient } from "@/lib/ghl-context";
import {
  updateContactCustomFields,
  updateOpportunityCustomFields,
  createCustomFieldDef,
  updateCustomFieldDef,
  getCustomFields,
} from "@/lib/ghl-client";
import { mergePicklistOptions } from "@/lib/custom-field-merge";

export const runtime = "nodejs";

// LISTA BLANCA. Una acción fuera de aquí es inalcanzable. Sin borrado.
export const WRITE_ACTIONS = [
  "set_contact_fields",
  "set_opportunity_fields",
  "create_custom_field",
  "update_custom_field",
] as const;
type WriteAction = (typeof WRITE_ACTIONS)[number];

interface Body {
  action: string;
  payload: Record<string, unknown>;
}

export async function POST(req: Request) {
  const client = await requireClient();
  if (!client) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (!(WRITE_ACTIONS as readonly string[]).includes(body.action)) {
    return NextResponse.json({ error: `Acción no permitida: ${body.action}` }, { status: 400 });
  }
  const action = body.action as WriteAction;
  const payload = body.payload ?? {};

  return withClient(client, async () => {
    // Mapa nombre->def para resolver id, tipo y opciones al escribir valores.
    const defsRaw = await getCustomFields();
    const byName = new Map(defsRaw.customFields.map((d) => [d.name, d]));

    if (action === "set_contact_fields" || action === "set_opportunity_fields") {
      const updates = Array.isArray((payload as any).updates) ? (payload as any).updates : [];
      const idKey = action === "set_contact_fields" ? "contactId" : "opportunityId";
      const writeOne = action === "set_contact_fields"
        ? updateContactCustomFields
        : updateOpportunityCustomFields;

      const results = await Promise.allSettled(
        updates.map(async (u: any) => {
          const recordId = String(u[idKey] ?? "");
          const fields = Object.entries(u.fields ?? {}).map(([name, value]) => {
            const def = byName.get(name);
            if (!def) throw new Error(`Campo "${name}" no existe`);
            return { id: def.id, field_value: value as string | string[] };
          });
          await writeOne(recordId, fields);
          return recordId;
        }),
      );
      const failures = results
        .map((r, i) => (r.status === "rejected"
          ? { id: String(updates[i]?.[idKey] ?? ""), name: updates[i]?.name, error: String(r.reason?.message ?? r.reason) }
          : null))
        .filter(Boolean);
      return NextResponse.json({
        ok: results.filter((r) => r.status === "fulfilled").length,
        failed: failures.length,
        failures,
      });
    }

    if (action === "create_custom_field") {
      const p = payload as any;
      try {
        const field = await createCustomFieldDef({
          name: String(p.name),
          dataType: String(p.dataType),
          model: p.objectKey === "opportunity" ? "opportunity" : "contact",
          picklistOptions: Array.isArray(p.options) ? p.options.map(String) : undefined,
        });
        return NextResponse.json({ ok: 1, failed: 0, failures: [], field });
      } catch (e: any) {
        return NextResponse.json({ ok: 0, failed: 1, failures: [{ id: "", error: String(e?.message ?? e) }] });
      }
    }

    // update_custom_field: renombra y/o agrega opciones (fusionando, sin borrar).
    const p = payload as any;
    const fieldId = String(p.fieldId ?? "");
    const def = defsRaw.customFields.find((d) => d.id === fieldId);
    if (!def) return NextResponse.json({ ok: 0, failed: 1, failures: [{ id: fieldId, error: "Campo no encontrado" }] });

    const upd: { name?: string; picklistOptions?: string[] } = {};
    if (typeof p.name === "string" && p.name.trim()) upd.name = p.name.trim();
    if (Array.isArray(p.addOptions) && p.addOptions.length) {
      const merged = mergePicklistOptions(def.picklistOptions ?? [], p.addOptions.map(String));
      if ("error" in merged)
        return NextResponse.json({ ok: 0, failed: 1, failures: [{ id: fieldId, error: merged.error }] });
      upd.picklistOptions = merged.merged;
    }
    if (!upd.name && !upd.picklistOptions)
      return NextResponse.json({ ok: 0, failed: 1, failures: [{ id: fieldId, error: "Nada que actualizar" }] });
    try {
      const field = await updateCustomFieldDef(fieldId, upd);
      return NextResponse.json({ ok: 1, failed: 0, failures: [], field });
    } catch (e: any) {
      return NextResponse.json({ ok: 0, failed: 1, failures: [{ id: fieldId, error: String(e?.message ?? e) }] });
    }
  });
}
```

> Nota: `WRITE_TOOL_DEFINITIONS`/`WRITE_TOOLS` aún no existen — Task 6 los crea. El verify de Step 1 seguirá fallando en esos imports hasta Task 6. Está bien: se corre completo al final de Task 6. Por ahora confirmar que la ruta compila.

- [ ] **Step 3: Confirmar compilación de la ruta.**

Run: `npx tsc --noEmit`
Expected: error solo por `WRITE_TOOL_DEFINITIONS`/`WRITE_TOOLS` inexistentes en el verify script (esperado). La ruta en sí no debe tener errores. Si hay errores dentro de `route.ts`, corregirlos.

- [ ] **Step 4: Commit**

```bash
git add app/api/ghl-write/route.ts scripts/verify-write-tools.ts package.json
git commit -m "feat(asistente): ruta /api/ghl-write con lista blanca de acciones (sin borrado)"
```

---

## Task 6: Definiciones de herramientas de escritura + `WRITE_TOOLS` derivado

Las 4 herramientas que el modelo ve, y el set derivado que la puerta consulta. Deliverable: `pnpm verify:write-tools` verde (cierra el contrato entre tools y acciones).

**Files:**
- Modify: `lib/ai-tools.ts` (añadir `WRITE_TOOL_DEFINITIONS` y `WRITE_TOOLS`)

**Interfaces:**
- Produces: `export const WRITE_TOOL_DEFINITIONS` (arreglo de 4 tools) y `export const WRITE_TOOLS: Set<string>` derivado.
- Consumido por: `app/api/chat/route.ts` (Task 8) y `hooks/use-agent-loop.ts` (Task 7); el verify de Task 5.

- [ ] **Step 1: Añadir las definiciones y el set derivado.** En `lib/ai-tools.ts`, tras `TOOL_DEFINITIONS`:

```ts
// Herramientas de ESCRITURA — solo se envían al modelo con el modo edición
// activo, y CADA UNA pasa por la puerta de confirmación en use-agent-loop.ts.
// WRITE_TOOLS se DERIVA de este arreglo: agregar una tool aquí la registra
// automáticamente en la puerta (No-negociable 2 — no se puede desincronizar).
export const WRITE_TOOL_DEFINITIONS = [
  {
    name: "set_contact_fields",
    description:
      "Cambia valores de custom fields en uno o varios contactos (hasta 50). Un elemento por contacto; cada 'fields' mapea nombre de campo -> valor. Para campos con opciones usa un valor exacto de la lista (ver list_field_definitions). Requiere confirmación del usuario.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              contactId: { type: "string" },
              fields: { type: "object", description: "nombre de campo -> valor (string o lista para multi-opción)" },
            },
            required: ["contactId", "fields"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "set_opportunity_fields",
    description:
      "Cambia valores de custom fields en una o varias oportunidades (hasta 50). Igual que set_contact_fields pero con opportunityId. Requiere confirmación del usuario.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              opportunityId: { type: "string" },
              fields: { type: "object" },
            },
            required: ["opportunityId", "fields"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "create_custom_field",
    description:
      "Crea una definición de custom field nueva en el objeto contact u opportunity. Para tipos con opciones (SINGLE_OPTIONS, MULTIPLE_OPTIONS, RADIO) incluye 'options'. Requiere confirmación del usuario.",
    input_schema: {
      type: "object",
      properties: {
        objectKey: { type: "string", enum: ["contact", "opportunity"] },
        name: { type: "string" },
        dataType: {
          type: "string",
          enum: ["TEXT", "LARGE_TEXT", "NUMERICAL", "SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "DATE", "RADIO", "CHECKBOX"],
        },
        options: { type: "array", items: { type: "string" }, description: "Solo para tipos con opciones." },
      },
      required: ["objectKey", "name", "dataType"],
    },
  },
  {
    name: "update_custom_field",
    description:
      "Edita una definición de campo existente: renómbrala (name) y/o AGREGA opciones (addOptions). NO puede quitar ni borrar opciones. Requiere confirmación del usuario.",
    input_schema: {
      type: "object",
      properties: {
        fieldId: { type: "string" },
        name: { type: "string", description: "Nuevo nombre (opcional)." },
        addOptions: { type: "array", items: { type: "string" }, description: "Opciones a agregar (opcional)." },
      },
      required: ["fieldId"],
    },
  },
] as const;

export const WRITE_TOOLS = new Set<string>(WRITE_TOOL_DEFINITIONS.map((t) => t.name));
```

- [ ] **Step 2: Correr el verify completo.**

Run: `pnpm verify:write-tools`
Expected: `verify:write-tools OK`.

- [ ] **Step 3: Confirmar tipos.**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(asistente): WRITE_TOOL_DEFINITIONS + WRITE_TOOLS derivado"
```

---

## Task 7: La puerta en el loop del agente

El código que intercepta las escrituras, calcula el diff, pausa, y tras aprobación hace POST + parche optimista + recibo. Deliverable: end-to-end funcional con la tarjeta de Task manual — pero como la tarjeta es Task 8b, aquí se expone la API del hook y se verifica con `tsc`; el ciclo visual completo se prueba al terminar Task 8.

**Files:**
- Modify: `hooks/use-agent-loop.ts`

**Interfaces:**
- Consumes: `WRITE_TOOLS` (Task 6); `ChatDataset` con `customFieldDefs`.
- Produces (añadidos al `AgentLoopReturn`):
  - `pendingWrite: PendingWrite | null`
  - `resolveWrite: (decision: { approve: boolean }) => void`
  - `writeReceipts: WriteReceipt[]`
- Produces (tipos exportados):
```ts
export interface WriteDiffRow { id: string; label: string; sublabel?: string; before: string; after: string; }
export interface PendingWrite {
  toolUseId: string;
  action: string;
  title: string;          // "Editar contacto" | "Editar 23 contactos" | "Crear campo" | "Editar campo"
  subtitle?: string;      // "Fuente de lead → Instagram Ads" o el nombre del campo nuevo
  rows: WriteDiffRow[];
  payload: Record<string, unknown>;
}
export interface WriteReceipt {
  status: "applied" | "partial" | "cancelled" | "failed";
  title: string;
  detail: string;
  ok?: number; failed?: number;
  failures?: Array<{ id: string; name?: string; error: string }>;
  at: string;
}
```
- El `writeEnabled` se acepta como nueva opción de `useAgentLoop` y se envía en el body de `/api/chat`.

- [ ] **Step 1: Añadir `writeEnabled` a las opciones y al POST.**

En `AgentLoopOptions` añadir `writeEnabled: boolean;`. En la firma de `useAgentLoop({ datasetSummary, dataset, onToolExecuted, writeEnabled })`. En el `fetch("/api/chat")` body, añadir `writeEnabled`:

```ts
            body: JSON.stringify({ datasetSummary, messages: apiMessages, userTimezone, writeEnabled }),
```
Añadir `writeEnabled` al array de deps de `runWithMessages`.

- [ ] **Step 2: Definir tipos y estado.** Al inicio del hook (junto a `pendingQuestion`):

```ts
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [writeReceipts, setWriteReceipts] = useState<WriteReceipt[]>([]);
  const writeStashRef = useRef<{
    convo: UIMessage[];
    priorResults: ToolResultBlock[];   // resultados de lecturas + escrituras ya resueltas este turno
    queue: ToolUseBlock[];             // escrituras pendientes (la primera es la activa)
  } | null>(null);
```
Exportar las interfaces `WriteDiffRow`, `PendingWrite`, `WriteReceipt` (arriba del hook) e importar `WRITE_TOOLS` de `@/lib/ai-tools` y `CustomFieldDef` si hace falta.

- [ ] **Step 3: Construir el diff de una escritura.** Función helper dentro del hook (antes de `runWithMessages`), que lee del dataset:

```ts
  const buildPendingWrite = useCallback(
    (tu: ToolUseBlock): PendingWrite => {
      const defByName = new Map(dataset.customFieldDefs.map((d) => [d.name, d]));
      const cur = (rec: { customFieldsResolved?: Record<string, string | string[]> } | undefined, name: string) => {
        const v = rec?.customFieldsResolved?.[name];
        if (v == null || (Array.isArray(v) && v.length === 0) || v === "") return "(sin valor)";
        return Array.isArray(v) ? v.join(", ") : String(v);
      };
      if (tu.name === "set_contact_fields" || tu.name === "set_opportunity_fields") {
        const isContact = tu.name === "set_contact_fields";
        const updates = Array.isArray(tu.input.updates) ? (tu.input.updates as any[]) : [];
        const rows: WriteDiffRow[] = [];
        for (const u of updates) {
          const id = String(isContact ? u.contactId : u.opportunityId);
          const rec = isContact
            ? dataset.contacts.find((c) => c.id === id)
            : dataset.opportunities.find((o) => o.id === id);
          const label = (rec as any)?.name ?? id;
          const sublabel = isContact ? [(rec as any)?.email, (rec as any)?.phone].filter(Boolean).join(" · ") : undefined;
          for (const [fname, val] of Object.entries(u.fields ?? {})) {
            rows.push({
              id, label, sublabel,
              before: cur(rec as any, fname),
              after: Array.isArray(val) ? val.join(", ") : String(val),
            });
          }
        }
        const n = updates.length;
        const noun = isContact ? "contacto" : "oportunidad";
        return {
          toolUseId: tu.id, action: tu.name, payload: tu.input,
          title: n === 1 ? `Editar ${noun}` : `Editar ${n} ${isContact ? "contactos" : "oportunidades"}`,
          rows,
        };
      }
      if (tu.name === "create_custom_field") {
        const p = tu.input as any;
        return {
          toolUseId: tu.id, action: tu.name, payload: tu.input,
          title: "Crear campo",
          subtitle: `${p.name} · ${p.dataType}${Array.isArray(p.options) && p.options.length ? " · " + p.options.join(", ") : ""}`,
          rows: [],
        };
      }
      // update_custom_field
      const p = tu.input as any;
      const def = dataset.customFieldDefs.find((d) => d.id === p.fieldId);
      const rows: WriteDiffRow[] = [];
      if (p.name && def) rows.push({ id: p.fieldId, label: "Nombre", before: def.name, after: p.name });
      if (Array.isArray(p.addOptions) && p.addOptions.length && def) {
        rows.push({
          id: p.fieldId, label: "Opciones",
          before: (def.picklistOptions ?? []).join(", ") || "(ninguna)",
          after: [ ...(def.picklistOptions ?? []), ...p.addOptions.filter((o: string) => !(def.picklistOptions ?? []).some((e) => e.toLowerCase() === String(o).toLowerCase())) ].join(", "),
        });
      }
      return { toolUseId: tu.id, action: tu.name, payload: tu.input, title: "Editar campo", subtitle: def?.name, rows };
    },
    [dataset],
  );
```

- [ ] **Step 4: Interceptar escrituras en el loop.** En `runWithMessages`, tras calcular `toolUses` y ANTES del bloque `askUse` existente, particionar:

```ts
          const writeUses = toolUses.filter((b) => WRITE_TOOLS.has(b.name));
          const askUse = toolUses.find((b) => b.name === "ask_user");
          const toRun = toolUses.filter((b) => b.name !== "ask_user" && !WRITE_TOOLS.has(b.name));
```
(Reemplaza el cálculo actual de `toRun`; conserva el resto del manejo de `askUse`.) `Promise.all` sigue ejecutando `toRun`. Tras obtener `toolResults` de las lecturas y manejar `askUse` (si lo hubiera, mantener su rama; en la práctica el modelo no mezcla ask con write), añadir, si hay `writeUses`:

```ts
          if (writeUses.length > 0) {
            setStatus(null);
            writeStashRef.current = {
              convo,
              priorResults: toolResults,
              queue: writeUses,
            };
            setPendingWrite(buildPendingWrite(writeUses[0]));
            setBusy(false);
            return; // el loop se reanuda desde resolveWrite()
          }
```

- [ ] **Step 5: Implementar `resolveWrite`.** Nueva `useCallback`:

```ts
  const resolveWrite = useCallback(
    async (decision: { approve: boolean }) => {
      const stash = writeStashRef.current;
      if (!stash) return;
      const active = stash.queue[0];
      const pw = pendingWrite!;
      let resultForModel: unknown;
      let receipt: WriteReceipt;

      if (!decision.approve) {
        resultForModel = { cancelled: true };
        receipt = { status: "cancelled", title: pw.title, detail: pw.subtitle ?? pw.rows[0]?.label ?? "", at: new Date().toISOString() };
      } else {
        try {
          const res = await fetch("/api/ghl-write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: pw.action, payload: pw.payload }),
          });
          const data = await res.json();
          resultForModel = data;
          const failed = data.failed ?? 0;
          const ok = data.ok ?? 0;
          const status: WriteReceipt["status"] = failed === 0 ? "applied" : ok > 0 ? "partial" : "failed";
          receipt = {
            status, title: pw.title,
            detail: pw.subtitle ?? (pw.rows[0] ? `${pw.rows[0].label} → ${pw.rows[0].after}` : ""),
            ok, failed, failures: data.failures ?? [],
            at: new Date().toISOString(),
          };
          if (status !== "failed") applyOptimisticPatch(pw);
        } catch (e: any) {
          resultForModel = { error: String(e?.message ?? e) };
          receipt = { status: "failed", title: pw.title, detail: String(e?.message ?? e), at: new Date().toISOString() };
        }
      }

      setWriteReceipts((r) => [...r, receipt]);
      const writeResult: ToolResultBlock = {
        type: "tool_result",
        tool_use_id: active.id,
        content: JSON.stringify(resultForModel),
        is_error: !decision.approve ? false : (receipt.status === "failed"),
      };
      const priorResults = [...stash.priorResults, writeResult];
      const rest = stash.queue.slice(1);

      if (rest.length > 0) {
        writeStashRef.current = { convo: stash.convo, priorResults, queue: rest };
        setPendingWrite(buildPendingWrite(rest[0]));
        return; // siguiente tarjeta
      }
      // Cola vacía: emitir TODOS los tool_result y reanudar el loop.
      writeStashRef.current = null;
      setPendingWrite(null);
      const resumed = [...stash.convo, { role: "user" as const, blocks: priorResults }];
      setMessages(resumed);
      messagesRef.current = resumed;
      setTotalTools((n) => n + stash.queue.length); // contar las escrituras resueltas de esta tanda
      void runWithMessages(resumed);
    },
    [pendingWrite, buildPendingWrite, runWithMessages],
  );
```

- [ ] **Step 6: Implementar el parche optimista.** Helper dentro del hook:

```ts
  const applyOptimisticPatch = useCallback(
    (pw: PendingWrite) => {
      const p = pw.payload as any;
      if (pw.action === "set_contact_fields" || pw.action === "set_opportunity_fields") {
        const isContact = pw.action === "set_contact_fields";
        for (const u of p.updates ?? []) {
          const id = String(isContact ? u.contactId : u.opportunityId);
          const rec = isContact
            ? dataset.contacts.find((c) => c.id === id)
            : dataset.opportunities.find((o) => o.id === id);
          if (!rec) continue;
          rec.customFieldsResolved = rec.customFieldsResolved ?? {};
          for (const [name, val] of Object.entries(u.fields ?? {})) {
            (rec.customFieldsResolved as Record<string, string | string[]>)[name] = val as string | string[];
          }
        }
      } else if (pw.action === "create_custom_field") {
        dataset.customFieldDefs.push({
          id: `optimistic-${Date.now()}`,
          name: String(p.name), objectKey: p.objectKey, dataType: String(p.dataType),
          picklistOptions: Array.isArray(p.options) ? p.options.map(String) : undefined,
        });
      } else if (pw.action === "update_custom_field") {
        const def = dataset.customFieldDefs.find((d) => d.id === p.fieldId);
        if (def) {
          if (p.name) def.name = String(p.name);
          if (Array.isArray(p.addOptions)) {
            const present = new Set((def.picklistOptions ?? []).map((o) => o.toLowerCase()));
            def.picklistOptions = [ ...(def.picklistOptions ?? []), ...p.addOptions.map(String).filter((o: string) => !present.has(o.toLowerCase())) ];
          }
        }
      }
    },
    [dataset],
  );
```
(Declararlo antes de `resolveWrite` para respetar el orden de referencias, o usar `useCallback` y añadir a deps.)

- [ ] **Step 7: Exponer en el return + reset.** Añadir `pendingWrite, resolveWrite, writeReceipts` al objeto que retorna el hook y a `AgentLoopReturn`. En `reset()` añadir `setPendingWrite(null); setWriteReceipts([]); writeStashRef.current = null;`.

- [ ] **Step 8: Confirmar tipos.**

Run: `npx tsc --noEmit`
Expected: sin errores. (La UI que consume `pendingWrite`/`resolveWrite` llega en Task 8; el hook compila solo.)

- [ ] **Step 9: Commit**

```bash
git add hooks/use-agent-loop.ts
git commit -m "feat(asistente): puerta de escritura en el loop (diff, cola, parche optimista, recibos)"
```

---

## Task 8: Toggle + tarjeta de confirmación + reglas del prompt

Cierra el círculo: el interruptor que habilita todo, la tarjeta que el usuario aprueba, y el bloque de reglas de escritura en el system prompt. Deliverable: el flujo completo funciona en la app real.

**Files:**
- Create: `components/dashboard/chat-write-confirm.tsx`
- Modify: `app/api/chat/route.ts`
- Modify: `components/dashboard/conversations-chat.tsx`
- Modify: `lib/ai-context.ts` (bloque de reglas de escritura, exportado como constante aparte)

**Interfaces:**
- Consumes: `pendingWrite`, `resolveWrite`, `writeReceipts` (Task 7); `WRITE_TOOL_DEFINITIONS` (Task 6); `PendingWrite`, `WriteReceipt` types.
- Produces: `<ChatWriteConfirm pending={...} onResolve={...} />` y `<WriteReceiptCard receipt={...} />`.

- [ ] **Step 1: Bloque de reglas de escritura en el prompt.** En `lib/ai-context.ts`, exportar una constante nueva (no tocar `ASSISTANT_SYSTEM_PROMPT`):

```ts
export const WRITE_MODE_RULES = `
## Modo edición (activo)
Tienes herramientas de escritura: set_contact_fields, set_opportunity_fields, create_custom_field, update_custom_field.
1. ANTES de escribir un valor, llama list_field_definitions para usar el id/opciones correctos. Los campos con opciones solo aceptan valores exactos de su lista.
2. Cada escritura la CONFIRMA el usuario en una tarjeta; tú solo propones. No afirmes que "ya quedó" hasta ver el tool_result de éxito.
3. Si el usuario cancela (result {cancelled:true}) NO reintentes igual: pregunta qué ajustar.
4. Para editar muchos registros con el mismo cambio, usa UN solo set_*_fields con varios updates (hasta 50), no muchas llamadas.
5. update_custom_field solo AGREGA opciones o renombra; nunca borra. No existe borrar campos ni valores.
`.trim();
```

- [ ] **Step 2: Enviar herramientas y reglas condicionalmente.** En `app/api/chat/route.ts`:
  - Añadir `writeEnabled?: boolean;` a `ChatRequestBody`.
  - Importar `WRITE_TOOL_DEFINITIONS` de `@/lib/ai-tools` y `WRITE_MODE_RULES` de `@/lib/ai-context`.
  - Construir tools y system condicionalmente:

```ts
    const tools = body.writeEnabled
      ? [...TOOL_DEFINITIONS, ...WRITE_TOOL_DEFINITIONS]
      : TOOL_DEFINITIONS;

    const systemBlocks = [
      { type: "text" as const, text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: body.datasetSummary, cache_control: { type: "ephemeral" as const } },
      ...(body.writeEnabled ? [{ type: "text" as const, text: WRITE_MODE_RULES }] : []),
      { type: "text" as const, text: `Fecha y hora actuales: ${today}, ${time} (zona horaria ${tz}). Usa esto para resolver referencias relativas…` },
    ];
```
  Usar `tools` y `system: systemBlocks` en `client.messages.create`.

  > Nota de caching: el bloque de reglas va DESPUÉS de los dos breakpoints cacheados y no lleva `cache_control`, así que activar/desactivar el toggle no invalida el prefijo cacheado del prompt.

- [ ] **Step 3: Crear la tarjeta.** Crear `components/dashboard/chat-write-confirm.tsx`:

```tsx
"use client";

import { Check, X, AlertTriangle, Pencil, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingWrite, WriteReceipt } from "@/hooks/use-agent-loop";

export function ChatWriteConfirm({
  pending,
  onResolve,
}: {
  pending: PendingWrite;
  onResolve: (d: { approve: boolean }) => void;
}) {
  const [applying, setApplying] = useState(false);
  const rows = pending.rows;
  const many = rows.length > 6;
  const shown = many ? rows.slice(0, 5) : rows;

  return (
    <div className="w-full max-w-[85%] self-start rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Pencil className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-semibold text-foreground">{pending.title}</p>
      </div>
      {pending.subtitle && (
        <p className="mt-1 pl-8 text-xs text-muted-foreground">{pending.subtitle}</p>
      )}

      {shown.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {shown.map((r, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs">
              {rows.length > 1 && (
                <div className="font-medium text-foreground/90">
                  {r.label}
                  {r.sublabel && <span className="ml-1 text-[10px] text-muted-foreground/70">{r.sublabel}</span>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground line-through decoration-muted-foreground/40">{r.before}</span>
                <span className="text-primary">→</span>
                <span className="font-medium text-foreground">{r.after}</span>
              </div>
            </div>
          ))}
          {many && (
            <p className="pl-1 text-[11px] text-muted-foreground">
              … y {rows.length - 5} más
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={applying}
          onClick={() => onResolve({ approve: false })}
          className="h-7 gap-1.5 px-3 text-[11px]">
          <X className="h-3 w-3" /> Cancelar
        </Button>
        <Button type="button" size="sm" disabled={applying}
          onClick={() => { setApplying(true); onResolve({ approve: true }); }}
          className="h-7 gap-1.5 px-3 text-[11px]">
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Aplicar
        </Button>
      </div>
    </div>
  );
}

export function WriteReceiptCard({ receipt }: { receipt: WriteReceipt }) {
  const icon = {
    applied: <Check className="h-3.5 w-3.5" />,
    partial: <AlertTriangle className="h-3.5 w-3.5" />,
    failed: <X className="h-3.5 w-3.5" />,
    cancelled: <X className="h-3.5 w-3.5" />,
  }[receipt.status];
  const tone = {
    applied: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    partial: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    failed: "border-destructive/30 bg-destructive/5 text-destructive",
    cancelled: "border-border bg-muted/30 text-muted-foreground",
  }[receipt.status];
  const label = {
    applied: "Aplicado", partial: `${receipt.ok} de ${(receipt.ok ?? 0) + (receipt.failed ?? 0)} aplicados`,
    failed: "Falló", cancelled: "Cancelado",
  }[receipt.status];

  return (
    <div className={cn("w-full max-w-[85%] self-start rounded-xl border px-3.5 py-2.5 text-xs", tone)}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{receipt.title} · {label}</span>
      </div>
      {receipt.detail && <p className="mt-0.5 pl-6 opacity-80">{receipt.detail}</p>}
      {receipt.failures && receipt.failures.length > 0 && (
        <ul className="mt-1 pl-6 space-y-0.5 opacity-80">
          {receipt.failures.slice(0, 5).map((f, i) => (
            <li key={i}>{f.name ?? f.id}: {f.error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Cablear el toggle y los renders en `conversations-chat.tsx`.**
  - Estado: `const [writeEnabled, setWriteEnabled] = useState(false);`
  - Pasar a `useAgentLoop`: añadir `writeEnabled` a las opciones y desestructurar `pendingWrite, resolveWrite, writeReceipts` del hook.
  - Importar `ChatWriteConfirm, WriteReceiptCard`.
  - Añadir `pendingWrite` a las deps del efecto de auto-scroll (junto a `pendingQuestion`).
  - En la zona de mensajes, tras el render de `pendingQuestion`, añadir los recibos y la tarjeta activa:

```tsx
          {writeReceipts.map((r, i) => (
            <WriteReceiptCard key={`wr-${i}`} receipt={r} />
          ))}

          {pendingWrite && (
            <ChatWriteConfirm pending={pendingWrite} onResolve={resolveWrite} />
          )}
```
  - El toggle, en la barra de input (junto a "Reiniciar"/"Adjuntar"):

```tsx
              <button
                type="button"
                role="switch"
                aria-checked={writeEnabled}
                onClick={() => setWriteEnabled((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors",
                  writeEnabled
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-primary/40",
                )}
                title={writeEnabled
                  ? "Modo edición activo: la IA puede proponer cambios, y cada uno te pide confirmación."
                  : "Modo solo lectura. Actívalo para permitir ediciones (con confirmación)."}
              >
                <Pencil className="h-3 w-3" />
                {writeEnabled ? "Edición" : "Solo lectura"}
              </button>
```
  (Importar `Pencil` de lucide-react.) Cuando `writeEnabled` esté activo, mostrar además, arriba de la barra o junto al toggle, el nombre del proyecto: reutilizar el `locationName`/proyecto ya disponible en el componente si lo hay; si no, un texto fijo "Puede modificar datos. Cada cambio pide confirmación." Mantenerlo mínimo.

- [ ] **Step 5: Bloquear el composer mientras hay una tarjeta pendiente.** Donde el `Textarea` y el botón Enviar usan `disabled={busy}`, cambiar a `disabled={busy || !!pendingWrite}` para el Textarea y añadir `|| !!pendingWrite` a la condición del botón Enviar. (Igual criterio que `pendingQuestion` ya impone al pausar.)

- [ ] **Step 6: Confirmar tipos y correr todos los verify.**

Run: `npx tsc --noEmit`
Expected: sin errores.
Run: `pnpm verify:cf-merge && pnpm verify:write-tools`
Expected: ambos OK.

- [ ] **Step 7: Prueba end-to-end en la app real.** Con `pnpm dev`:
  1. Abrir un proyecto, ir a Asistente IA. El toggle dice "Solo lectura".
  2. Pedir un cambio → el modelo responde que no puede editar (no tiene la tool).
  3. Activar "Edición". Pedir: *"Cambia el campo <uno de texto> del contacto <nombre> a <valor>"*.
  4. Debe aparecer la tarjeta con antes/después leídos del registro. Aprobar.
  5. Verificar en GHL (MCP `contacts_get-contact` o la UI) que el valor cambió.
  6. Repetir y **Cancelar** → recibo "Cancelado", la conversación sigue.
  7. Probar un lote pequeño (2-3 contactos) y un `update_custom_field` que agregue una opción; confirmar que la opción se agrega sin borrar las existentes.

  > Si create/update devuelven una forma distinta a `{ customField }`, ajustar los helpers de Task 4 Step 1 y recompilar.

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/chat-write-confirm.tsx app/api/chat/route.ts components/dashboard/conversations-chat.tsx lib/ai-context.ts
git commit -m "feat(asistente): toggle de modo edición, tarjeta de confirmación y reglas del prompt"
```

---

## Self-review del plan (cobertura del spec)

- **Toggle habilita tools** → Task 8 (Step 2 servidor + Step 4 UI). ✔
- **Puerta en el loop, no en el prompt** → Task 7. ✔
- **`WRITE_TOOLS` derivado, no desincronizable** → Task 6 Step 1 + verify Task 5/6. ✔
- **Sin acción de borrado** → lista blanca Task 5; verify Task 5 Step 1. ✔
- **Aprobación no se hereda / cola de a uno** → Task 7 Step 4-5. ✔
- **Diff leído del registro real** → Task 7 Step 3 (`buildPendingWrite` lee `customFieldsResolved`). ✔
- **Fallas parciales sin abortar** → Task 5 Step 2 (`Promise.allSettled` + `{ok,failed,failures}`); recibo `partial` Task 7/8. ✔
- **`update_custom_field` no borra opciones** → `mergePicklistOptions` Task 3; verify Task 3. ✔
- **customFieldDefs al navegador (filtrado a contact/opportunity)** → Task 1. ✔
- **API v1 (no v2), picklistOptions string[]** → Task 4 (paths) + Task 1 (tipo). ✔
- **Parche optimista sin re-sync** → Task 7 Step 6. ✔
- **Recibo sellado en el hilo (rastro efímero)** → Task 7 (`writeReceipts`) + Task 8 (`WriteReceiptCard`). ✔
- **Marca "Lezgo Suite CRM", ámbar solo para atención** → constraints globales; el toggle activo usa `primary` (ámbar) como estado de atención. ✔
- **Deuda de auditoría persistente** → fuera de alcance por diseño; no requiere task. ✔

## Nota de despliegue

Ninguna variable de entorno nueva. El PIT de cada sub-cuenta debe tener scopes de escritura (`contacts.write`, `opportunities.write`, y el scope de custom fields de location) para que las mutaciones no devuelvan 401/403; si un proyecto no los tiene, las escrituras fallarán con un recibo `failed` legible — comportamiento aceptable, no rompe la lectura.
