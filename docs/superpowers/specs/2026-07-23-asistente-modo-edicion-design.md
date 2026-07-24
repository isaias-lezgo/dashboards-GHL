# Asistente IA — Modo edición (custom fields)

**Fecha:** 2026-07-23
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Resumen

Agregar al Asistente IA la capacidad de **editar el CRM**, empezando por custom
fields. Un toggle "Modo edición" en la pestaña Asistente IA habilita, para el
proyecto actual, cuatro herramientas de escritura. Toda escritura se detiene en
una **tarjeta de confirmación** que muestra el antes/después leído del registro
real; nada llega a GoHighLevel sin que el usuario apriete un botón.

Esta fase cubre custom fields en dos niveles:

- **Valores** en registros: ponerle/cambiarle el valor de un campo a un contacto
  o a una oportunidad (una edición suelta o un lote de hasta 50).
- **Definiciones** de campo: crear un campo nuevo y editar uno existente
  (renombrar, **agregar** opciones a un desplegable).

Usuarios y agentes IA son **fases siguientes** que se enchufan a esta misma
infraestructura; no se construyen aquí.

## Decisiones tomadas (contexto para el plan)

| Decisión | Elegido | Por qué |
|---|---|---|
| Alcance de esta fase | Infra + custom fields (valores y definiciones) | Único dominio donde el navegador ya tiene los datos; prueba la infra con riesgo acotado |
| Autorización de escritura | Sin credencial extra — solo la cookie de acceso existente | El equipo interno es de confianza; el toggle es capacidad del modelo, no control de seguridad |
| Dónde se aplica la confirmación | **Puerta en el loop del agente**, no en el prompt | La regla la aplica el código, no una instrucción que el modelo puede romper; el diff se lee del registro real, no de la narración del modelo |
| Operaciones sobre definiciones | Crear y editar, **sin borrar** | Borrar es irreversible y destruye valores en miles de registros; se hace a mano en GHL |
| Rastro de auditoría | Solo la tarjeta sellada en el hilo | Cero infra nueva; GHL lleva su propio historial por registro. **Log persistente = deuda registrada** (ver abajo) |
| Fases de valores vs definiciones | Todo en una fase | Comparten toda la infra; la diferencia es forma de payload/diff |

## No-negociables (modos de falla que el diseño previene por construcción)

1. **Ninguna escritura sin confirmación.** La puerta vive en `use-agent-loop.ts`
   (código), no en el system prompt. Un turno donde el modelo "olvide" pedir
   permiso no puede escribir, porque no es el modelo quien decide ejecutar.
2. **`WRITE_TOOLS` no se puede desincronizar de las herramientas de escritura.**
   El set se **deriva** del arreglo de definiciones
   (`new Set(WRITE_TOOL_DEFINITIONS.map(t => t.name))`). El modo de falla más
   peligroso —agregar una herramienta de escritura y olvidar registrarla en la
   puerta— queda imposible de expresar.
3. **Sin acción de borrado en ningún nivel.** No existe en `WRITE_TOOL_DEFINITIONS`
   ni en la lista blanca de `/api/ghl-write`. Inalcanzable aunque el navegador lo
   pida.
4. **La aprobación nunca se hereda.** Cada `tool_use` de escritura abre su propia
   tarjeta, aunque el modelo emita varios en el mismo turno.
5. **Nunca un cambio silencioso a medias.** En lotes, o se muestra el desglose
   exacto de éxitos/fallas, o un error total. No existe "creo que la mayoría
   funcionó".
6. **`update_custom_field` no puede borrar opciones.** GHL reemplaza el arreglo
   completo de opciones; el código fusiona (actuales + nuevas) y **rechaza antes
   de salir a la red** si alguna opción existente desaparecería.

## Arquitectura

### Piezas (7 cambios; solo 2 son código realmente nuevo)

**1. El catálogo de definiciones viaja al navegador.**
Hoy `app/api/dashboard/route.ts` trae `getCustomFields()` (línea ~401) pero solo
lo usa para armar un mapa **id→name** (`customFieldMap`, línea ~414) y **descarta
el resto**: el navegador se queda con `customFieldsResolved` (nombre→valor) y los
ids sueltos dentro de cada registro, **sin el tipo del campo ni sus opciones**.
Para escribir hace falta el id; para validar, el tipo y el picklist.

La respuesta v1 (`GHLCustomField`) ya trae todo lo necesario —
`{ id, name, dataType, model, options }` donde `model` es `"contact"|"opportunity"`
y `options` es `Array<{id, value, label}>`. El frame `data` del NDJSON debe
exponerlo (normalizando el nombre del campo objeto a `objectKey` para que
coincida con lo que espera la escritura):

```ts
customFieldDefs: Array<{
  id: string;
  name: string;
  objectKey: "contact" | "opportunity";   // derivado de GHLCustomField.model
  dataType: string;          // TEXT, NUMERICAL, SINGLE_OPTIONS, MULTIPLE_OPTIONS, DATE, …
  options?: Array<{ value: string; label: string }>;  // solo para *_OPTIONS
}>
```

Prácticamente gratis: ya está en memoria en el servidor.

**2. El toggle decide qué herramientas se mandan al modelo.**
`conversations-chat.tsx` mantiene `writeEnabled` (estado local) y lo envía en el
body de `/api/chat`. La ruta concatena `WRITE_TOOL_DEFINITIONS` a las de lectura
**solo si viene `true`**, y agrega al system prompt el bloque de reglas de
escritura. Apagado, el modelo no tiene la capacidad — no se abstiene, no la
posee.

**3. La puerta en el loop.**
En `use-agent-loop.ts`, hermano del `if (askUse)` existente: si algún `tool_use`
está en `WRITE_TOOLS`, no se ejecuta; se guarda en `pauseStashRef` y se levanta
un `pendingWrite`. Misma mecánica de pausa/reanudación ya probada por `ask_user`.

**4. `WRITE_TOOLS` derivado (ver No-negociable 2).**

```ts
export const WRITE_TOOL_DEFINITIONS = [ /* set_contact_fields, … */ ] as const;
export const WRITE_TOOLS = new Set(WRITE_TOOL_DEFINITIONS.map((t) => t.name));
```

**5. `components/dashboard/chat-write-confirm.tsx`** — la tarjeta de confirmación.
Único componente nuevo de peso. Hermano de `chat-question.tsx`, del que copia la
forma (bloqueo del composer, dos acciones, sellado en el hilo).

**6. `app/api/ghl-write/route.ts`** — una sola ruta con discriminador `action`
validado contra una **lista blanca**. Deliberadamente una y no cuatro: el
conjunto de mutaciones posibles queda enumerado en un solo lugar. Corre por
`requireClient()` + `withClient()` como toda ruta que toca GHL. No existe una
acción de borrado.

**7. Helpers de escritura en `lib/ghl-client.ts`:**
`updateContactCustomFields`, `updateOpportunityCustomFields`,
`createCustomFieldDef`, `updateCustomFieldDef`. Se apoyan en el `ghlFetch`
existente (ya hace POST/PUT, ya pasa por el limiter por location). Precedente:
los ~40 helpers de Facebook ya mutan por esta vía.

**⚠ Dos APIs de custom fields distintas — el plan debe tratarlas por separado:**

- **Escribir un VALOR** en un contacto/oportunidad va por los endpoints de
  contacto/oportunidad. Forma de escritura documentada en CLAUDE.md:
  `customFields: [{ id, key, field_value }]` (distinta de la forma de lectura
  `{ id, value }`). La oportunidad usa un endpoint aparte del contacto.
- **Crear/editar una DEFINICIÓN** va por la **Custom Fields V2**
  (`marketplace.gohighlevel.com/docs/ghl/custom-fields/custom-fields-v-2`) — otro
  path, otra versión de header, e identifica el objeto con `objectKey`, no con el
  `model` que devuelve la lectura v1. Es CRUD por object key, con carpetas y un
  Delete que **no** usamos.

Es decir: se **lee** por v1 (lo que ya hace el dashboard) pero se **crea/edita la
definición** por v2. El plan debe confirmar los paths/versiones exactos de v2
contra la doc antes de codificar los dos últimos helpers.

### Herramientas

**Lectura (va siempre, incluso con el toggle apagado):**

| Herramienta | Qué hace |
|---|---|
| `list_field_definitions` | Devuelve id, nombre, tipo y opciones de cada campo de contacto/oportunidad, desde `customFieldDefs`. El modelo la llama antes de escribir para usar el id correcto y valores de picklist válidos. |

**Escritura (solo con toggle encendido; todas pasan por la puerta):**

| Herramienta | Payload | Notas |
|---|---|---|
| `set_contact_fields` | `updates: [{contactId, fields: {nombre: valor}}]`, hasta 50 | Un elemento = edición suelta; N elementos = lote. Valores distintos por registro. |
| `set_opportunity_fields` | `updates: [{opportunityId, fields:{…}}]`, hasta 50 | Igual con oportunidades. |
| `create_custom_field` | `objectKey` (`contact`\|`opportunity`), `name`, `dataType`, `options?` | Alta de definición. |
| `update_custom_field` | `fieldId`, `name?`, `addOptions?` | Renombrar y **agregar** opciones. El código fusiona con las opciones actuales y rechaza si alguna existente desaparecería (No-negociable 6). |

## Flujo de la puerta (exacto)

```
1. El modelo emite uno o más tool_use en un turno.
2. El loop parte los tool_use en tres grupos, por prioridad:
     ask_use   = el ask_user (máx. 1, como hoy)
     writeUses = los que están en WRITE_TOOLS
     readUses  = el resto
3. Ejecuta readUses en paralelo (Promise.all), como hoy.
4. Si hay writeUses:
     - NO ejecuta ninguno.
     - Toma el PRIMERO, calcula su diff leyendo los valores actuales del
       dataset en memoria, y levanta pendingWrite con ese diff.
     - Guarda en pauseStashRef: convo, readResults acumulados, y la COLA
       de writeUses restantes.
     - Pausa. El composer se bloquea.
5. Aprobar:
     - POST /api/ghl-write con action + payload.
     - La respuesta (ok o error) se vuelve el tool_result de ese tool_use.
     - Si quedan writeUses en cola → sale la siguiente tarjeta (vuelve a 4).
     - Si la cola quedó vacía → se arma el mensaje user con TODOS los
       tool_result acumulados (readResults + writes resueltos) y el loop
       reanuda.
6. Cancelar:
     - tool_result = {cancelled: true} — información, NO error.
     - Mismo manejo de cola.
```

**De a uno, en cola:** si el modelo pide 3 escrituras, sale la primera; al
resolverla sale la segunda; luego la tercera. Decisiones independientes (puedes
aprobar una y cancelar otra). No se apilan tarjetas ni se hace una mega-tarjeta.

**Contrato de la API de Anthropic:** cada `tool_use` exige su `tool_result`
emparejado en el siguiente mensaje `user`. Por eso los `tool_result` (lecturas +
escrituras aprobadas) se **acumulan** en `pauseStashRef` y se emiten todos juntos
al vaciarse la cola — misma razón por la que hoy `answer()` arrastra
`partialResults`.

## Manejo de fallas parciales (lotes)

`set_contact_fields` con N registros hace N llamadas a GHL. La ruta **nunca aborta
a la mitad**: ejecuta todas con `Promise.allSettled` (respetando el limiter por
location) y devuelve un desglose:

```json
{ "ok": 20, "failed": 3,
  "failures": [
    { "id": "Kx8f…", "name": "Fernanda Ortiz",
      "error": "campo numérico: '2.5M' no es válido" }
  ] }
```

La tarjeta ya resuelta se re-sella con el resultado real (`⚠ 20 de 23
aplicados · 3 fallaron · ver detalle`). El `tool_result` lleva el mismo desglose,
así que el modelo puede ofrecer reintentar los fallidos con formato corregido —
lo que abre otra tarjeta.

## Consistencia del dataset tras escribir

**Parche optimista en memoria, sin re-sync.** Al aplicar con éxito, el loop
actualiza en el dataset local:

- Valores: el `customFieldsResolved` del registro tocado.
- Definiciones: `create` agrega la entrada nueva a `customFieldDefs` para que el
  modelo pueda usarla de inmediato en la misma conversación; `update` la modifica.

No se re-dispara la sincronización completa (multi-segundos de NDJSON) tras cada
edición: sería desproporcionado. Costo: un cambio hecho fuera de este chat no se
refleja hasta un refresh manual — el mismo comportamiento que el dashboard ya
tiene hoy para todo lo demás. No se introduce una expectativa nueva.

## Fuera de alcance

- **Borrado** de valores o definiciones (irreversible → a mano en GHL).
- **Quitar** opciones de un desplegable (borrado parcial disfrazado).
- **Usuarios** y **agentes IA** — fases siguientes sobre esta misma infra.
- **Credencial de escritura extra** — el servidor solo verifica la cookie de
  acceso existente.

## Deuda registrada: registro de auditoría persistente

**Pendiente explícito, NO entregado en esta fase.** Hoy el único rastro es la
tarjeta sellada en el hilo, que se pierde al reiniciar el chat (GHL conserva su
propio historial por registro, que es la red real cuando algo sale mal).

Un log de escrituras del lado del servidor queda como trabajo futuro. El bloqueo
no es técnico: **el sistema no tiene identidad por persona** (una sola contraseña
compartida para todo el equipo), así que un log solo podría registrar *qué /
cuándo / qué proyecto*, nunca *quién*. Un log de auditoría completo depende de un
spec de identidad previo. Se documenta aquí para no perderlo, no como algo hecho.

## Verificación

No hay framework de tests (ver CLAUDE.md). Añadir un script de assertions bajo
`scripts/` para la lógica que un bug silencioso volvería peligrosa:

- **`WRITE_TOOLS` cubre exactamente `WRITE_TOOL_DEFINITIONS`** (el no-negociable
  central) — verificable en Node puro.
- **La lista blanca de `/api/ghl-write` no contiene ninguna acción de borrado.**
- **La fusión de opciones de `update_custom_field`** nunca produce un arreglo que
  omita una opción existente.

El resto (toggle, tarjeta, puerta, escrituras reales contra GHL) se verifica
manejando la app real, como el resto del proyecto.
