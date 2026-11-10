# Paneles autogestionables por IA — Diseño

**Fecha:** 2026-10-29
**Estado:** Borrador para revisión (ya pasó una revisión independiente como "constructor"). Se escribió sin una ronda de preguntas
(el dueño lo pidió antes de irse a dormir). Lo que decidí por mi cuenta está
marcado **[Decisión mía]**, y al final está la lista de preguntas que solo el
dueño puede responder.

---

## 0. Resumen en un minuto

Un cliente entra y ve un panel vacío con una sola caja: **"¿Qué quieres ver?"**.
Escribe lo que quiere ("las citas organizadas por etapa del pipeline"), la IA
arma la gráfica, la gráfica queda **guardada en la base de datos** y la próxima
vez que entre ahí sigue, con datos frescos. Todo se edita también hablando
("hazla mensual", "pásala a la pestaña Ventas", "borra la de tareas"), y la IA
puede crear y renombrar pestañas como las de hoy.

La idea central es una sola: **lo que se guarda es la pregunta, no la
respuesta.** Cada gráfica se guarda como una *especificación declarativa* (un
JSON validado: fuente, métrica, agrupación, filtros, periodo, tipo de gráfica),
y un **motor determinista** la vuelve a calcular cada vez sobre los datos del
día. La IA nunca escribe los números de una gráfica guardada y nunca escribe
código que se ejecute: elige piezas de un catálogo cerrado.

Se construye en cuatro fases. La fase 1 ya entrega lo prometido (panel vacío →
IA → gráficas guardadas → edición por IA → pestañas). Las fases siguientes suben
la calidad y traen los tableros actuales de Marketing y Ventas como "widgets
nativos".

---

## 1. Qué es y por qué

Hoy el producto tiene dos tableros armados a mano (Marketing, Ventas: unas 25
gráficas, ~4 000 líneas) y un asistente de IA que responde y dibuja gráficas
**efímeras** en el chat. Cada cliente pregunta cosas distintas (PRODUCT.md: el
de marketing, el de ventas y el director leen los mismos datos pero preguntan
otra cosa), y cada gráfica nueva hoy es trabajo de desarrollo.

El objetivo es que **cada cliente arme su propio panel sin un desarrollador**,
y que ese panel diga la verdad con la misma precisión que los tableros hechos a
mano. La segunda mitad es la difícil: una gráfica generada por IA que da un
número distinto del tablero de Ventas para la misma pregunta destruye la
confianza en ambos.

## 2. Lo que ya existe y se reutiliza

La investigación del código cambió el diseño en varios puntos. Esto es lo que
hay que saber antes de construir:

| Hallazgo | Archivo | Consecuencia para el diseño |
|---|---|---|
| El agent loop corre **en el navegador**, un turno de Anthropic por request; las herramientas se ejecutan localmente sobre el dataset que el navegador ya tiene. | `hooks/use-agent-loop.ts`, `app/api/chat/route.ts` | Las herramientas del panel se suman a ese mismo loop. No hace falta un backend de agentes nuevo. |
| `aggregate` y `relate` ya son, en la práctica, un **lenguaje de consultas** (entidad, filtros, groupBy, métrica, cruce por contacto). | `lib/ai-tools.ts` L1454-1712 | El motor de widgets **nace de refactorizar esas funciones**, no se escribe en paralelo. Una sola implementación evita que el chat y el panel den números distintos. |
| `render_chart` recibe **números literales** que escribió el modelo (`series: [{label, value}]`). | `lib/ai-tools.ts` L520, `chat-chart.tsx` | Eso **no se puede persistir**: quedaría congelado en la fecha en que se creó. El widget guardado tiene que ser una consulta. |
| `relate(from: appointments, to: opportunities, groupBy: stage)` cuenta **oportunidades**, no citas. Y el prompt lo enseña como la respuesta a "citas por etapa de la oportunidad". | `lib/ai-tools.ts` L1649, `lib/ai-context.ts` L264 | El ejemplo exacto del dueño hoy da otro número: un contacto con 3 citas y 1 oportunidad suma 1, no 3. El motor necesita un **join de búsqueda** (cada cita toma un atributo de la oportunidad de su contacto), ver §6.4. |
| Los tableros cuentan "ganada" con `isWonOpp` (status `won` **o** etapa tipo "Negocio Ganado"); los filtros de la IA usan `status === "won"`. | `lib/opportunity-status.ts`, `applyOppFilters` | Ya hay una inconsistencia entre el asistente y el tablero en las cuentas que registran la venta por etapa. La capa semántica define "ganada" una sola vez con `isWonOpp`. **Esto cambia las respuestas del asistente actual**: avisar cuando se haga. |
| Las citas solo cubren **±90 días**; los mensajes son una **muestra**; `calls` siempre viene vacío. | `lib/sync.ts` L298-321, CLAUDE.md | Mensajes y llamadas **no** son fuente de widgets. Un widget de citas con periodo fuera de ±90 días lo dice en la tarjeta (mismo espíritu que `isWindowClipped`). |
| El gasto de Meta tiene reglas que costó mucho descubrir: recorte de ventana en ambos sentidos, CPL con leads del CRM, sin dimensión de pipeline. | `lib/ads.ts`, `ads-section.tsx`, CLAUDE.md | Las métricas de Meta se exponen como **métricas semánticas** que llaman a `lib/ads.ts` tal cual. El modelo nunca compone un CPL por su cuenta. |
| Ya existen el chrome de las gráficas (`ChartCardHeader`, `ScopePill`, `NonZeroTooltipContent`, `CHART_PALETTE`) y el drill-down (`ChartDrillDrawer`). | `dashboard-ui.tsx`, `chart-drill-drawer.tsx` | Los widgets se ven idénticos a los tableros actuales y son clicables hasta los registros sin código de UI nuevo. |
| Neon ya es obligatorio (roster + tokens); hay migración idempotente y scripts `verify:*`. | `lib/db.ts`, `scripts/db-migrate.ts` | El panel guardado vive en la misma base, con el mismo patrón: tabla nueva en `db-migrate.ts` y `pnpm verify:widgets`. |
| La sesión identifica al **cliente**, no a la persona (`<clientId>.<exp>.<hmac>`). Solo el SSO trae `userId`/`userName`. | `lib/auth.ts`, `lib/ghl-sso.ts` | El panel es **por cliente**, compartido por todos los que entran a esa subcuenta (ver preguntas). |
| Los tableros actuales son dos componentes monolíticos (2 537 y 1 497 líneas). | `marketing-dashboard.tsx`, `sales-dashboard.tsx` | Convertirlos en widgets finos es caro. Fase 3: primero se envuelven completos como widget nativo de pestaña entera y luego se extraen piezas una por una. |

## 3. Metas, no-metas y anti-metas

### Metas
1. **Panel vacío + IA como entrada.** Primer ingreso: lienzo vacío, una caja
   "¿Qué quieres ver?" y sugerencias calculadas con los datos de esa cuenta.
2. **Cualquier pregunta razonable sobre los datos sincronizados se vuelve un
   widget**: KPI, barras, línea, embudo, tabla, lista de registros, etc.
3. **Persistencia.** Pestañas y widgets se guardan en Neon por cliente y se
   recalculan con datos frescos en cada visita.
4. **Edición por IA.** Crear, modificar, mover, cambiar tamaño, borrar widgets;
   crear, renombrar y borrar pestañas. Todo se puede **deshacer**.
5. **La IA tiene contexto de todo**: dataset, catálogo de campos y métricas,
   el panel actual completo, el widget seleccionado, los filtros activos y lo
   que cada widget está mostrando ahora.
6. **Mismos números que los tableros a mano** para la misma pregunta.
7. **Filtros** globales extensibles, por gráfica (fechas y cualquier campo) y
   entre objetos ("contactos con negocio perdido"), que se agregan a mano o
   hablando.

### No-metas (por ahora)
- Paneles por usuario (no hay identidad de usuario con login por contraseña).
- Arrastrar y soltar libre en 2D (fase 4; ver §11).
- Datos fuera del sync (llamadas, el historial completo de mensajes, notas).
- Escribir en GHL. La app sigue siendo de solo lectura.
- Compartir paneles entre clientes / marketplace de plantillas.

### Anti-metas (si pasa esto, fracasó aunque "funcione")
- **Un número que no cuadra** con el tablero de Ventas/Marketing para la misma
  definición.
- **Una gráfica guardada que miente por omisión**: congelada sin decirlo, con
  un periodo distinto al que dice, o con un cero donde en realidad no hay datos.
- **Convertirse en una herramienta de BI pesada** (anti-referencia explícita de
  PRODUCT.md / DESIGN.md): paneles de filtros por todos lados, menús de estilo,
  colores configurables. La IA elige la forma de la gráfica y su tamaño; el
  estilo lo fija el sistema de diseño.
- **La IA ejecutando código o SQL que ella misma escribió.**
- **Los clientes actuales pierden su Marketing/Ventas** el día del lanzamiento.

## 4. Experiencia

### 4.1 Primer ingreso (panel vacío)

```
┌──────────────────────────────────────────────────────────────────┐
│ ▣ Lezgo Suite Analíticas · Hausmen            Actualizado hace 3m │
├──────────────────────────────────────────────────────────────────┤
│  + Pestaña                                          Asistente IA │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                      ¿Qué quieres ver?                           │
│     ┌────────────────────────────────────────────────────────┐   │
│     │ Ej. "las citas organizadas por etapa del pipeline"   ➤ │   │
│     └────────────────────────────────────────────────────────┘   │
│     [Leads por fuente este mes]  [Citas por etapa]  [Embudo]     │
│     [¿Cuánto me cuesta cada lead?]  [Ventas por asesor]          │
│                                                                  │
│          o empieza con un panel armado:  Marketing · Ventas      │
└──────────────────────────────────────────────────────────────────┘
```

- Las sugerencias se calculan con los datos (función pura): "¿Cuánto me
  cuesta cada lead?" solo aparece si `ads.status === "connected"`; "Citas por
  etapa" solo si hay citas; las de pauta solo si hay registros de pauta.
- "Marketing · Ventas" son plantillas (fase 1: plantillas genéricas; fase 3:
  los tableros reales como widgets nativos).
- Al enviar la primera pregunta, la caja se convierte en el **copiloto lateral**
  y el widget aparece en la cuadrícula.

### 4.2 Panel con copiloto

```
┌───────────────────────────────────────────────┬──────────────────┐
│ Marketing │ Ventas │ Citas │ +                │ Copiloto       × │
│ [Fechas: últimos 30 días ▾] [Pipeline: Todos ▾]│                  │
├───────────────────────────────────────────────┤ Tú: citas por    │
│ ┌────────┐┌────────┐┌────────┐┌────────┐      │ etapa del        │
│ │Leads   ││Citas   ││CPL     ││Ganadas │      │ pipeline         │
│ │ 412 ▲8%││ 96     ││ $218   ││ 14     │      │                  │
│ └────────┘└────────┘└────────┘└────────┘      │ IA: Listo, agre- │
│ ┌───────────────────────┐┌──────────────────┐ │ gué "Citas por   │
│ │Citas por etapa   ✨ ⋯ ││Leads por semana  │ │ etapa". Cuento   │
│ │ ▇▇▇▇▇▇▇ Primera cita  ││   ╱╲_╱‾╲         │ │ las citas de los │
│ │ ▇▇▇▇ Propuesta        ││                  │ │ últimos 30 días  │
│ │ ▇▇ Sin oportunidad    ││                  │ │ según la etapa…  │
│ │ ⓘ etapa de la oportunidad más reciente   │ │ [Deshacer]       │
│ └───────────────────────┘└──────────────────┘ │ [Escribe…      ➤]│
└───────────────────────────────────────────────┴──────────────────┘
```

- **ⓘ / ScopePill** en cada widget, generado por código (`describeWidget`)
  a partir del spec: fuente, métrica, regla de unión, periodo. Es la defensa
  principal contra que la IA elija mal la base de fecha o la regla de unión,
  porque la regla queda **visible** para el usuario.
- **✨ Editar con IA** abre el copiloto con ese widget seleccionado (chip
  "Editando: Citas por etapa"); "hazla mensual" ya sabe de qué widget se habla.
- **⋯ menú manual mínimo**: Editar con IA · Tamaño · Mover · Duplicar · Ver
  datos (tabla) · Exportar CSV · Eliminar. Nada más (DESIGN.md: "hide machinery").
- **Deshacer** después de cada cambio (de la IA o manual), como toast y como
  botón en la respuesta del copiloto. Fase 2: panel de historial.
- **Filtros globales extensibles** (§6.6). La barra de arriba conserva fecha y
  pipeline y se le pueden **agregar** más filtros (asesor, fuente, plataforma,
  tags, campos personalizados, estado de la oportunidad…), a mano con
  "+ Filtro" o pidiéndoselo a la IA:

  ```
  [Fechas: últimos 30 días ▾] [Pipeline: Todos ▾] [Asesor: Ana ×] [Fuente: Meta ×] [+ Filtro]   Restablecer · Guardar como predeterminado
  ```

- **Filtros por gráfica.** Cada widget puede fijar su propio periodo ("citas
  de esta semana" siempre es esta semana) y sus propios filtros, también entre
  objetos ("contactos con alguna oportunidad perdida"). Se editan desde ⋯ →
  "Filtros y fechas" o hablando. Los filtros propios se ven como chips bajo el
  título de la tarjeta.

### 4.3 Flujos típicos que el diseño debe resolver

| El usuario dice | Qué hace la IA |
|---|---|
| "las citas organizadas por oportunidades de pipeline" | `ask_user` solo si hay ambigüedad real (¿etapa o pipeline?) → `preview_widget` → `create_widgets` con `source: appointments`, `groupBy: opportunity.stage` (join `latest`) → responde en una línea con la regla usada. |
| "hazme un panel de ventas" | Caso 5 de "Cuándo preguntar" del prompt actual (pedido amplio sin foco): pregunta el foco → `upsert_tab` "Ventas" → `create_widgets` con 6-8 widgets en una sola llamada → `arrange_tab`. |
| "hazla mensual y solo del pipeline Inversionistas" | `update_widget` sobre el seleccionado: bucket `month`, filtro `pipeline`. |
| "pon los números arriba" | `arrange_tab` reordenando los KPI al principio. |
| "¿por qué bajaron las citas esta semana?" | `get_widget_data` → `relate`/`search_conversations` (herramientas actuales) → responde; opcionalmente agrega una nota. |
| "borra la pestaña de pruebas" | `ask_user` para confirmar (operación destructiva grande) → `delete_tab`. |
| "regrésalo como estaba ayer" | Fase 2: `list_versions` → `restore_version`. |

## 5. Arquitectura

```
                        ┌───────────────── navegador ─────────────────┐
 usuario ── copiloto ──▶│ useAgentLoop (existente)                    │
                        │   ├─ herramientas de datos (existentes)     │
                        │   └─ herramientas del panel (nuevas) ───┐   │
                        │                                         ▼   │
                        │  useDashboardDoc ── estado del panel (doc)  │
                        │        │                                    │
                        │        ▼                                    │
                        │  lib/widgets/engine.ts  (puro, determinista)│
                        │   runQuery(spec, dataset, filtros) → filas  │
                        │        │                                    │
                        │        ▼                                    │
                        │  components/widgets/* (Recharts + chrome    │
                        │  existente + ChartDrillDrawer)              │
                        └────────┬───────────────────────┬────────────┘
                                 │ PUT/GET               │ POST
                                 ▼                       ▼
                     /api/dashboards (nuevo)       /api/chat (existente)
                     requireClient() + zod         + herramientas nuevas
                     + versión optimista           + snapshot del panel
                                 │
                                 ▼
                     Neon: dashboard_doc, dashboard_doc_version
```

Módulos nuevos (nombres sugeridos):

| Módulo | Responsabilidad | Puro / cliente-seguro |
|---|---|---|
| `lib/widgets/spec.ts` | Tipos + esquema zod de `DashboardDoc`/`WidgetSpec`; JSON Schema derivado para las herramientas; `schemaVersion` y migración al leer. | Sí |
| `lib/widgets/semantic.ts` | El catálogo: fuentes, dimensiones (incluidas las relacionadas y `cf:`), métricas, operadores. Una sola definición de "ganada" y "de pauta", y las tres de "lead" con nombre propio (§6.3). | Sí |
| `lib/widgets/engine.ts` | `runQuery`: filtra, une, agrupa, calcula métricas, aplica periodo y alcance de pipeline, devuelve filas + ids de registros por fila + advertencias. | Sí |
| `lib/widgets/validate.ts` | Validación semántica (§6.5) con mensajes accionables para el modelo. | Sí |
| `lib/widgets/describe.ts` | `describeWidget(spec)` → texto en español para el ScopePill **y** para el snapshot que ve la IA. Una función, dos usos. | Sí |
| `lib/widgets/suggestions.ts` | Sugerencias del panel vacío según los datos. | Sí |
| `lib/dashboard-store.ts` | Lectura/escritura del doc en Neon, versionado, recorte del historial. Server-only (como `sync-store.ts`). | No |
| `app/api/dashboards/route.ts` | GET doc, PUT doc (con versión esperada), POST restore. | No |
| `hooks/use-dashboard-doc.ts` | Estado del doc en el cliente, mutaciones optimistas, deshacer. | — |
| `components/widgets/*` | `WidgetCard`, un componente por tipo de gráfica, `WidgetGrid`, `EmptyPanel`, `CopilotDock`. | — |

`aggregate` y `relate` se **reescriben encima del motor** (misma salida que hoy
más los arreglos de §2). Esa es la garantía de que el chat y el panel no se
separen con el tiempo; CLAUDE.md ya documenta este tipo de deriva con
`syncProject`.

## 6. El núcleo: la especificación del widget

### 6.1 Principio: se guarda la pregunta, no la respuesta

- El doc guarda **consultas declarativas**, nunca filas ni números. Así cada
  visita muestra datos frescos, el doc no acumula datos personales (mismo
  espíritu que "la caché es desechable") y su tamaño es pequeño.
- **Ningún número de un widget guardado lo escribe el modelo.** Lo calcula
  `engine.ts`. La única excepción es el widget `text` (una nota), que se
  muestra con su fecha de creación porque puede envejecer.
- **Cero ejecución de código del modelo.** Ni `eval`, ni SQL, ni sandbox. El
  modelo arma un JSON contra un catálogo cerrado.

### 6.2 Forma del documento

```ts
interface DashboardDoc {
  schemaVersion: 1
  tabs: Tab[]                 // orden = orden de las pestañas
  filters: PanelFilters       // filtros globales (§6.6)
  glossary: GlossaryEntry[]   // lo que este cliente quiere decir con sus términos (§6.7)
}

interface PanelFilters {
  defaultDate: RangePreset | null      // null = el comportamiento de hoy ("Todo", o el último mes en cuentas grandes)
  defaultPipelines: string[]           // ids; [] = todos
  controls: FilterControl[]            // filtros agregados a la barra, además de fecha y pipeline (≤8)
}

// Dos tipos de control en la barra:
//  - "field": un campo con selección múltiple de valores ("Asesor: Ana, Luis")
//  - "condition": una condición con nombre que se prende o apaga ("Perdidos"), útil
//    cuando el concepto combina varios campos (estado O etapa, §6.7)
interface FilterControl {
  id: string
  kind: "field" | "condition"
  entity: EntityId                     // a qué objeto pertenece
  label: string                        // texto del chip: "Asesor", "Perdidos"
  field: string | null                 // solo "field": "assignedTo", "source", "cf:Origen de Lead"…
  defaultValues: string[]              // solo "field"; [] = todos
  clause: FilterClause | null          // solo "condition"
  defaultOn: boolean                   // solo "condition"
}

interface GlossaryEntry {
  id: string
  term: string                         // "perdido", "cliente activo", "lead calificado"
  aliases: string[]                    // "perdidos", "negocio perdido"
  entity: EntityId
  meaning: FilterClause[]              // lo que el cliente eligió (AND de cláusulas)
  note: string                         // en palabras: "estado perdida o etapa «Negocio Perdido»"
  createdAt: string
}

type EntityId = "contact" | "opportunity" | "appointment" | "task" | "pauta"

interface Tab {
  id: string                  // generado por el cliente (nanoid corto), nunca por el modelo
  title: string
  widgets: Widget[]           // orden = orden en la cuadrícula
}

interface Widget extends WidgetSpec {
  id: string
  createdAt: string
  createdBy: "ai" | "user"
  updatedAt: string
}

// Lo que el modelo produce. Todos los campos son requeridos; "no aplica" = null.
// (Así el esquema funciona con strict: true, ver §8.3.)
interface WidgetSpec {
  title: string
  subtitle: string | null
  viz: VizType                         // §7
  size: "s" | "m" | "l" | "xl"         // 3 / 6 / 8 / 12 columnas de 12
  height: "compact" | "normal" | "tall"
  query: QuerySpec | null              // null solo para viz "text"
  text: string | null                  // contenido de viz "text" (markdown corto)
  target: number | null                // meta para viz "meter"
  nativeId: string | null              // fase 3: widget nativo (ver §7.3)
  prompt: string                       // la petición del usuario que originó el widget
}

interface QuerySpec {
  source: "contacts" | "opportunities" | "appointments" | "tasks" | "pautas" | "ads_daily"
  metrics: Array<{ metric: MetricId; label: string | null }>          // 1..3
  groupBy: Array<{
    dimension: string                 // "stage" | "cf:Origen de Lead" | "opportunity.stage" | "createdAt" …
    bucket: "day" | "week" | "month" | "quarter" | "weekday" | "hour" | null  // solo dimensiones de fecha
    join: "latest" | "each" | null    // solo dimensiones relacionadas (§6.4)
  }>                                                                   // 0..2
  filters: FilterClause[]             // campos propios de la fuente; AND entre cláusulas
  relatedFilters: RelatedFilterSpec[] // filtros entre objetos (§6.6), 0..4
  time: {
    field: string                     // "createdAt" | "closedAt" | "startTime" | "dueDate" | "date"
    range: "inherit" | RangePreset | "absolute"
    from: string | null               // ISO, solo con "absolute"
    to: string | null
    compare: "none" | "previous_period" | "previous_year"  // deltas de KPI
  }
  globalFilters: "inherit" | "ignore" // ¿aplican el pipeline y los filtros agregados del panel? (la fecha la decide time.range)
  sort: { by: "value" | "label" | "natural"; dir: "asc" | "desc" }    // natural = orden de etapas del pipeline / cronológico
  limit: number | null                // top N; el resto se junta en "Otros"
}

interface FilterSpec { field: string; op: FilterOp; values: string[] }   // OR dentro de values

// Una cláusula = OR de condiciones, posiblemente sobre CAMPOS DISTINTOS.
// Los filtros son una conjunción de cláusulas (forma normal conjuntiva, un solo nivel):
// [{anyOf:[status eq lost, stage in ["Negocio Perdido"]]}, {anyOf:[pipelineName eq "Ventas"]}]
// = (perdida por estado O por etapa) Y pipeline Ventas.
interface FilterClause { anyOf: FilterSpec[] }                         // 1..5 condiciones

// "Registros cuyo contacto tiene alguna/ninguna <entidad> que cumpla TODAS las cláusulas".
// Las cláusulas se evalúan sobre el MISMO registro relacionado (§6.6).
interface RelatedFilterSpec {
  entity: EntityId
  quantifier: "any" | "none"
  conditions: FilterClause[]          // 0..5; [] = "tiene alguna / no tiene ninguna"
}

type FilterOp = "eq" | "neq" | "in" | "not_in" | "contains" | "is_empty" | "is_not_empty"
              | "gt" | "gte" | "lt" | "lte"
type RangePreset = "today" | "last_7d" | "last_30d" | "last_90d" | "this_week" | "this_month"
                 | "last_month" | "this_quarter" | "ytd" | "next_7d" | "next_30d" | "all"
```

Guardar `prompt` (la petición original) le da a la IA la intención cuando más
tarde le piden "ajústala": sabe *para qué* existía el widget.

### 6.3 Capa semántica (el catálogo)

El modelo no inventa fórmulas: elige de aquí. Cada entrada se implementa una
vez, reutilizando las funciones de dominio existentes.

**Fuentes**: `contacts`, `opportunities`, `appointments`, `tasks`, `pautas`,
`ads_daily` (días de Meta a nivel cuenta). Mensajes y llamadas quedan fuera:
mensajes es una muestra y llamadas siempre viene vacío. Un widget sobre una
muestra contaría mal sin decirlo.

**Dimensiones** por fuente:
- Campos nativos (los que hoy acepta `aggregate.groupBy`: `source`,
  `attributionMedium`, `adType`, `adId`, `attributionUrl`, `assignedTo`,
  `status`, `stage`, `pipelineName`, `tags`, `lostReason`, `tipo`, …).
- Campos personalizados `cf:<Nombre>` (contactos, oportunidades) con el
  despliegue por opción que ya existe.
- Derivadas: `dePauta` (`isDePauta`), `campaignResolved`
  (`resolveCampaignName`), `won` (`isWonOpp`, la definición que ya usan los
  tableros), y `funnelState`: la etapa
  actual si la oportunidad está abierta (sin contar las etapas cuyo nombre
  indica venta), o "Ganado" / "Abandonado" / "Perdido". Es la misma regla de
  "Estado actual del embudo por etapa" (`sales-dashboard.tsx` L425-465).
  **[Decisión mía]** La dimensión `stage` sigue siendo la etapa **cruda** de
  GHL, como hoy en `aggregate`; `funnelState` es la que usa el `funnel`.
- Fecha con bucket: `createdAt|closedAt|startTime|dueDate|date` × `day|week|
  month|quarter|weekday|hour`.
- **Relacionadas por contacto** (§6.4): `opportunity.stage`,
  `opportunity.pipelineName`, `opportunity.status`, `opportunity.assignedTo`,
  `contact.source`, `contact.attributionMedium`, `contact.cf:<Nombre>`,
  `pauta.campaign`.

**Métricas** (`MetricId`). Las razones se calculan siempre a partir de sus
componentes sumados y nunca promediando razones (la misma regla que
`sumAdDays`):

| Métrica | Definición | Reutiliza |
|---|---|---|
| `count` | filas | — |
| `contacts` | contactos distintos | — |
| `leads_contacts` | **Leads = contactos creados.** Es el significado por defecto de "leads" (así lo trata hoy el prompt) | `Contact.createdAt` |
| `leads_pauta_opps` | **Leads de pauta = oportunidades de pauta creadas.** Es el denominador del CPL de `AdsSection` | `isDePauta` sobre el historial sin filtrar |
| `leads_pauta_unique` | **Leads únicos de pauta = pautas − reingresos** (el "Leads únicos" de Marketing) | lógica de reingresos de `marketing-dashboard.tsx` |
| `value_sum` / `value_avg` | valor de oportunidad | `Opportunity.value` |
| `won_count` / `won_value` | ganadas | `isWonOpp` |
| `win_rate` | ganadas ÷ total (idéntica al KPI "Conversión" de Ventas) | `sales-dashboard.tsx` L189 |
| `appointment_rate` | "conversión a cita": copiar la definición exacta del tablero de Ventas | `sales-dashboard.tsx` (~L340, L537) |
| `show_rate` | citas asistidas ÷ citas (los estados varían por cuenta: se resuelven con `list_values`) | — |
| `overdue_tasks` | tareas pendientes vencidas | misma regla que `overdue` en `applyTaskFilters` |
| `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm` | Meta, recalculadas desde las sumas | `sumAdDays` |
| `cpl`, `cost_per_appointment`, `roas` | gasto ÷ `leads_pauta_opps` creadas dentro de la ventana de gasto, etc., con el **mismo** recorte de ventana que `AdsSection` (`ads-section.tsx` L312-376) | `adsWindow`, `firstRecordedDay`, `costPer` |

Las métricas de Meta **ignoran todos los filtros de CRM** (pipeline y filtros
agregados; solo respetan la fecha) y la tarjeta lo dice con un aviso
equivalente a `PipelineScopeNotice`. Es la misma regla de hoy generalizada
(CLAUDE.md, "Meta spend has NO pipeline dimension"): Meta no tiene asesor,
etapa ni campo personalizado, así que filtrar solo el denominador infla el
costo por lead.

**"Leads" tiene tres significados en el código, y el catálogo los mantiene
separados con nombre propio** en lugar de prometer uno solo. **[Decisión mía]**
Cuando el usuario dice "leads" sin más contexto, se usa `leads_contacts`. En un
contexto de costo (CPL, "¿cuánto me cuesta cada lead?") se usa
`leads_pauta_opps`, y la tarjeta lo dice ("leads = oportunidades de pauta").
"Leads únicos" o "reingresos" llevan a `leads_pauta_unique`. Las tres
definiciones aparecen en el ScopePill, así que nunca hay que adivinar cuál se
usó.

**Regla de paridad (cuando dos reglas chocan).** **[Decisión mía]** Una
métrica que **ya existe con nombre** en un tablero hecho a mano se replica
**exactamente** como la calcula ese tablero, incluida su ventana de fechas.
Ejemplo: la "conversión a cita" de Ventas (`sales-dashboard.tsx` ~L340) cuenta
las oportunidades cuyo contacto tiene una cita **dentro del periodo activo**
(las citas filtradas por `startTime`, que además solo cubren ±90 días), y
`appointment_rate` hace lo mismo. El invariante 6 (uniones contra el conjunto
sin filtrar) rige las **dimensiones de búsqueda** de §6.4 (qué etapa le toca a
una cita), no la réplica de métricas ya publicadas. Si alguien cree que la
definición de un tablero está mal, se corrige **en ambos lados en el mismo
cambio**. Nunca se deja que diverjan.

### 6.4 Uniones entre entidades (el ejemplo del dueño)

"Citas organizadas por etapa del pipeline" significa: **cada cita** se agrupa
por un atributo de **la oportunidad de su contacto**. Es un *join de búsqueda*
(muchos → uno), no el `relate` actual (que cuenta el lado de destino).

El problema es que un contacto puede tener varias oportunidades. La regla
tiene que ser explícita en el spec y visible en la tarjeta:

| `join` | Comportamiento | Cuándo |
|---|---|---|
| `latest` **(por defecto)** | Cada cita toma la oportunidad **más reciente** de su contacto. Si hay filtros de oportunidad activos (pipeline o filtros agregados sobre la oportunidad), la más reciente **entre las que pasan esos filtros**. La suma de las barras = número de citas. | Casi siempre. |
| `each` | Cada cita cuenta una vez **por cada** oportunidad del contacto. Las barras pueden sumar más que el total y la tarjeta lo dice. | Cuando el usuario quiere "todas las oportunidades involucradas". |

- Las filas sin oportunidad caen en el grupo **"Sin oportunidad"**, nunca se
  descartan en silencio.
- El candidato a "más reciente" sale de **todas** las oportunidades, no de las
  filtradas por fecha (mismo invariante que `allOpportunities` en los
  drill-downs y que `contactIdsInPipelines`).
- **[Decisión mía]** `latest` por defecto. El constructor debería **medir**
  en 2 o 3 cuentas reales qué fracción de contactos tiene más de una
  oportunidad (amir-cherit, con 23 pipelines, es el caso extremo). Si es alta,
  la tarjeta debe decir cuántas citas tenían más de una oportunidad candidata.

### 6.5 Validación en tres capas

1. **Estructural (API de Anthropic)**: `strict: true` en las herramientas que
   escriben specs garantiza que el JSON cumple el esquema (§8.3).
2. **Semántica (navegador, antes de guardar)**: `validate.ts` comprueba que el
   campo exista en esa fuente, que la métrica sea compatible, que el `viz`
   encaje con la forma de la consulta (una línea necesita una dimensión de
   fecha; un embudo, una dimensión de etapa; una dona, ≤5 grupos; las series,
   ≤6) y que exista el campo personalizado. Los errores vuelven al modelo como
   `tool_result` con `is_error` y una corrección sugerida ("`cf:Origen` no
   existe; ¿quisiste `cf:Origen de Lead`?"). El modelo corrige solo, como un
   compilador.
3. **Servidor (PUT)**: el mismo esquema zod, más límites de tamaño, más el
   tenant tomado **solo** de `requireClient()`. El servidor nunca confía en
   lo que mandó el navegador.

Un widget guardado que deja de poder calcularse (alguien renombró el campo en
GHL) muestra **"No se pudo calcular: el campo X ya no existe. Pídele a la IA
que la ajuste"**. Nunca muestra un cero ni una tarjeta en blanco.

### 6.6 Filtros: globales, por gráfica y entre objetos

Hay tres capas y todas usan el mismo motor.

| Capa | Dónde vive | Quién la cambia | Ejemplo |
|---|---|---|---|
| **Global** (barra del panel) | Los controles y sus valores predeterminados se guardan en `doc.filters`. Los valores **elegidos ahora** son de la sesión | El usuario ("+ Filtro", chips) o la IA (`set_panel_filters`, `apply_filters`) | Fecha, Pipeline, Asesor = Ana, Fuente = Meta |
| **Por gráfica** | `query.time`, `query.filters` y `query.relatedFilters` del widget, guardados | El usuario (⋯ → "Filtros y fechas") o la IA (`update_widget`) | "Siempre el mes pasado", "solo el pipeline Ventas" |
| **Entre objetos** | `query.relatedFilters` (por gráfica) o un control global cuyo `entity` no es la fuente del widget | Igual que arriba | "Contactos con alguna oportunidad perdida" |

**Filtros entre objetos.** El contacto es el puente, como en todo el producto.
"Contactos con negocio perdido" =
`source: contacts` + `relatedFilters: [{ entity: "opportunity", quantifier: "any", conditions: [<lo que signifique "perdido" en esta cuenta>] }]`. Qué significa "perdido" no lo decide el código: lo razona la IA con los datos de la cuenta y, si hay más de una lectura, lo pregunta (§6.7).
- **`any` / `none`**: "tiene alguna" o "no tiene ninguna". "Contactos con
  cita pero sin oportunidad" = dos filtros relacionados, `appointment any []`
  y `opportunity none []`.
- **Las condiciones se evalúan sobre el mismo registro relacionado.**
  "Contactos con una oportunidad perdida en el pipeline Ventas" exige una
  oportunidad que sea perdida **y** esté en Ventas. Un contacto con una
  oportunidad perdida en otro pipeline y una abierta en Ventas **no** pasa.
  Evaluar cada condición por separado daría ese falso positivo.
- **Los registros relacionados salen del conjunto completo**, no del filtrado
  por fecha. Es el mismo invariante que `contactIdsInPipelines`: la fecha del
  panel filtra la fuente del widget (los contactos, por su fecha de creación),
  no a sus oportunidades. Para "perdidas este mes", la condición lleva su
  propia fecha (`closedAt gte …`).
- **Los registros sin contacto se descartan** mientras haya un filtro entre
  objetos activo, igual que hoy con el filtro de pipeline: no se pueden
  atribuir a nada.

**Filtros globales.** Fecha y pipeline siempre están; se pueden agregar hasta
8 controles más. Un control es de tipo `field` (un campo con valores a
elegir: "Asesor: Ana, Luis") o `condition` (una condición con nombre que se
prende o apaga, como "Perdidos" cuando en esa cuenta significa estado **o**
etapa, §6.7). Cada control pertenece a un objeto (`entity`) y se aplica a cada
widget según su fuente:
- si el objeto es la fuente del widget, filtra directo;
- si es otro objeto, se aplica como filtro entre objetos con `any` (el filtro
  de pipeline de hoy ya funciona exactamente así, y pasa a ser un caso
  particular de esta regla);
- en `ads_daily` (Meta) **no se aplica** y la tarjeta lo dice.

**Reglas de convivencia** (todas **[Decisión mía]**):
- Un widget hereda los filtros globales salvo que tenga
  `globalFilters: "ignore"`; la fecha la decide `time.range`.
- Si un widget filtra un campo que también filtra un control global, **gana
  el del widget** para ese campo y su chip dice "fijo". Así una gráfica
  "siempre del pipeline Ventas" no se queda vacía cuando el panel elige otro
  pipeline.
- Los valores elegidos en la barra son de la sesión: cada visita empieza con
  los predeterminados guardados. "Guardar como predeterminado" los persiste
  para todos (el panel es compartido) y se puede deshacer. **Agregar o quitar
  un control** sí se guarda en el panel.
- Cuando la IA filtra "por ahora" ("muéstrame solo lo de Ana") usa
  `apply_filters`, y si el campo no tenía control aparece un chip
  **temporal**, marcado como tal, con la opción "Fijar". Cuando le piden un
  filtro permanente ("agrega un filtro de asesor") usa `set_panel_filters`.
- Las pestañas clásicas Marketing y Ventas siguen recibiendo solo fecha y
  pipeline, como hoy. Los controles agregados aplican a las pestañas del panel.
- La pestaña Asistente IA sigue viendo todo el dataset sin filtrar.

### 6.7 Conceptos de negocio ambiguos: la IA razona, pregunta y recuerda

Los usuarios hablan con conceptos de su negocio ("perdidos", "clientes
activos", "leads calificados", "vendidos", "citas efectivas", "VIP", "fríos") y
cada cuenta guarda esos conceptos en lugares distintos. "Perdido" puede ser el
**estado** de GHL, una **etapa** como "Negocio Perdido", un **tag**, un
**campo personalizado** ("Estatus = Perdido") o un **motivo de pérdida**.
"Cliente activo" puede ser la etapa "Cliente Activo", el tag "activo" o las
oportunidades ganadas. **El código no fija qué significa cada palabra.** La IA
lo razona con los datos de esa cuenta, y cuando hay más de una lectura con
resultados distintos, pregunta. El ejemplo del dueño ("contactos con negocio
perdido" → "¿perdido por estado, por la etapa «Negocio Perdido» o ambos?") es
un caso de este mecanismo, no una regla aparte.

**1. Buscar evidencia: herramienta `resolve_term`.** Recibe el término y
devuelve dónde aparece en los datos de la cuenta:
- Busca en los valores de: estado de oportunidad, etapas, pipelines, motivos
  de pérdida, fuentes y plataformas, tags, opciones de campos personalizados
  (contacto y oportunidad), estados de cita y de tarea, tipos de pauta. También
  busca en los **nombres** de campos personalizados ("temperatura" → el campo
  "Temperatura del lead" con sus opciones).
- La coincidencia ignora mayúsculas y acentos y usa raíces ("perdidos",
  "perdida" y "Prospectos perdidos" comparten "perdid"). Los valores en inglés
  de GHL se comparan también con su etiqueta en español (`lost` = "perdida",
  `showed` = "asistió", `noshow` = "no asistió", `won` = "ganada"…). Es una
  **traducción** de los enums de GHL, no un criterio de negocio.
- Por cada candidato devuelve: objeto, campo, valores, la condición lista para
  usar, cuántos registros y contactos cumplen, y el **traslape** entre los
  principales (cuántos contactos cumplen ambos, solo uno, solo el otro), más el
  conteo de la unión.
- Devuelve una pista `materiallyDifferent`: hay ≥2 candidatos con volumen
  relevante (≥3 registros y ≥5% del mayor) y su traslape es bajo (Jaccard
  < 0.9). Es una pista: la decisión la toma el modelo.

**2. Razonar y decidir si preguntar.** Es una regla nueva en "Cuándo
preguntar", la 6, generalizada y **sin tocar** las cinco existentes.

> Antes de filtrar por un concepto de negocio que el usuario nombró, revisa el
> glosario del cliente. Si no está, usa `resolve_term` (y `list_values` si hace
> falta) y razona qué lecturas son plausibles.
> - Si hay una sola lectura, o las lecturas casi coinciden en los mismos
>   registros, úsala y dila en una línea.
> - Si hay varias lecturas que darían resultados materialmente distintos,
>   pregunta con `ask_user`: una opción por lectura, con los nombres reales
>   ("Por la etapa «Negocio Perdido»") y el conteo en el `hint`, más "Todas las
>   anteriores" cuando combinarlas tenga sentido.
> - Si no hay ninguna lectura, dilo y ofrece explorar los valores. **Nunca
>   inventes un criterio.**

El traslape importa para no preguntar de más. Si "perdido por estado" y
"perdido por etapa" son en el 97% los mismos contactos, preguntar es ruido.

**3. Recordar: el glosario del cliente.** Después de que el usuario elige, la
IA guarda la elección con `save_term`: el término, sus alias, el objeto, el
significado como cláusulas y una nota en palabras. La siguiente vez que
alguien diga "perdidos" en esa cuenta, la IA usa el glosario sin preguntar y
lo dice ("uso tu definición de «perdido»: estado perdida o etapa «Negocio
Perdido»"). Si el usuario corrige ("no, solo por estado"), la IA actualiza la
entrada. El glosario viaja en el snapshot de cada turno (§9.1), así que no
rompe la caché.
- **Definiciones del producto.** Lo que los tableros ya definen ("ganada" =
  `isWonOpp`, "de pauta" = `isDePauta`, las tres métricas de leads de §6.3)
  funciona como glosario de fábrica. La IA lo usa sin preguntar (regla de
  paridad) y dice cuál usó. Si el cliente quiere otro significado ("para
  nosotros ganada es solo el estado"), se guarda en su glosario y gana el del
  cliente.
- **[Decisión mía]** Los widgets guardan las condiciones **expandidas**, no
  una referencia al término. Un widget siempre significa lo mismo, aunque el
  glosario cambie después. Si el usuario redefine un término, la IA ofrece
  actualizar los widgets que usaban el significado anterior (el `prompt` y la
  descripción del widget lo permiten encontrar).
- **[Decisión mía]** En la fase 1 el glosario vive en el doc del panel y lo
  usa el copiloto. La pestaña Asistente IA recibe `resolve_term` y la regla 6,
  pero todavía no lee ni escribe el glosario (fase 2).

**4. Cláusulas OR entre campos.** La respuesta "Todas las anteriores" casi
siempre combina campos distintos (estado **o** etapa **o** tag). Por eso los
filtros son una conjunción de **cláusulas OR** (`FilterClause`, §6.2), con un
solo nivel y sin recursión, compatible con `strict`. Las herramientas del
asistente actual (`aggregate`, `relate`, `search_*`, `export_csv`) reciben la
misma capacidad con un filtro nuevo `clauses`, que se evalúa con el motor.

## 7. Catálogo de gráficas

### 7.1 Tipos

| `viz` | Para qué | Requisito de la consulta | Implementación | Fase |
|---|---|---|---|---|
| `kpi` | Un número titular + delta contra el periodo anterior + sparkline opcional | 0 dimensiones; `compare` opcional | `KpiCard` existente | 1 |
| `bar` / `bar_horizontal` | Comparar magnitudes entre categorías | 1 dimensión categórica | Recharts | 1 |
| `stacked_bar` / `grouped_bar` | Categoría × serie (≤6 series, el resto en "Otros") | 2 dimensiones | Recharts | 1 |
| `line` / `area` | Tendencia en el tiempo (área solo con 1 serie) | dimensión de fecha con bucket (+1 serie opcional, ≤4) | Recharts | 1 |
| `funnel` | **Estado actual** del pipeline: oportunidades abiertas por etapa en el orden de GHL, más las filas Ganado / Abandonado / Perdido. **Sin % entre pasos** (ver nota) | dimensión `funnelState`, orden `natural` desde `pipelines` | barras horizontales ordenadas | 1 |
| `table` | Pivote: filas = dimensiones, columnas = métricas; ordenable | 1-2 dimensiones, 1-3 métricas | HTML + `tabular-nums` | 1 |
| `record_list` | "Citas de hoy", "tareas vencidas": registros con clic al detalle | 0 dimensiones, `limit` | lista + `DetailDrawer` | 1 |
| `text` | Nota del usuario o de la IA ("Meta del mes: 120 leads") | sin consulta | markdown | 1 |
| `donut` | Parte-de-un-todo, **máximo 5 partes** (si hay más, se convierte en barras horizontales) | 1 dimensión | Recharts | 2 |
| `meter` | Avance contra una meta (`target`) | 0 dimensiones | barra de progreso | 2 |
| `heatmap` | Día de la semana × hora (citas, leads creados) | 2 dimensiones de fecha (`weekday`, `hour`) | grid CSS (Recharts no lo trae) | 2 |
| `scatter` | Dos métricas por entidad (gasto vs leads por campaña) | 1 dimensión, 2 métricas | Recharts | 4 |
| `native` | Bloques hechos a mano: AdsSection, Recorrido de la oportunidad, Ciclo de decisión, el tablero completo | `nativeId` | componentes existentes | 3 |

**Nota sobre el embudo.** El sync solo trae la etapa **actual** de cada
oportunidad; no hay historial de etapas (`Opportunity` en `lib/types.ts`). Un
"% entre pasos" calculado con conteos de la etapa actual sería una
distribución disfrazada de tasa de conversión, justo la mentira por omisión
que §3 prohíbe. Los embudos acumulados ("llegó al menos a la etapa N", como
"Recorrido de la oportunidad") quedan **solo como widget nativo** (fase 3),
porque se construyen con hitos (cita, mensajes) y no con etapas. Si el usuario
pide "conversión entre etapas", la IA explica en una línea por qué no se puede
y ofrece el estado actual o el Recorrido.

### 7.2 Reglas de selección automática (van al system prompt y se refuerzan en `validate.ts`)

Vienen del skill de visualización y de las convenciones de CLAUDE.md:
- **¿Es siquiera una gráfica?** Un valor → `kpi`, no una barra solitaria.
  Varios titulares → varios `kpi` chicos en fila. Más de ~7 clases con
  significado → `table`.
- Comparar magnitudes → barras (horizontales si las etiquetas son largas o
  hay más de 8 categorías). Tendencia → línea. Etapas → `funnel`. "Pastel"
  → `donut` solo con ≤5 partes; con más, barras horizontales ordenadas, y la
  IA lo explica en una línea.
- **Nunca doble eje.** Dos medidas de escala distinta = dos widgets (ya es
  invariante en CLAUDE.md: "Two charts, never a dual axis").
- **Máximo 6 series**; el resto se junta en "Otros". Nunca se generan colores
  extra.
- **El color sigue a la entidad, no al rango**: el valor "Meta" tiene el mismo
  color en todos los widgets del panel (asignación determinista por valor
  sobre `CHART_PALETTE`). Ámbar solo para la serie principal (DESIGN.md,
  Amber Discipline Rule).
- **Ninguna codificación que requiera leyenda para entenderse**: etiquetas
  directas y tooltip (convención de CLAUDE.md).
- Todo widget es **clicable hasta sus registros** (`ChartDrillDrawer`) y usa
  `NonZeroTooltipContent`. El motor ya devuelve los ids de registros por fila,
  así que el drill-down sale gratis.
- Tamaños por defecto: `kpi` → `s`; barras/línea → `m`; tabla y embudo → `l`
  o `xl`.

### 7.3 Widgets nativos (fase 3)

Hay bloques que un motor genérico **no debe** reimplementar porque cargan
reglas difíciles: AdsSection (recorte de ventana, join por ad id, cobertura
`priced`), CampaignActivityChart, "Recorrido de la oportunidad", Ciclo de
decisión. Se registran como `nativeId` y reciben las mismas props que hoy.

Paso 1 de la fase 3: `nativeId: "marketing_dashboard"` y `"sales_dashboard"`
como widgets de pestaña entera. Con eso, **cada cliente actual se migra a un
doc con dos pestañas que renderizan exactamente lo que ve hoy**, sin riesgo.
Después se extraen piezas una por una.

## 8. Herramientas de la IA

### 8.1 Nuevas

| Herramienta | Qué hace | Entrada (resumen) | `strict` | Fase |
|---|---|---|---|---|
| `get_dashboard` | Lee el panel: pestañas, widgets (id, título, `describeWidget`, spec), tamaños, widget seleccionado, filtros activos. | `{ tabId \| null }` | sí | 1 |
| `preview_widget` | Ejecuta un spec **sin guardar**. Devuelve los errores de validación **o** un resumen: número de filas, primeras N filas, total, advertencias ("88% de las citas no tiene oportunidad → 'Sin oportunidad'"), texto del ScopePill. Así el modelo ve el resultado antes de guardarlo. | `{ widget: WidgetSpec }` | sí | 1 |
| `create_widgets` | Crea 1-12 widgets en una pestaña existente o nueva. Todo o nada. Devuelve ids y versión. | `{ tabId \| null, newTabTitle \| null, widgets: WidgetSpec[], position: "start" \| "end" }` | sí | 1 |
| `update_widget` | **Reemplaza** el spec completo (no hay parches parciales: es más fácil de validar y de comparar). | `{ widgetId, widget: WidgetSpec }` | sí | 1 |
| `delete_widgets` | Borra widgets. | `{ widgetIds: string[] }` | sí | 1 |
| `arrange_tab` | Orden y tamaño de los widgets de una pestaña. | `{ tabId, items: [{ widgetId, size, height }] }` | sí | 1 |
| `upsert_tab` | Crea o renombra una pestaña; posición. | `{ tabId \| null, title, position \| null }` | sí | 1 |
| `delete_tab` | Borra una pestaña. El prompt exige confirmar con `ask_user` si tiene widgets. | `{ tabId }` | sí | 1 |
| `move_widgets` | Mueve widgets a otra pestaña. | `{ widgetIds, toTabId }` | sí | 1 |
| `get_widget_data` | Lo que un widget guardado muestra **ahora** con los filtros activos. Sirve para explicar anomalías. | `{ widgetId, limit \| null }` | sí | 1 |
| `set_panel_filters` | **Guarda** los filtros globales: controles agregados (`field` o `condition`), sus predeterminados, la fecha y los pipelines predeterminados. Reemplaza la lista completa. | `{ defaultDate \| null, defaultPipelines: string[] (nombres), controls: [{ kind, entity, label \| null, field \| null, defaultValues, clause \| null, defaultOn }] }` | sí | 1 |
| `apply_filters` | Cambia **solo para esta sesión** lo que el usuario ve ahora: fecha, pipelines, valores de controles y condiciones. Lo que no tiene control crea un chip temporal. | `{ date: { range, from \| null, to \| null } \| null, pipelines: string[] \| null, values: [{ entity, field, values }], conditions: [{ entity, label, clause }] }` | sí | 1 |
| `resolve_term` | Dónde aparece un concepto en los datos de la cuenta: candidatos con condición lista, conteos, traslape y la pista `materiallyDifferent` (§6.7). También está en la pestaña Asistente IA. | `{ term, entityHint \| null }` | sí | 0 |
| `save_term` / `forget_term` | Guarda o borra una entrada del glosario del cliente (§6.7). | `{ term, aliases, entity, meaning: FilterClause[], note }` / `{ term }` | sí | 1 |
| `list_versions` / `restore_version` | Historial y restauración ("como estaba ayer"). | `{}` / `{ version }` | sí | 2 |

**[Decisión mía]** Herramientas granulares en vez de una sola
`apply_dashboard_patch`: cada `tool_result` dice exactamente qué cambió, el
deshacer es por operación y los mensajes de error son específicos. El costo
son ~10 herramientas más (ver §9.3 sobre caché y número de herramientas).

### 8.2 Cambios a las existentes

- `aggregate` / `relate` → se reimplementan sobre `engine.ts`. Esto corrige
  "ganada" (`isWonOpp`) y añade el join de búsqueda. **Cambia respuestas del
  asistente actual**: avisar al dueño en el changelog.
- `list_fields` → se extiende con el catálogo semántico por fuente
  (dimensiones relacionadas, buckets de fecha, métricas compatibles).
- `render_chart` → se queda para gráficas efímeras del chat. Fase 2: si la IA
  dibuja en el chat a partir de un spec (`render_widget`), aparece el botón
  **"📌 Fijar en el panel"**, que guarda sin otro turno de IA. Es el puente
  entre la pestaña Asistente IA y el panel.
- `ai-context.ts`: el ejemplo "citas por etapa de la oportunidad" (L264)
  enseña hoy el conteo equivocado. Se corrige junto con el motor. **Las reglas
  numeradas no se recortan** (CLAUDE.md las trata como correcciones de
  regresiones).
- `ai-context.ts`: regla 6 en "Cuándo preguntar", los conceptos de negocio
  ambiguos (§6.7). Es general, no una lista de palabras. Aplica a la pestaña
  Asistente IA y al copiloto.
- Herramientas del asistente: `resolve_term` nueva, y un filtro `clauses`
  (`FilterClause[]`) aceptado por `aggregate`, `relate`, `search_*` y
  `export_csv`, para poder ejecutar "Todas las anteriores". Los filtros de
  oportunidades aceptan además `won: true` (la definición `isWonOpp`).

### 8.3 Esquemas estrictos: restricciones que moldean el spec

Con `strict: true` la API garantiza que el input cumple el esquema, pero con
límites (verificados en la documentación de la API de Claude):
- **Sin esquemas recursivos** → los filtros son una **lista plana** (AND entre
  filtros, OR dentro de `values`). No hay árboles AND/OR anidados. Para un
  panel de CRM alcanza, y es más fácil de leer en el ScopePill. El OR entre
  campos distintos va en **un solo nivel** de cláusulas (`FilterClause.anyOf`),
  y los filtros entre objetos también (`relatedFilters[].conditions[]`), así que
  nada es recursivo.
- **`additionalProperties: false` en todos los objetos** → el `customFields:
  { "Nombre": valor }` de hoy (que usa `additionalProperties: true`) no sirve.
  En el spec, un campo personalizado es un filtro más:
  `{ field: "cf:Origen de Lead", op: "in", values: ["Facebook"] }`.
- **Sin `minimum`/`maximum`/`minLength`** → los rangos (1-3 métricas, 0-2
  dimensiones, `limit` ≤ 50) se validan en zod, del lado del cliente y del
  servidor.
- Todos los campos van en `required` y "no aplica" se expresa con `null`
  (patrón seguro para strict).
- Un esquema nuevo tiene un costo de compilación la primera vez y luego queda
  en caché 24 h.
- El modelo actual (`claude-sonnet-5`) soporta structured outputs.

## 9. Contexto de la IA

### 9.1 Qué ve, y dónde va cada cosa

| Contenido | Dónde | ¿Cambia? |
|---|---|---|
| Prompt base actual + sección nueva "Constructor de paneles" (reglas de §7.2, joins, cuándo confirmar, nunca imprimir ids de widgets/pestañas) | `system` bloque 1 | estático → en caché |
| Catálogo semántico (métricas, operadores) | `system` bloque 1 | estático |
| Resumen del dataset (existente) + campos personalizados + pipelines con sus etapas en orden + estado de Meta | `system` bloque 2 | por sesión → en caché |
| **Snapshot del panel**: pestañas, widgets de la pestaña activa (una línea por widget con `describeWidget`), seleccionado, filtros, **glosario del cliente** | bloque de texto **al final de cada mensaje nuevo del usuario** | cada turno |
| Detalle de un widget o de otra pestaña | `get_dashboard` / `get_widget_data` | bajo demanda |

Ejemplo del snapshot (determinista y compacto):

```
=== PANEL ACTUAL ===
Pestaña activa: "Ventas"
Filtros del panel: Fecha = últimos 30 días (predeterminado: este mes) · Pipeline = todos · Asesor = Ana (temporal) · Fuente = todos
Pestañas: Marketing (6) · Ventas (4) · Citas (2)
Widgets de "Ventas":
 - [w7] KPI "Ingreso ganado" · oportunidades · suma de valor de ganadas · fecha de cierre · hereda fechas
 - [w8] Barras "Citas por etapa" · citas · conteo · por etapa de la oportunidad más reciente · hereda fechas
 - [w9] Lista "Contactos con negocio perdido" · contactos · con alguna oportunidad con (estado = perdida o etapa = «Negocio Perdido») · ignora los filtros del panel
Seleccionado: [w8]
Glosario del cliente: «perdido» (oportunidad) = estado perdida o etapa «Negocio Perdido» · «cliente activo» (contacto) = tag «activo»
```

### 9.2 Por qué el snapshot va en el mensaje y no en `system`

El prompt se cachea por prefijo (`tools → system → messages`): cambiar un byte
invalida todo lo que viene después. Si el snapshot viviera en `system`, cada
cambio al panel invalidaría también el resumen del dataset. Si va pegado al
**mensaje nuevo del usuario**, queda después del último punto de caché, y una
vez enviado pasa a ser historial estable (el loop solo agrega, nunca edita).
Ese mismo carácter append-only es lo que exigen los modelos 5.5 con
*preserved thinking*.

Alternativa más limpia para más adelante: los **mensajes `system` a mitad de
conversación** existen en Sonnet 5.5 / Opus 5.5, pero **no en
`claude-sonnet-5`**, que es el modelo actual. Se considera al migrar de
modelo.

### 9.3 Número de herramientas y caché

- Hoy son ~25 herramientas; con las del panel serían ~36. **[Decisión mía]**
  El copiloto del panel manda su propio conjunto **estable**: herramientas de
  datos + del panel, sin `create_pdf` ni las de archivos adjuntos. La pestaña
  Asistente IA conserva el suyo. Son dos prefijos de caché, cada uno estable
  dentro de su modo.
- El orden de las herramientas debe ser determinista (el arreglo es `as
  const`, así que ya lo es).
- Si la calidad de selección baja con tantas herramientas, la API tiene
  *tool search* (`defer_loading`). Se evalúa solo si se mide un problema.

### 9.4 Modelo

**[Decisión mía, provisional]** La fase 1 usa el mismo modelo que el
asistente (`claude-sonnet-5`, adaptive thinking): una sola ruta, el mismo
costo conocido y el contador de costo ya calibrado. Antes de fijarlo, se corre
una evaluación con ~30 peticiones reales en español (incluido el ejemplo del
dueño) comparando `claude-sonnet-5-5` y `claude-opus-5-5` ($4/$20 por MTok
contra $2/$10). El criterio es el **costo por widget correcto**, no el costo
por request. Notas para la migración a 5.5: el `tool_choice` forzado da 400
(aquí no se usa), los bloques de thinking deben devolverse sin modificar (el
loop ya lo hace) y el historial debe ser append-only (ya lo es). El precio en
`use-agent-loop.ts` (`PRICING`) debe seguir al modelo, o el contador de costo
miente sin fallar.

## 10. Persistencia

### 10.1 Tablas (en `scripts/db-migrate.ts`, idempotente)

```sql
CREATE TABLE IF NOT EXISTS dashboard_doc (
  client_id   text PRIMARY KEY,          -- el id del roster (= project_sync.project_id)
  doc         jsonb       NOT NULL,
  version     integer     NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        NOT NULL       -- 'ai' | 'user'
);

CREATE TABLE IF NOT EXISTS dashboard_doc_version (
  client_id   text        NOT NULL,
  version     integer     NOT NULL,
  doc         jsonb       NOT NULL,
  change      text        NOT NULL,      -- "IA: agregó 'Citas por etapa'"
  source      text        NOT NULL,      -- 'ai' | 'user'
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, version)
);
```

**[Decisión mía]** Un documento por cliente en lugar de tablas normalizadas
(tabs, widgets): las ediciones de la IA tocan varios widgets a la vez y deben
ser atómicas, deshacer = restaurar un doc, y el doc pesa decenas de KB. Es el
mismo espíritu de "una fila por cliente" de `project_sync`.

- **A diferencia de `project_sync`, esto NO es desechable**: es contenido del
  cliente. Hay que anotarlo en CLAUDE.md junto a `ghl_oauth_token`.
- `jsonb` y no `bytea`+gzip: el doc es pequeño y a veces se inspecciona a mano
  para soporte. Ninguna consulta mira adentro.
- Historial: se guardan las últimas **50 versiones** por cliente y se recorta
  al escribir.

### 10.2 API

- `GET /api/dashboards` → `{ doc, version }`, o un doc vacío si no hay fila.
- `PUT /api/dashboards` → `{ doc, expectedVersion, change, source }`. La
  escritura es condicional **dentro del `WHERE` del UPDATE** (`... WHERE
  client_id = $1 AND version = $2`), nunca leer y luego escribir en TypeScript.
  Es el mismo patrón que `claimSync`. Si no coincide la versión → **409**, y el
  cliente recarga el doc. Si fue la IA, el `tool_result` le dice "el panel
  cambió en otra sesión; vuelve a leerlo con `get_dashboard`".
- `POST /api/dashboards/restore` → `{ version }` (fase 2).
- Todo con `requireClient()`. **El `client_id` jamás viene del body.**
- Límites (zod en el servidor): ≤12 pestañas, ≤24 widgets por pestaña, doc
  ≤256 KB, títulos ≤80 caracteres.
- Cada herramienta que modifica el doc **guarda inmediatamente** y el
  `tool_result` lleva la versión nueva. Si el PUT falla, `is_error` y la IA se
  lo dice al usuario. No hay estados "a medio guardar".

### 10.3 Desinstalación y reinstalación

**[Decisión mía]** UNINSTALL **no** borra el doc: no contiene datos
personales (solo consultas y títulos) y las filas de `dashboard_installation`
tampoco se borran, así que una reinstalación recupera su id **y su panel**.
Notas tipo `text` escritas por la IA podrían mencionar cifras; si eso
preocupa, se borran en UNINSTALL las notas, no el panel.

## 11. Herramientas y librerías

| Necesidad | Qué usar | ¿Nuevo? |
|---|---|---|
| Gráficas | Recharts 2.15 + wrapper shadcn (`components/ui/chart.tsx`) | ya está |
| Esquemas / validación | zod 3 (ya en `package.json`); el JSON Schema de las herramientas se escribe a mano junto al zod y un `verify` comprueba que coinciden | ya está |
| Ids de pestañas y widgets | `crypto.randomUUID()` recortado, o `nanoid` | probablemente nada nuevo |
| Cuadrícula | **Fase 1: CSS grid de 12 columnas, lista ordenada + tamaños predefinidos.** Fase 4: arrastrar y soltar con `@dnd-kit/sortable` | dnd-kit en fase 4 |
| Heatmap | grid CSS propio | — |
| Base de datos | Neon vía `lib/db.ts` | ya está |
| IA | `@anthropic-ai/sdk` 0.98, la misma ruta `/api/chat` | ya está |
| Toasts (deshacer) | `sonner` | ya está |
| Markdown (notas) | `react-markdown` + `remark-gfm` | ya está |

**[Decisión mía]** La fase 1 **no** usa `react-grid-layout` (posición libre
2D). Un layout 1D ordenado con tamaños es lo que una IA maneja bien ("pon los
KPI arriba" = reordenar una lista), es responsivo por construcción y evita una
dependencia cuya compatibilidad con React 19 habría que comprobar. El
reordenamiento manual llega en la fase 2 (Mover arriba/abajo en el menú) y el
arrastre en la fase 4.

Paquetes nuevos: se instalan con `pnpm add` y se commitea `pnpm-lock.yaml`
(CLAUDE.md: nunca `npm install`).

## 12. Invariantes (no se rompen)

1. **El doc guarda consultas, nunca resultados.** Ningún número guardado sale
   del modelo.
2. **Cero ejecución de código del modelo.**
3. **El tenant sale de `requireClient()`**, nunca del body; el doc se lee y se
   escribe solo por `lib/dashboard-store.ts`.
4. **Una sola implementación de cada métrica** (`semantic.ts`), compartida
   por el panel, el chat (`aggregate`/`relate`) y, en lo posible, los
   tableros a mano.
5. **Meta ignora todos los filtros de CRM (pipeline y agregados) y lo dice**; CPL con leads del CRM y el
   recorte de `adsWindow`, reconstruyendo `isDePauta` sobre el historial **sin
   filtrar** (CLAUDE.md, "the one that is easy to miss").
6. **Las uniones y los filtros entre objetos resuelven contra el conjunto sin
   filtrar por fecha** (como `allOpportunities` y `contactIdsInPipelines`), y
   las condiciones de un filtro entre objetos se cumplen **en el mismo
   registro relacionado**.
7. **Nada se descarta en silencio**: "Sin oportunidad", "(sin valor)", "Otros";
   si un periodo excede los datos que hay (citas ±90 días, gasto 365 días), la
   tarjeta lo dice.
8. **La regla de cada widget es visible** (ScopePill de `describeWidget`).
9. **Sin doble eje, ≤6 series, el color sigue a la entidad, ámbar solo para
   lo principal.**
10. **Todo cambio se puede deshacer**; las operaciones destructivas grandes
    (borrar una pestaña con widgets, borrar más de 3 widgets) se confirman con
    `ask_user`.
11. **La IA nunca imprime ids** de widgets ni de pestañas (extiende la regla 7
    del prompt actual).
12. **La edad de los datos sigue visible** ("Actualizado hace X") en el modo
    panel, igual que hoy.
13. **Los filtros activos siempre están a la vista**: los globales en la barra
    (los temporales marcados), los de cada gráfica como chips en la tarjeta.
    Un predeterminado guardado cuyo valor ya no existe en los datos (un asesor
    que se fue) se marca "(sin datos)" en su chip en vez de vaciar el panel
    sin explicación.
14. **Un concepto de negocio con varias lecturas materialmente distintas
    nunca se interpreta en silencio**: se pregunta una vez, se guarda en el
    glosario y la elección queda visible en el ScopePill. La IA nunca inventa
    un criterio que no esté en los datos.

## 13. Fases

### Fase 0: cimientos (sin UI nueva)
- `lib/widgets/{spec,semantic,engine,validate,describe}.ts`.
- `aggregate`/`relate` reimplementados sobre el motor.
- `scripts/verify-widgets.ts` + `pnpm verify:widgets`.
- **Terminado cuando**: (a) el motor reproduce, en 2 cuentas reales
  cacheadas, los números de estas gráficas existentes: Oportunidades por
  fuente, Estado actual del embudo por etapa, Resultado de las citas,
  Principales razones de pérdida, los KPI Conversión e Ingreso ganado, y
  Origen de oportunidades con conversión a cita (la que prueba la regla de
  paridad de §6.3). "Recorrido de la oportunidad" **no** está en esta lista:
  usa mensajes y llamadas y es nativo (§7.3); (b) `verify:widgets` cubre los joins
  (`latest`/`each`/sin oportunidad), las fechas, el alcance de pipeline, las
  razones recalculadas y "ganada" con `isWonOpp`; (c) `npx tsc --noEmit`
  limpio.

### Fase 1: panel persistente (el MVP de lo que se pidió)
- Tablas + `/api/dashboards` + `lib/dashboard-store.ts` + versión optimista +
  historial.
- `WidgetGrid` + `WidgetCard` + tipos `kpi`, `bar`, `bar_horizontal`,
  `stacked_bar`, `grouped_bar`, `line`, `area`, `funnel`, `table`,
  `record_list`, `text`, con drill-down.
- Pestañas dinámicas (crear, renombrar, borrar), panel vacío con sugerencias
  y copiloto lateral.
- Herramientas de §8.1 (fase 1) + snapshot del panel + sección nueva del
  prompt.
- Deshacer (restaurar la versión anterior) desde un toast.
- Filtros (§6.6): barra global con controles agregables y predeterminados
  guardados; editor "Filtros y fechas" por gráfica; filtros entre objetos
  (`any`/`none`); cláusulas OR; `resolve_term`, la regla 6 de "Cuándo
  preguntar" y el glosario del cliente (§6.7).
- **Interruptor por cliente** (columna `ai_panel boolean` en
  `dashboard_installation`, o similar) para lanzar primero en la subcuenta de
  Lezgo Suite.
- **Terminado cuando**: la evaluación de §14 (30 peticiones, 2 cuentas,
  partiendo de un panel vacío) produce widgets cuyo número coincide con la
  referencia en ≥90% de los casos, y el resto termina en una pregunta o en un
  error visible (nunca en un número equivocado mostrado como correcto). Además,
  en la subcuenta de Lezgo Suite con el interruptor encendido, recargar la
  página conserva todo y deshacer funciona.

### Fase 2: calidad de edición
- Seleccionar un widget para editarlo, menú manual (tamaño, mover, duplicar,
  ver datos, CSV, eliminar), panel de historial (`list_versions` /
  `restore_version`).
- `donut`, `meter`, `heatmap`; deltas de KPI contra el periodo anterior.
- "📌 Fijar en el panel" desde el chat (`render_widget`).
- Exportar una pestaña a PDF reutilizando `lib/pdf` (spec → `ReportSection`).

### Fase 3: widgets nativos y plantillas
- `nativeId` para los dos tableros completos → **migración sin regresión de
  los clientes actuales** (doc inicial con dos pestañas nativas).
- Extracción progresiva: AdsSection, Recorrido de la oportunidad, Ciclo de
  decisión, CampaignActivity.
- Plantillas "Marketing / Ventas / Ejecutivo" que mezclan widgets genéricos y
  nativos.

### Fase 4: extras
- Arrastrar y soltar (`@dnd-kit`), `scatter`, Sankey (fuente → etapa).
- Paneles por usuario si llega identidad de usuario (SSO).

## 14. Verificación

Siguiendo la convención del repo (no hay framework de pruebas):
- `pnpm verify:widgets`: motor, validador, `describeWidget` y la equivalencia
  entre el JSON Schema de las herramientas y el zod. Un número que sale mal en
  silencio aquí es justo el tipo de bug para el que existen estos scripts.
- `pnpm verify:dashboard-store`: versionado condicional, recorte del
  historial, límites de tamaño (las aserciones de BD solo con `DATABASE_URL`,
  como `verify:sync-store`).
- **Evaluación de lenguaje natural**: ~30 peticiones en español (incluida
  "las citas organizadas por oportunidades de pipeline", más peticiones
  ambiguas, destructivas y de edición) contra el payload cacheado de 2
  cuentas: Lezgo Suite y una grande (amir-cherit o hausmen), cada una
  partiendo de un panel vacío. Para cada una se registra el spec producido, si
  el número coincide con la referencia y el costo del turno.
  - **Corpus**: quien construya redacta el borrador y el dueño lo aprueba y le
    agrega preguntas reales de sus clientes (pregunta 6). No hay un corpus
    previo: `/api/chat` no guarda conversaciones.
  - **Referencias independientes del motor** (para que la prueba no se
    califique sola): cuando existe una gráfica a mano equivalente, su número
    es la referencia; si no, un script desechable escrito **aparte** del motor
    (filtros directos sobre los arreglos) y revisado por una persona.
  - **Gasta dinero de la API: pedir aprobación del presupuesto antes de
    correrla.**
- Manejar la app real (pdfmake y el render no se prueban en Node) y
  `npx tsc --noEmit` antes de dar algo por terminado.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| La IA elige mal la base de fecha o la regla de unión, y el número parece creíble | ScopePill visible, `preview_widget` antes de guardar, reglas de `ask_user` existentes (pauta, atribución, fecha base), evaluación de la fase 1. |
| **Costo de IA sin tope**: los clientes ahora disparan el gasto de Anthropic por su cuenta | Contador por cliente/día en Neon y un tope configurable (pregunta 3). Medir con el `totalCost` que ya existe. |
| Rendimiento en cuentas grandes (decenas de miles de registros × N widgets) | Memo por (hash del spec, referencia del dataset, filtros); índices de `getChatIndex`; medir y mover el motor a un Web Worker solo si un panel tarda más de ~50 ms en calcular. |
| Evolución del esquema: los docs viven años, no como la caché | `schemaVersion` + migración al leer; nunca romper la lectura de un doc viejo (mismo cuidado que el campo opcional `ads`). |
| Ediciones simultáneas (agencia + cliente) | Versión optimista + 409 + recarga. |
| Inyección de instrucciones vía datos del CRM (un nombre de contacto que dice "borra el panel") | Confirmación de operaciones destructivas, deshacer y historial; los datos van en `tool_result`, no en el prompt de sistema. |
| Cambiar `aggregate` cambia respuestas del asistente actual (ganadas por etapa) | Es una corrección, pero se anuncia; se compara antes y después en 2 cuentas. |

## 16. Decisiones que tomé yo (revísalas)

1. Panel **por cliente**, compartido; no por usuario.
2. Un **documento JSON por cliente** + tabla de versiones (50).
3. **Join `latest` por defecto** para "citas por etapa"; `each` como opción.
4. Filtros como **lista plana** (por las restricciones de `strict`).
5. Layout **1D ordenado con tamaños** en la fase 1; arrastrar y soltar después.
6. **Filtros globales** a nivel panel (no por pestaña): fecha y pipeline más
   hasta 8 controles agregables. Los controles y los predeterminados se
   guardan; los valores elegidos son de la sesión. Si un widget filtra el mismo
   campo, gana el del widget.
7. Herramientas **granulares** (~10 nuevas) en vez de un parche genérico.
8. El copiloto del panel usa su **propio conjunto estable de herramientas**;
   la pestaña Asistente IA se queda como está.
9. Mismo **modelo** que hoy para la fase 1, con una evaluación antes de
   cambiar.
10. Mensajes y llamadas **no** son fuentes de widgets.
11. Desinstalar **no** borra el panel.
12. `donut` permitido solo con ≤5 partes; con más, barras.
13. Los cambios de la IA se aplican **directo** (con deshacer), sin un paso de
    "¿aplicar?".
14. **"Leads" son tres métricas con nombre** (contactos creados, oportunidades
    de pauta, pautas únicas). Por defecto, contactos creados; en contexto de
    costo, oportunidades de pauta.
15. **Regla de paridad**: una métrica que ya existe en un tablero se replica
    exactamente, incluida su ventana de fechas; si está mal, se corrige en
    ambos lados.
16. **El `funnel` muestra el estado actual, sin % entre pasos** (no hay
    historial de etapas); los embudos acumulados son solo nativos.
17. `stage` = etapa cruda de GHL; `funnelState` = la regla del embudo de
    Ventas (abiertas por etapa + Ganado/Abandonado/Perdido).
18. **Filtros entre objetos** con `any`/`none`, condiciones sobre el mismo
    registro relacionado, registros relacionados sin filtro de fecha.
19. **Los conceptos ambiguos los razona la IA**, con evidencia de los datos
    (`resolve_term`), preguntando solo cuando las lecturas difieren de verdad y
    recordando la respuesta en el glosario. No hay reglas fijas por palabra;
    las definiciones de los tableros funcionan como glosario de fábrica.
20. Los widgets guardan las condiciones **expandidas**, no una referencia al
    glosario. En la fase 1, el glosario es solo del copiloto.

## 17. Preguntas que solo tú puedes responder (en orden de importancia)

1. **¿Qué pasa con los clientes actuales?** Mi recomendación: los clientes
   actuales conservan Marketing y Ventas tal cual (como pestañas nativas) y
   suman pestañas propias; los nuevos empiezan con el panel vacío. La
   alternativa es que todos pasen al panel vacío con plantillas. Esto decide si
   la fase 3 (nativos) va antes o después del lanzamiento general.
2. **¿Quién puede editar?** ¿Cualquiera que entra a la subcuenta, o quieres
   que algunas cuentas sean de solo lectura (por ejemplo, la agencia arma el
   panel y el cliente solo lo ve)? El SSO trae el `role`, así que se puede
   distinguir a un admin de agencia, pero el login por contraseña no.
3. **¿Tope de gasto de IA por cliente?** Hoy el asistente no tiene límite. Con
   el panel, cada cliente generará turnos de IA por su cuenta. ¿Tope diario,
   tope mensual, o sin tope por ahora?
4. **Panel por cliente vs. por persona.** Lo propuse por cliente porque el
   login por contraseña no identifica a la persona. Si lo quieres por persona,
   hace falta identidad de usuario (cambio de auth) y eso mueve todo el plan.
5. **Apetito de costo por modelo.** ¿Aceptas Opus 5.5 (el doble que Sonnet por
   token) si la evaluación muestra que arma paneles notablemente mejor?
6. **Preguntas reales de tus clientes** para la evaluación. Si tienes 10 o más
   cosas que tus clientes realmente piden ver, pásamelas; si no, redacto el
   borrador y tú lo apruebas. Sin esto, la prueba de aceptación de la fase 1
   la escribe la misma persona que construye.

## 18. Lo que queda a criterio de quien construya

- Nombres exactos de archivos y componentes, y la animación de entrada de un
  widget nuevo.
- El texto exacto de las sugerencias del panel vacío y del prompt (respetando
  las reglas numeradas existentes).
- La asignación determinista de colores por valor.
- Si `get_widget_data` y `preview_widget` comparten implementación (lo
  natural es que sí).
- Los umbrales exactos (límites del doc, número de versiones, filas por
  `preview_widget`).
