# Diseño: Herramienta `create_pdf` para el asistente "Analizar IA"

**Fecha:** 2026-06-08
**Estado:** Aprobado para planeación

## Objetivo

Darle al asistente de IA ("Analizar IA", el chat sobre datos del CRM) la
capacidad de generar documentos PDF con el branding de Lezgo Suite, reutilizando
el sistema de diseño definido en `~/Downloads/crear-documentos-lezgosuite.md`
(originalmente escrito en Python/ReportLab).

Casos de uso primarios:
1. **Reporte de análisis** — convertir el análisis que el asistente acaba de
   hacer (KPIs, tablas por fuente/asesor/etapa, hallazgos, gráficas) en un PDF
   con marca.
2. **Documento libre** — herramienta genérica donde el asistente compone
   cualquier documento a partir de bloques estructurados y se le aplica el
   branding automáticamente.

## Restricción clave: minimizar la intervención de la IA (tokens)

El branding completo es automático; la IA solo emite contenido compacto.

- **(a)** Portada, header, footer y todos los estilos los aplica el renderer.
  La IA nunca describe layout ni colores.
- **(b)** La IA reutiliza datos que ya calculó con `aggregate`/`relate`
  (especialmente los `series` que ya domina por `render_chart`). No vuelve a
  volcar datasets ni hace llamadas extra solo para el PDF.
- **(c)** El `tool_result` que regresa a la IA es mínimo
  (`{ success, filename, pages }`), igual que `export_csv`.

## Decisión técnica: librería de PDF

**pdfmake** (client-side), por:
- Documento declarativo (`docDefinition`) que mapea casi 1:1 con el modelo
  "story + tablas" de ReportLab del MD.
- Tablas nativas, `header`/`footer` por página, márgenes.
- `canvas` vectorial (rect, line, polyline, ellipse) para dibujar las gráficas
  con la paleta de marca.
- Funciona en el navegador, consistente con el patrón existente `export_csv`.

Alternativas descartadas: jsPDF+autotable (layout/gráficas manuales, más código),
@react-pdf/renderer (sin primitivas vectoriales fáciles, más pesado).

**Tipografía:** Roboto (default de pdfmake, sin embeber fuentes). El MD pide
Helvetica; son visualmente casi idénticas. Se puede cambiar a Helvetica embebida
más adelante si se requiere fidelidad estricta — fuera de alcance de v1.

## Arquitectura

```
El asistente (Claude) decide generar un documento
        ↓  tool_use: create_pdf  (input = spec JSON del documento)
hooks/use-agent-loop.ts  ← intercepta el tool (como export_csv)
        ↓
lib/pdf/  (nuevo módulo, client-side)
  ├── branding.ts   → paleta, estilos, header/footer, portada (port del MD)
  ├── blocks.ts     → convierte cada bloque del spec → nodos pdfmake
  ├── charts.ts     → dibuja bar/pie/line con canvas vectorial
  └── build-pdf.ts  → ensambla docDefinition + genera Blob
        ↓
lib/download.ts triggerDownload({ ..., mimeType: "application/pdf" })
        ↓  descarga en el navegador
```

La IA no escribe pdfmake: pasa un spec JSON estructurado y `lib/pdf/` aplica todo
el branding. El branding queda centralizado y reutilizable (igual que los helpers
del MD).

### Integración con el código existente

- **`lib/ai-tools.ts`** — agregar la definición del tool `create_pdf` a
  `TOOL_DEFINITIONS`. El executor (`executeTool`) NO procesa este tool (es
  UI-only / efecto secundario, como `export_csv`); solo se valida el spec.
- **`hooks/use-agent-loop.ts`** — agregar una rama `else if (tu.name ===
  "create_pdf")` junto a la de `export_csv`: construye el PDF con `lib/pdf/`,
  dispara `triggerDownload`, y regresa el resultado mínimo a la IA.
- **`lib/ai-context.ts`** (`ASSISTANT_SYSTEM_PROMPT`) — instruir al asistente:
  cuándo generar un PDF, que componga a partir de datos ya obtenidos, que no
  haga llamadas extra solo para el PDF, y la regla de marca (nunca "GHL").

## Spec del documento

La IA pasa un único objeto compacto:

```jsonc
{
  "title": "Reporte de Leads",          // título de portada (requerido)
  "accent": "Mayo 2026",                // 3ra línea naranja de portada (opcional)
  "client": "MX Inmobiliaria",          // caja naranja de cliente (opcional)
  "subtitle": "Análisis de campañas",   // descripción de portada (opcional)
  "cover": true,                        // portada sí/no (default true)
  "blocks": [ /* ver tipos abajo */ ]
}
```

### Tipos de bloque

Cada bloque es terso — solo datos, sin estilos.

| Bloque        | Forma                                                          | Render |
|---------------|----------------------------------------------------------------|--------|
| `heading`     | `{ t:"heading", text }`                                         | Título de sección naranja `#F59B1B` 14pt bold + línea `hr` debajo |
| `subheading`  | `{ t:"subheading", text }`                                      | Subsección azul `#335577` 11pt bold |
| `text`        | `{ t:"text", text }`                                            | Párrafo justificado; acepta `**negrita**` |
| `bullets`     | `{ t:"bullets", items:[string] }`                              | Lista con viñetas |
| `kpis`        | `{ t:"kpis", items:[{label,value}] }`                          | Fila de tarjetas KPI con acento naranja |
| `table`       | `{ t:"table", headers:[string], rows:[[string]] }`            | Tabla con encabezado azul, filas alternadas (gris/blanco) |
| `callout`     | `{ t:"callout", style:"info\|warn\|ok\|error", text }`        | Caja de color (mapea a las 4 cajas semánticas del MD) |
| `chart`       | ver sección "Gráficas"                                         | Gráfica vectorial |

Mapeo de `callout.style` a las cajas del MD:
- `info`  → `NARANJA_CLAR` / `NARANJA_BORD` (información Lezgo)
- `warn`  → `AMARILLO_BG` / `AMARILLO_BRD` (advertencia/nota)
- `ok`    → `VERDE_CLARO` / `VERDE_BORDE` (éxito/activo)
- `error` → `ROJO_CLARO` / `ROJO_TEXT` (error/restricción)

## Gráficas

El bloque `chart` soporta dos formas de datos según el caso.

**Forma simple** — `bar` / `pie` / `line` de una serie (idéntica a `render_chart`):
```jsonc
{ "t":"chart", "type":"bar", "title":"Leads por fuente", "valueLabel":"Leads",
  "series":[ {"label":"Meta","value":42}, {"label":"Google","value":18} ] }
```

**Forma multi-serie** — apiladas / agrupadas / line multi-serie:
```jsonc
{ "t":"chart", "type":"bar", "stacked":true, "title":"Leads por fuente y estatus",
  "valueLabel":"Leads",
  "categories":["Meta","Google","Orgánico"],
  "series":[
    {"name":"Abierto","values":[12,8,3]},
    {"name":"Ganado","values":[5,4,1]},
    {"name":"Perdido","values":[3,2,0]}
  ] }
```

El renderer detecta la forma:
- Hay `categories` + `series[].values` → multi-serie. `stacked:true` → barras
  apiladas; `stacked:false`/ausente → barras agrupadas (side-by-side); `line` →
  varias líneas.
- Hay `series[].value` → gráfica simple.

Tipos y variantes:

| Tipo  | Variantes |
|-------|-----------|
| `bar` | vertical · horizontal (`orientation:"h"`) · apilada (`stacked:true`) · agrupada |
| `pie` | participación de un total |
| `line`| tendencia temporal (una o varias series) |

**Dibujo:** todas con el `canvas` vectorial de pdfmake. Paleta: naranja
`#F59B1B` como primario; rampa derivada (naranja oscuro `#D4820E`, azul `#335577`,
verde `#065F46`, grises) para segmentos de apiladas/multi-serie. Cada gráfica
lleva título, leyenda (cuando hay varias series) y etiquetas de valor.

**Costo en tokens:** las apiladas cuestan en *orquestación de datos* (la IA corre
`relate`/varios `aggregate`), no en tamaño del spec — los `values` son arrays de
números cortos. Costo aceptado por requerimiento explícito del usuario.

## Definición del tool (`create_pdf`)

Se agrega a `TOOL_DEFINITIONS` en `lib/ai-tools.ts`. La descripción instruye al
modelo a:
- Generar un PDF solo cuando el usuario pide un documento/reporte descargable.
- Componer el documento **a partir de datos que YA obtuvo**; no hacer llamadas
  extra solo para el PDF.
- Reutilizar los `series` de sus `aggregate`/`relate` en los bloques `chart`.
- Nunca usar "GoHighLevel"/"GHL" en ningún texto (usar "Lezgo Suite CRM").

`input_schema`: `title` (requerido), `accent`, `client`, `subtitle`, `cover`,
`blocks` (array; cada bloque discriminado por `t`).

## Manejo de errores

- Spec vacío, sin `blocks`, o malformado → el tool regresa
  `{ success:false, error:"..." }` (mínimo) y **no** descarga nada.
- Bloques individuales inválidos se omiten (best-effort), análogo a
  `parseChartSpec` que ya existe.
- Errores de generación de pdfmake se capturan en la rama del agent-loop (igual
  que las demás herramientas) y regresan `is_error`.

## Regla de marca (obligatoria)

El renderer **sanitiza** todo texto visible: reemplaza "GoHighLevel" y "GHL" por
"Lezgo Suite CRM" / "Lezgo Suite" antes de imprimir. Aplica a portada, headers,
footer, cuerpo, tablas, callouts y etiquetas de gráficas. El system prompt
además instruye al modelo a no emitirlos.

## Alcance de v1 / fuera de alcance

**Dentro:** bloques heading/subheading/text/bullets/kpis/table/callout/chart;
gráficas bar (vert/horiz/apilada/agrupada), pie, line (mono y multi-serie);
portada + header/footer de marca; descarga client-side; sanitización de marca.

**Fuera (YAGNI / futuro):**
- Helvetica embebida (Roboto en v1).
- Burbujas de chat y tarjetas de paso de bot del MD (no aplican a reportes).
- Imágenes/logos embebidos más allá del wordmark tipográfico "LEZGO SUITE".
- Gráficas de área / donut.

## Dependencia nueva

`pdfmake` (+ `@types/pdfmake` para tipos). Client-side only.
