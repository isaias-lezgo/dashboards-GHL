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
