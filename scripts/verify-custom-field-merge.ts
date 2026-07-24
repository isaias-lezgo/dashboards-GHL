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
