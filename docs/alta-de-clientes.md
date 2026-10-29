# Alta y baja de un cliente

Runbook del despliegue **`dashboards-ghl`** (dashboards.lezgosuite.com).

Desde el 2026-10-28 un cliente **es** una sub-cuenta con la app de marketplace
instalada. No hay roster en variables de entorno, ni PITs, ni comando de alta.

## Alta

1. En GHL, desde la agencia, instala la app en la sub-cuenta.
2. Listo. GHL avisa por webhook (`INSTALL`), la app relee la lista de
   instalaciones y registra la sub-cuenta en `dashboard_installation` con un
   `client_id` sacado de su nombre ("Stanza Navarra" → `stanza-navarra`).

Si el aviso no llegara, no pasa nada: la primera vez que alguien abra
"Dashboard" desde esa sub-cuenta, el SSO consulta a GHL y la registra ahí mismo.

**Cómo entra el cliente:**
- Desde GHL: menú lateral de la sub-cuenta → **Dashboard**. Sin contraseña.
- Fuera de GHL: dashboards.lezgosuite.com con su **locationId** como contraseña.

## Baja

Desinstala la app de esa sub-cuenta. En menos de un minuto:
- su dashboard deja de abrir (SSO y contraseña),
- se borran su token y su caché (`project_sync`).

La fila en `dashboard_installation` se conserva marcada como desinstalada, así
que si se reinstala recupera el mismo `client_id`.

## Darle una contraseña propia (si su locationId se filtra)

El locationId no es secreto y no se puede rotar. Para un cliente puntual:

```sql
UPDATE dashboard_installation SET password = '<contraseña nueva>' WHERE client_id = '<id>';
```

Desde ese momento su locationId deja de funcionar como contraseña. Para volver
al default, `SET password = NULL`.

## Verificar un alta

- Que aparezca: `SELECT client_id, name, uninstalled_at FROM dashboard_installation;`
- Que sincronice: abrir su Dashboard desde GHL — nombre de la sub-cuenta,
  contactos, oportunidades, pautas, citas.
- Meta: `pnpm check:ads <client_id>` dice si tiene cuenta publicitaria vinculada
  en GHL. "No conectado" se arregla vinculándola **dentro de GHL**, no aquí.

## Dejar el caché tibio

La primera apertura de un cliente nuevo va en vivo contra GHL con la pantalla de
carga. Medido: 5 s (FLX) a 160 s (Terrenos en Venta, 51 mil contactos). Ábrelo tú
una vez después de instalar para que esa espera no la pague el cliente. Una
reinstalación también borra el caché (GHL manda `UNINSTALL` antes de `INSTALL`).

## Lo que un alta NO comprueba

Que el cliente sincronice y quede aislado sí. Que sus **números sean correctos**,
no: si sus pautas están bien clasificadas, si su pipeline mapea a las etapas
esperadas, o si su cuenta nombra el campo de campaña de una forma que
`resolveCampaignName()` (`lib/pauta.ts`) todavía no conoce. Eso sale mirando el
dashboard con alguien que conozca la cuenta. Señales de alarma: 0 pautas, 0
citas, o un pipeline entero cayendo en "Unknown".

## Notas

- El `client_id` es la llave de `project_sync` y va dentro de la cookie de
  sesión. Nunca se reasigna.
- Este despliegue tiene su **propia** Neon (`ep-frosty-term-awf7asfw`). Ahí viven
  el roster y los tokens OAuth: ya no es opcional.
- Cuentas grandes necesitan **Fluid Compute** encendido (Settings → Functions);
  sin él el techo es 60 s y el refresco en segundo plano se corta en silencio.
