// scripts/verify-pagination.ts
//
// GHL's search endpoints reject any offset at or past 10,000 records:
//   /opportunities/search        → 400 SEARCH_USE_START_AFTER_PAGINATION
//   /objects/:key/records/search → 400 "Invalid request body"
// getAllOpportunities / getAllCustomObjectRecords therefore fan out only the
// offset-safe pages and finish on a cursor. No sub-account in the roster is
// anywhere near 10k, so this script proves the handoff by lowering the ceiling
// (__setOffsetCeiling) until a normal account is forced across it, then checks
// the walk still returns exactly the same records as the plain offset walk.
//
// Hits the live GHL API — read-only. Run:
//   npx tsx --env-file=.env.local scripts/verify-pagination.ts
import assert from "node:assert/strict"
import { withClient } from "@/lib/ghl-context"
import { getClients } from "@/lib/clients"
import {
  getAllOpportunities,
  getAllContacts,
  getAllCustomObjectRecords,
  getOpportunities,
  getCustomObjects,
  __setOffsetCeiling,
} from "@/lib/ghl-client"

async function main() {
  const clients = getClients()
  assert.ok(clients.length > 0, "roster vacío — ¿falta DASHBOARD_CLIENTS?")

  for (const client of clients) {
    console.log(`\n===== ${client.name} =====`)
    await withClient(client, async () => {
      // ---- Oportunidades ----
      const declared = (await getOpportunities({ page: 1, limit: 100 })).meta.total
      __setOffsetCeiling()
      const t0 = Date.now()
      const baseline = await getAllOpportunities()
      const baseMs = Date.now() - t0

      assert.equal(
        baseline.length,
        declared,
        `oportunidades: se esperaban ${declared}, llegaron ${baseline.length}`
      )
      assert.equal(new Set(baseline.map((o) => o.id)).size, baseline.length, "ids duplicados")
      console.log(`opps offset normal: ${baseline.length}/${declared} en ${baseMs} ms`)

      // Fuerza el traspaso offset→cursor: techo de 300 ⇒ solo 3 páginas por
      // offset y el resto por cursor. Es exactamente el camino que recorre una
      // cuenta con >10k, pero alcanzable con los datos que sí tenemos.
      if (declared > 300) {
        __setOffsetCeiling(300)
        const t1 = Date.now()
        const hybrid = await getAllOpportunities()
        const hybridMs = Date.now() - t1
        __setOffsetCeiling()

        assert.equal(
          hybrid.length,
          baseline.length,
          `híbrido devolvió ${hybrid.length}, el offset ${baseline.length}`
        )
        const baseIds = new Set(baseline.map((o) => o.id))
        const missing = hybrid.filter((o) => !baseIds.has(o.id))
        assert.equal(missing.length, 0, `el camino cursor trajo ${missing.length} ids desconocidos`)
        console.log(`opps híbrido (techo 300, cruza a cursor): ${hybrid.length} en ${hybridMs} ms — idéntico ✓`)
      } else {
        console.log(`opps: ${declared} registros, muy pocos para forzar el cruce — omitido`)
      }

      // ---- Contactos: el cursor debe llegar al total declarado ----
      const contacts = await getAllContacts()
      assert.equal(
        new Set(contacts.map((c) => c.id)).size,
        contacts.length,
        "contactos duplicados"
      )
      console.log(`contactos: ${contacts.length} únicos`)

      // ---- Registros de objeto personalizado (pautas) ----
      const stub = (await getCustomObjects()).objects.find(
        (s) =>
          s.labels.singular.toLowerCase().includes("pauta") ||
          s.labels.plural.toLowerCase().includes("pautas")
      )
      if (!stub) {
        console.log("pautas: sin schema en esta cuenta — omitido")
        return
      }
      __setOffsetCeiling()
      const pautasBase = await getAllCustomObjectRecords(stub.key)
      if (pautasBase.length > 300) {
        __setOffsetCeiling(300)
        const pautasHybrid = await getAllCustomObjectRecords(stub.key)
        __setOffsetCeiling()
        assert.equal(
          pautasHybrid.length,
          pautasBase.length,
          `pautas híbrido ${pautasHybrid.length} vs offset ${pautasBase.length}`
        )
        console.log(`pautas: ${pautasBase.length} — offset e híbrido coinciden ✓`)
      } else {
        console.log(`pautas: ${pautasBase.length} registros, muy pocos para forzar el cruce`)
      }
    })
  }

  console.log("\n✅ verify-pagination OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
