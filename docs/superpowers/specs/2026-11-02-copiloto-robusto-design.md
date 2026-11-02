# Copiloto más robusto — Diseño

**Fecha:** 2026-11-02
**Estado:** Borrador para revisión del dueño. Sale de una conversación con él
y de revisar los cuatro tableros hechos a mano que tenemos (VAEO, Grupo DRT,
Lezgo y Cellarium, ~60 visuales). Lo que decidí yo, sin que el dueño lo dijera,
está marcado **[Decisión mía]**.
**Se apoya en:** `docs/superpowers/specs/2026-10-29-paneles-autogestionables-ia-design.md`
(el panel con IA, ya construido en la rama `feat/panel-ia`) y en la sección
"AI-managed panel" de `CLAUDE.md`. Todo lo que ahí es invariante lo sigue siendo.

---

## 0. Resumen en un minuto

El dueño empezó a probar el panel y chocó con su límite principal: **cada
gráfica lee una sola fuente.** Pidió "contactos y oportunidades por semana, en
una sola gráfica, para contrastar" y el copiloto contestó que no se podía.

La meta es que lo que hoy programamos a mano por cliente se pueda pedir al
copiloto en español. No al 100% ("no vamos a poder igualar un panel hecho con
código"), pero sí lo que más se repite en los tableros a mano. Concretamente:

1. Varias fuentes en una sola gráfica.
2. Proporciones, tanto dentro del mismo grupo como entre fuentes.
3. Campos personalizados de tipo fecha como eje y como periodo ("Fecha de Cierre").
4. Un concepto repartido en varios campos ("Sucursal VAEO" o "Sucursal MESH").
5. Estado ganada / abierta / perdida como campo listo.
6. La matriz: tabla cruzada con totales y sombreado.
7. "Días desde" una fecha, en rangos.
8. Las conversaciones como fuente, con 60 días por omisión.
9. Con 5, 6, 7 y 8: la matriz "Oportunidades sin atención" de VAEO.
10. Que el copiloto pueda decir que no, pero ofreciendo lo más cercano. El
    usuario decide.

Se prueba con cuentas que ya tienen la app instalada. **VAEO no**: el dueño
decidió no instalarla.

## 1. Qué es y por qué

Palabras del dueño:

- "Quiero que sea capaz de crear paneles complejos como esto."
- "No solo jale una fuente de datos."
- "No es necesario replicar la tabla súper cabrona de VAEO. Pero la de opps y
  contactos sí, también la de las ventas por sucursal y ciudad y eso."
- Sobre decir que no: "sí puede contestar no, ofrecer lo más cercano y ya
  decide el usuario."
- Proporciones: "sí me interesan."
- Conversaciones: "quiero que sea capaz de hacer el mismo gráfico ese de VAEO.
  No es necesario más de 60 días… no lo limitemos, pero dejemos como default
  max 60 días a menos que lo pidan explícitamente. Que dé un aviso."

Hoy cada tablero de cliente es un repositorio aparte, con días de programación.
Si el copiloto arma lo que más se repite, un cliente nuevo tiene su tablero
hablando, y los repos a mano quedan para lo verdaderamente único.

### Lo que se repite en los cuatro tableros (evidencia)

| Capacidad | Dónde aparece |
|---|---|
| Varias fuentes en una gráfica | Lezgo: "Línea de tiempo de contactos y oportunidades" e "Indicadores por semana" (leads, perfilamientos, citas, apartados). Cellarium: KPI "contactos sin oportunidad". La imagen del dueño. |
| Fecha personalizada | VAEO: "Fecha de Cierre" (pivote, ventas por sucursal, ventas por servicio). Lezgo: "Fecha de apartado" y "Fecha de cierre" (casi todo el tablero de desempeño, más el ciclo de decisión). |
| Concepto en varios campos | VAEO: Sucursal VAEO/MESH, Origen de Lead/Origen del lead, Canal de Contacto/Canal del contacto. DRT: el campo de la oportunidad y, si está vacío, el del contacto. Lezgo: la plaza en tres campos. |
| Ganada / abierta / perdida | "Oportunidades por estado" en VAEO, Cellarium y DRT. Leads sin asesor por mes o semana. |
| Matriz con totales | Asesor × etapa (VAEO, Cellarium, DRT). Motivo de pérdida × canal o campaña (los cuatro). Pérdidas por dimensión × dimensión (VAEO, DRT). |
| Días desde | "Oportunidades sin atención" (VAEO, Cellarium, DRT). Tareas por vencimiento (VAEO). |
| Conversaciones | La misma matriz "sin atención": la fecha de nuestro último mensaje saliente al contacto. |

## 2. Metas, no-metas y anti-metas

### Metas

- Las diez capacidades del resumen, cada una explicada en §3.
- La pregunta de la imagen del dueño ("contactos y oportunidades creados por
  semana, juntos") sale en una sola gráfica.
- "Oportunidades por estado" por mes de creación sale con los mismos números
  que en los tableros a mano.
- Lo mismo para "ventas ganadas por sucursal y por mes de Fecha de Cierre".
- Lo mismo para "oportunidades sin atención".
- El panel guardado del piloto (lezgo-suite) sigue abriendo igual, sin pasos
  manuales.

### No-metas (por ahora)

- La tabla de VAEO de tres niveles con subtotales (mes × sucursal › servicio).
  El dueño dijo que no hace falta.
- El cruce del gasto en Meta con anuncios y campañas que tienen DRT y Lezgo.
- Metas por asesor y semáforos del tablero de desempeño de Lezgo.
- Gráficas de dos ejes o combinadas (barra más línea), por la convención del
  repo. Se ofrecen dos tarjetas lado a lado.
- El embudo acumulado ("llegó a esta etapa o a una posterior"). El embudo del
  panel muestra el estado actual, y eso es un invariante.
- Analítica de mensajes uno por uno (mensajes por día, tiempo de respuesta).
- Normalizar texto libre (juntar "Facebook" con "facebook"). Los valores se
  muestran como están guardados.
- El interruptor dentro de la tarjeta ("Todas / Sin asesor"). Se resuelve con
  dos tarjetas.
- Llevar estas capacidades a la pestaña Asistente IA, que se queda como está.

### Anti-metas (si pasa esto, fracasó aunque "funcione")

- Una gráfica que junta fuentes y se lee como si fueran los mismos registros.
  Ejemplo: una proporción entre grupos distintos que no lo dice.
- Un campo de texto tratado como fecha por cómo se ve. En Jerry Medina,
  "Fecha de última asignación" mezcla `10/22/2025` (mes/día) con
  `20/05/2026` (día/mes) en el mismo campo. Adivinar daría meses equivocados
  en silencio.
- Una gráfica de conversaciones que muestra ceros mientras carga, o cuando la
  carga falló.
- Romper el panel guardado del piloto, o el cuerpo de la petición del
  Asistente IA (que una prueba fija byte por byte).
- Que el copiloto construya un sustituto que el usuario no eligió.
- Un copiloto que pregunta todo. Siguen vigentes las reglas de cuándo
  preguntar.

## 3. Capacidades

### 3.1 Varias fuentes en una gráfica (series)

El usuario dice "contactos y oportunidades creados por semana, juntos".

- Una gráfica puede tener **varias series**. Cada serie es su propia consulta:
  fuente, métrica, filtros, filtros entre objetos y su propio campo de fecha.
  Las series comparten el **eje**, que es una de dos cosas:
  - Un periodo (día, semana, mes…). Cada serie usa su propio campo de fecha:
    los contactos por su creación, las oportunidades por la suya.
  - Una categoría que exista en todas las series. Ejemplo: "fuente", leída
    directamente o a través del contacto (`contact.source`).
- Las series son la segunda dimensión. Con varias series no hay otra
  agrupación encima.
- **Misma unidad.** Las series que se muestran comparten unidad: conteos con
  conteos, dinero con dinero o porcentajes con porcentajes. Si no, el
  validador lo rechaza con un mensaje en español que sugiere dos tarjetas.
  Nunca dos ejes.
- **Tipos de gráfica:** barras agrupadas (la opción por omisión), líneas,
  área y tabla. En la tabla, las filas son el eje y cada serie es una columna
  (cubre los "indicadores por semana" de Lezgo).
  - **No se permiten barras apiladas entre series de fuentes distintas.**
    Apilar sugiere un total, y "contactos + oportunidades" no es un total de
    nada. **[Decisión mía]**
- **Filtros globales:** cada serie recibe la fecha y el pipeline del panel con
  las mismas reglas por fuente que hoy. Por ejemplo, Meta ignora los filtros
  del CRM y lo dice.
- Al hacer clic en una barra se ven los registros de esa serie en ese periodo.
- La tarjeta explica la regla de cada serie.
- Comparar contra el periodo anterior queda fuera cuando hay varias series.
  **[Decisión mía]**

### 3.2 Proporciones

Hay dos tipos, y el copiloto los distingue porque significan cosas distintas.

**a) Proporción del mismo grupo.** Se arma con un grupo base y una condición
adicional; el numerador es, por construcción, parte de la base. Ejemplos:

- "De cada 100 contactos de la semana, ¿cuántos tienen oportunidad?" Base:
  contactos creados en la semana. Condición: tienen alguna oportunidad.
- "¿Qué % de las oportunidades del mes se ganaron?"
- "¿Qué % de los leads tuvo cita?"

Es una conversión real y la tarjeta la llama así.

**Se cuenta hasta hoy (cohorte).** Lo decidió el dueño. De los contactos
creados esa semana, ¿cuántos tienen oportunidad a la fecha, aunque se haya
creado después? Es el mismo criterio del "% ganadas" de VAEO.

- La condición sobre otro objeto (tiene oportunidad, tuvo cita, se ganó) no se
  recorta al periodo de la tarjeta.
- Las semanas recientes se ven más bajas porque todavía no maduran. La tarjeta
  lo dice: "cuenta hasta hoy; los periodos recientes siguen madurando".

**Las tasas que ya existen se quedan como están.** `win_rate`,
`appointment_rate` y `show_rate` siguen igual por paridad con Ventas. Por
ejemplo, `appointment_rate` cuenta solo las citas del periodo.

- Si el usuario pide "la tasa de citas" como la de Ventas, el copiloto usa la
  métrica existente.
- Si pregunta "de los leads de octubre, ¿cuántos tuvieron cita?", usa la forma
  de cohorte.
- La tarjeta dice cuál de las dos es, para que dos números distintos nunca
  parezcan el mismo.

**Pipeline.** Las tarjetas cuyo tema es tener o no tener oportunidad ignoran
el filtro de pipeline y lo dicen, como las de Meta. Es el caso de "contactos
sin oportunidad" o "% de contactos con oportunidad".

- Con el filtro puesto, el panel solo deja los contactos que tienen oportunidad
  en ese pipeline. "Sin oportunidad" daría siempre 0 y "con oportunidad"
  siempre 100%.
- Cellarium hace lo mismo con su KPI de contactos sin oportunidad.
- **[Decisión mía]**

**b) Cociente entre series.** Es serie A ÷ serie B con fuentes o fechas
distintas. Ejemplos:

- "Oportunidades creadas ÷ contactos creados, por semana."
- El costo por lead, que ya existe como `cpl`.

Sirve para comparar ritmos, pero **no son los mismos registros**. La tarjeta
lo dice siempre, por ejemplo: "Las oportunidades de una semana no son
necesariamente de los contactos de esa semana".

**Reglas comunes:**

- Cuando el usuario pregunta "cuántos de ellos…", el copiloto usa el tipo a.
- Si el denominador es 0, el valor queda vacío ("—"). Nunca 0 ni infinito.
- Una gráfica muestra conteos o porcentajes, no las dos cosas (no hay dos
  ejes). Las series que forman la proporción pueden ir ocultas.
- Un KPI de proporción muestra el porcentaje y debajo "X de Y".

### 3.3 Campos personalizados de fecha

El usuario dice "ventas ganadas por mes de Fecha de Cierre" o "lo que se cerró
en octubre".

- Solo cuenta como fecha un campo que GHL tenga **marcado como tipo fecha**.
  - La sincronización ya pide las definiciones de los campos (con su tipo),
    pero hoy solo guarda el nombre. Tiene que guardar también el tipo.
  - Un campo de texto que parezca fecha nunca es fecha (ver anti-metas).
- **Cómo llega el valor:** como número de milisegundos a medianoche UTC. Se
  ve en tres cuentas: lezgo-suite "Diagnóstico · Fecha" `1790812800000`,
  rise-29 "Fecha de Contacto" y el-fundador-saki "Fecha de Primera Visita".
  - **Se lee como fecha de calendario en UTC.** Leído en hora local, el día 1
    cae en el mes anterior; VAEO ya lo aprendió por las malas.
  - Estos campos no se pueden agrupar por hora.
- **Dónde se usa:**
  - como eje con periodo (día, semana, mes, trimestre);
  - como periodo de la tarjeta ("de octubre, por Fecha de Cierre");
  - con el filtro de fecha del panel, cuando la tarjeta mide por ese campo;
  - en filtros (antes de / después de).
- **Registros sin fecha.** Aplica la regla que el motor ya usa para las fechas
  secundarias: si a una tarjeta con periodo le falta la fecha, el evento no
  ocurrió y el registro no entra.
  - Cuando eso deja registros fuera, la tarjeta lo dice: "N ganadas sin Fecha
    de Cierre no aparecen". Se puede hacer clic para verlas.
  - En un eje sin periodo ("todo"), aparecen al final como "Sin <campo>", en
    tono apagado.

  **[Decisión mía]** VAEO muestra "Sin fecha de cierre" bajo cualquier filtro.
  Aquí se dice cuántos quedan fuera y se pueden ver, sin meterlos en totales
  de un periodo al que no pertenecen.
- **Cachés guardados antes de este cambio** no traen los tipos. Hasta la
  siguiente actualización, el validador responde: "Este campo se podrá usar
  como fecha después de la próxima actualización".

### 3.4 Un concepto repartido en varios campos (campo combinado)

El usuario dice "ventas por sucursal". En VAEO la sucursal vive en "Sucursal
VAEO" o en "Sucursal MESH", según el pipeline.

- **Una dimensión puede ser una lista de campos en orden:** se toma el primero
  que tenga valor. La lista puede cruzar del objeto a su contacto. Ejemplo:
  "Canal de contacto" de la oportunidad y, si está vacío, "Canal de Contacto"
  del contacto (es la regla de DRT).
- **Se guarda en el glosario del cliente** como un concepto de tipo "campo":
  "sucursal = Sucursal VAEO → Sucursal MESH". Así la siguiente conversación no
  vuelve a preguntar.
  - La tarjeta guarda la lista ya expandida, no una referencia al concepto. Es
    el mismo invariante que hoy rige las cláusulas.
- **`resolve_term` lo detecta como evidencia.** Cuando un concepto coincide
  con varios campos que casi no se traslapan (cada registro llena uno u otro),
  lo ofrece como lectura candidata, "combinar los dos campos". El modelo
  pregunta solo si las lecturas dan respuestas materialmente distintas, como
  hoy.
- **Filtrar por un campo combinado** usa la misma regla que la gráfica: el
  primer campo con valor. Es una capacidad nueva del motor, y funciona también
  cuando la lista cruza de la oportunidad al contacto. **[Decisión mía]**
  - Un "o" entre los campos no sirve, por dos razones. No cruza de un objeto a
    otro. Y cuando los dos campos tienen valores distintos, el filtro
    encontraría registros que la gráfica pone bajo el otro valor.
- **La barra de filtros del panel** puede tener un control sobre un campo
  combinado. Es el filtro "Sucursal" de VAEO, que lee cualquiera de los dos
  campos.

### 3.5 Estado ganada / abierta / perdida

El usuario dice "oportunidades por estado, por mes de creación" (imagen 3 del
dueño).

- Un campo derivado de la oportunidad, que también se alcanza desde otras
  fuentes vía `opportunity.`:
  - **Ganada** = `isWonOpp`, la regla única del repo.
  - **Perdida** = perdida o abandonada, y no ganada.
  - **Abierta** = el resto.
- **Orden natural:** Ganada, Abierta, Perdida.
- **Colores fijos con significado**, igual que en los tableros a mano: verde,
  azul pizarra y rojo.
- La regla de Cellarium ("todo lo que está en el pipeline Leads Perdidos es
  perdida") es de ese cliente. Se resuelve con el glosario, no con este campo.

### 3.6 La matriz

El usuario dice "oportunidades por asesor y etapa" o "motivos de pérdida por
canal".

- Es un tipo de gráfica nuevo. Lleva dos dimensiones (filas y columnas) y una
  métrica.
- **Totales:**
  - Hay total por fila, total por columna y gran total.
  - **Se calculan con los registros de cada fila o columna, no sumando
    celdas.** Con campos de varios valores, un registro puede estar en varias
    celdas.
  - Si las celdas pueden sumar más que el total, la tarjeta lo dice, como ya
    lo dice hoy con las barras.
- **Sombreado** de intensidad sobre toda la matriz. Las filas y columnas
  "Sin X" no cuentan para la escala.
- "Sin X" y "Otros" van al final. Las etapas siguen el orden del pipeline,
  porque el motor ya conoce ese orden natural.
- Clic en una celda: se ven sus registros. Clic en un total: se ven los de
  toda la fila o columna.

### 3.7 "Días desde"

El usuario dice "por días sin cambio de etapa".

- Es una forma nueva de agrupar cualquier fecha (nativa, personalizada o del
  contacto): los días entre esa fecha y **hoy**, en rangos.
  - **Rangos por omisión:** 0–7, 8–15, 16–30, 31–60 y más de 60. Los mismos de
    los tres tableros.
  - El copiloto puede elegir otros rangos.
- Si falta la fecha, el registro cae en su propio grupo. Las fechas futuras
  van aparte ("Fecha futura") y no se mezclan con "0 días".
- **Filtros relativos:** se puede filtrar "hace más de N días". Con eso se
  arma el KPI del cuadrante crítico.
- Una tarjeta de "días desde" suele ser una foto de hoy: el copiloto le pone
  periodo "todo" en vez del filtro de fecha. Ya existe la forma de hacerlo.

### 3.8 Las conversaciones como fuente

- **Fuente nueva: conversaciones.** Una fila por conversación con actividad
  en el periodo:
  - contacto;
  - canal (WhatsApp, SMS, correo, Facebook, Instagram…);
  - asesor;
  - fecha del último mensaje;
  - si el último mensaje fue entrante o saliente;
  - mensajes sin leer;
  - fecha de creación.
- **Fechas del contacto** que se usan desde cualquier fuente vía `contact.`:
  - **último mensaje saliente nuestro**;
  - último mensaje entrante;
  - último mensaje.

  Se derivan como lo hace VAEO (`DASHBOARDS_VAEO/app/api/conversation-activity`):
  - Si la conversación termina en saliente, la fecha del último mensaje ya es
    la buscada. Fue el ~93% de los casos en VAEO.
  - Solo se abre el hilo cuando termina en entrante y cae dentro del periodo.
  - Los mensajes automáticos cuentan como salientes, como en VAEO.
    **[Decisión mía]** Es lo que el dueño ya ve en VAEO.
  - Las actividades del sistema no son mensajes.
- **Ventana de carga por omisión: 60 días de actividad.** La ventana es de cada
  tarjeta, y el dueño lo decidió así:
  - **El filtro de fecha del panel nunca la amplía.** Si el panel dice "Todo el
    historial" o "Este año", la tarjeta carga 60 días y lo dice: "Mostrando los
    últimos 60 días de conversaciones".
  - **Solo se amplía si el usuario se lo pide al copiloto.** No hay tope. La
    ampliación queda guardada en esa tarjeta.
  - Cada visita vuelve a cargar con el aviso: **"Recomendamos limitar el
    periodo a 60 días o menos para reducir el tiempo de carga."**
  - En una sesión, las tarjetas comparten la carga. La ventana más amplia que se
    pida se carga una vez y sirve a todas.
  - Las tarjetas de otras fuentes que usan el último mensaje del contacto
    (como la de "sin atención") siguen la misma regla: 60 días, salvo que se
    pida más.
- **Fuera de la ventana no hay dato.** A un contacto sin mensajes en la ventana
  no se le inventa fecha: cae en "Más de N días o sin mensajes", donde N es la
  ventana. Es la etiqueta honesta; VAEO lo mete en "+60".
  - Si alguien pide rangos de "días desde" más allá de la ventana, el copiloto
    amplía la ventana (con el aviso) o le dice al usuario que ese rango no se
    puede medir con 60 días.
- **Carga:**
  - Ocurre solo cuando una tarjeta o el copiloto necesita conversaciones. Va
    en segundo plano, con progreso, y queda en memoria durante la sesión.
  - No entra al caché de sincronización (`project_sync`): las conversaciones
    cambian todo el tiempo y el caché ya es grande. **[Decisión mía]**
  - La tarjeta dice "Cargando conversaciones…" y **no dibuja nada hasta tener
    los datos completos**.
  - Si falla, la tarjeta muestra el error y un botón de reintentar. El resto
    del panel no se entera.
- La muestra de mensajes que usa la pestaña Asistente IA no cambia.
- **Qué se puede medir:**
  - conversaciones o contactos;
  - por canal, por asesor, por último mensaje ("esperando respuesta nuestra" =
    el último fue entrante) o por sin leer;
  - por periodo o por "días desde".

### 3.9 La matriz "Oportunidades sin atención" (la de VAEO)

Se arma con las piezas anteriores:

- **Fuente:** oportunidades con estado Abierta (más filtros propios del
  cliente: VAEO excluye la etapa "Cliente Futuro").
- **Filas:** días desde el último cambio de etapa.
- **Columnas:** días desde nuestro último mensaje saliente al contacto.
- **Tipo:** matriz, con periodo "todo".

Requisitos:

- La sincronización tiene que guardar la **fecha del último cambio de etapa**
  de cada oportunidad. GHL la manda y hoy se pierde.
  - Si falta, se usa la fecha de creación, como hace VAEO, y la tarjeta lo
    dice.
  - Los cachés anteriores al cambio no la traen hasta la siguiente
    actualización. La tarjeta lo dice en vez de usar la de creación para
    todos en silencio.
- El cuadrante crítico, por ejemplo 16 días o más en los dos ejes, se arma
  como un KPI aparte con dos filtros relativos (§3.7).

### 3.10 Cuando algo no se puede

- El copiloto **puede decir que no**:
  - Dice en una frase, en términos de negocio, qué no se puede y por qué.
  - Ofrece con `ask_user` lo más cercano que sí puede armar (de 1 a 3
    opciones).
  - **Construye solo cuando el usuario elige.**
  - Nunca arma un sustituto por su cuenta.
  - Nunca dice "no" a secas si existe una alternativa.
- **Antes de decir que no, usa las capacidades nuevas.** El caso de la imagen
  del dueño tiene que salir.
- Esto reemplaza la parte de la regla 0 del prompt del panel que lo empujaba a
  crear siempre un widget. Cuando sí se puede, cada pregunta de datos sigue
  terminando en un widget.

## 4. Lo que cambia por debajo (restricciones para quien construya)

- **Los paneles guardados siguen abriendo.** `dashboard_doc` es contenido del
  cliente. Cualquier campo nuevo del documento tiene un valor por omisión al
  leerse, o se migra al leer, de forma que un documento viejo valga sin
  intervención. Hay una prueba con un documento real guardado antes del
  cambio.
- **Herramientas estrictas.** Las herramientas del widget y de los filtros no
  son estrictas, así que su esquema puede crecer.
  - Si se toca algún esquema estricto, se corre `pnpm check:strict-tools`
    (cuesta ~$0.05).
  - El límite real de la API es de ~9 herramientas estrictas por petición.
- **Glosario.** Agrega el tipo "campo" (§3.4). El snapshot del panel lo lleva
  igual que hoy las cláusulas: tal cual.
- **Snapshot y descripción** (`describe.ts`). Explican cada serie, cada
  proporción (qué tipo y de qué) y cada campo combinado.
- **Sincronización** (`lib/sync.ts`). Guarda el tipo de cada campo
  personalizado y la fecha del último cambio de etapa (y la del último cambio
  de estado, de paso).
  - El caché es desechable: lo viejo se rellena solo en la siguiente
    actualización.
  - Las tarjetas que dependen de algo nuevo dicen "pendiente hasta la próxima
    actualización". Es la misma lección que `AdsPendingNotice`: una ausencia
    de datos no se presenta como un hecho.
- **Conversaciones.** Una ruta nueva de solo lectura, con `requireClient()` +
  `withClient()`, que entra al contexto **dentro** del stream, igual que
  `dashboard-messages`. Pasa por el limitador por cuenta. El permiso de lectura
  de conversaciones ya lo tiene la app.
- **El Asistente IA no cambia.** La prueba que compara byte por byte el cuerpo
  de su petición sigue pasando.
- **Rama:** se sigue en `feat/panel-ia`, que aún no se integra a `main`.
  **[Decisión mía]** Separarla obligaría a integrar primero algo que el dueño
  está probando.

## 5. Verificación

Sin VAEO; con cuentas que ya tienen la app.

- **Pruebas unitarias** en `scripts/verify-widgets.ts`, una o más por
  capacidad:
  - fechas personalizadas a medianoche UTC del día 1;
  - campos combinados con y sin el segundo campo;
  - proporción del mismo grupo contra cociente entre series;
  - totales de la matriz con campos de varios valores;
  - bordes de "días desde" (7/8, 15/16, 60/61, fecha futura);
  - el último saliente cuando la conversación termina en entrante;
  - un documento viejo que sigue abriendo.
- **Comparación contra la lógica de VAEO, con datos reales de otras cuentas.**
  Se copian a un script de solo lectura, como referencia, las funciones puras
  de VAEO ("sin atención", ventas por dimensión, estado por mes). Luego se
  compara contra el motor sobre los cachés reales, igual que
  `check:widget-parity`.

  | Cuenta | Qué se prueba |
  |---|---|
  | lezgo-suite (piloto) | Conversaciones en vivo, fecha personalizada de contacto ("Diagnóstico · Fecha"), "sin atención" |
  | condesa-cimatario | Campo combinado: "Canal de contacto" (oportunidad) → "Canal de Contacto" (contacto) |
  | stanza-residencial | Campo combinado: "Canal de Prospección del Lead" → "Canal de Prospección" |
  | rise-29 | Campo combinado: "Proyecto" (oportunidad) → "Proyecto" (contacto); fecha "Fecha de Contacto" |

  Ninguna cuenta instalada tiene un campo de fecha **de oportunidad** con
  volumen, así que ese caso se prueba con datos de prueba.
- **En la app, con lezgo-suite:**
  - la petición de la imagen del dueño;
  - "oportunidades por estado por mes";
  - una matriz asesor × etapa;
  - "sin atención" con su aviso de carga;
  - un KPI de proporción;
  - un caso que no se puede, con la oferta de lo más cercano.
- **Evaluación con lenguaje natural.** Se agregan ~12 casos al corpus, al menos
  uno por capacidad, incluyendo un "no" con oferta.
  - Cuesta dinero (~$2.70 por corrida de dos cuentas en la última vez).
  - **Se corre solo cuando el dueño apruebe el presupuesto.**

## 6. Lo que queda a quien construya

- La forma exacta en JSON de las series, las proporciones, los rangos de "días
  desde" y los filtros relativos.
- Cómo se ve la matriz: tamaños, cuántas columnas antes de "Otros", si hay
  "ver más".
- El diseño de la ruta de conversaciones: tomar como base la de VAEO,
  paginación y topes de seguridad.
- La forma del control de la barra de filtros sobre un campo combinado.
- Los textos exactos de los avisos, salvo el de 60 días, que el dueño dictó.

## 7. Decisiones mías (para que el dueño las revise)

1. No se permiten barras apiladas entre series de fuentes distintas (§3.1).
2. Sin comparación con el periodo anterior cuando hay varias series (§3.1).
3. Los registros sin la fecha personalizada no entran a una tarjeta con
   periodo. Se cuentan y se pueden ver (§3.3).
4. Los mensajes automáticos cuentan como salientes (§3.8).
5. Las conversaciones se cargan bajo demanda y no van al caché (§3.8).
6. Se sigue en la rama `feat/panel-ia` (§4).
7. Filtrar un campo combinado usa "primer campo con valor", no un "o" (§3.4).
8. Las tarjetas de tener o no tener oportunidad ignoran el filtro de pipeline y
   lo dicen (§3.2).

Las decidió el dueño, a partir de las preguntas del revisor:

- La ventana de conversaciones es de cada tarjeta. El filtro del panel no la
  amplía (§3.8).
- Las proporciones del mismo grupo se cuentan hasta hoy, como cohorte (§3.2).
