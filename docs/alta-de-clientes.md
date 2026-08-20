# Alta de un cliente nuevo

Runbook para agregar una sub-cuenta de GHL al despliegue **`dashboards-ghl`**
(dashboards.lezgosuite.com). Cada paso de aquí está verificado corriéndolo, no
supuesto.

## Lo que se necesita

Tres datos: **nombre**, **locationId** y **token** (`pit-…`). Opcionales: `id`
(por defecto es el slug del nombre) y `password` (por defecto es el `locationId`).

## 1. Generar el roster

```bash
pnpm add-client --name "Nombre" --location <locationId> --token pit-…
```

Sin banderas pregunta interactivamente.

El script **no escribe nada**: lee el roster actual, le agrega el cliente, lo
valida con el mismo `parseClients()` que la app usa al arrancar, e imprime el
blob. Que reuse el validador de la app es lo que garantiza que no pueda emitir
un roster que la app rechace después.

> **Revisa siempre la primera línea:** `Current roster (N): …`.
> Si dice `No DASHBOARD_CLIENTS in this environment — starting a new roster`,
> **no pegues nada** — ese blob trae un solo cliente y pegarlo borra a los demás.
> El script carga `.env.local`, así que no debería pasar; la línea es la
> comprobación de que efectivamente lo cargó.

Rechaza solo: JSON inválido, campos faltantes, `id` mal formado, **`id`
duplicado** y **password duplicado**. Como el password por defecto es el
`locationId`, dos clientes con el mismo `locationId` se rechazan — si no, el
login sería ambiguo.

## 2. Pegar el blob en los DOS lados

- `.env.local` — para desarrollo
- **Vercel → `dashboards-ghl` → Settings → Environment Variables →
  `DASHBOARD_CLIENTS`** (Production)

Son variables independientes: agregar en local no toca producción. **Este es el
paso que se olvida.**

## 3. Redesplegar

Las variables se leen al construir/arrancar la función.

## 4. Verificar

```bash
npx tsc --noEmit
pnpm verify:clients && pnpm verify:auth && pnpm verify:limiter && pnpm verify:sync-store
```

Y contra la app real: entrar con el password del cliente y confirmar que
sincroniza — nombre de la sub-cuenta, contactos, oportunidades, pautas, citas.
Después confirmar en `project_sync` que quedó **su** fila y que no cruzó con
ningún otro cliente.

## 5. Dejar el caché tibio

La primera apertura de un cliente nuevo no tiene fila en `project_sync`, así que
va en vivo contra GHL con la pantalla de carga. Medido: 16 s (Rise 29) a 150 s
(Kapitaliza). **Ábrelo tú una vez después de desplegar** para que esa espera no
la pague el cliente.

## Lo que un alta NO comprueba

Que el cliente sincronice y quede aislado se verifica aquí. Que sus **números
sean correctos**, no: si sus pautas están bien clasificadas, si su pipeline mapea
a las etapas esperadas, o si su cuenta nombra el campo de campaña de una forma
que `resolveCampaignName()` (`lib/pauta.ts`) todavía no conoce. Eso sale mirando
el dashboard con alguien que conozca la cuenta. Señales de alarma que valen
mención: 0 pautas, 0 citas, o un pipeline entero cayendo en "Unknown".

## Notas del caché

- El `id` del cliente es la **llave primaria** de `project_sync`. No reutilizar
  un `id` ya existente en este despliegue.
- Este despliegue tiene su **propia** instancia de Neon. Comparte ids de cliente
  con `dashboards-internos-lezgo`; una base compartida haría que ambos se
  pisaran el payload sin avisar.
- Cuentas grandes: Kapitaliza sincroniza en ~150 s, lo que **exige Fluid Compute**
  encendido (Settings → Functions). Sin él el techo es 60 s y el refresco en
  segundo plano se corta en silencio.
