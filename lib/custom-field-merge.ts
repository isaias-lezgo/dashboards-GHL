// Lógica pura para las escrituras de custom fields del asistente. Sin efectos
// de red — probable en Node (scripts/verify-custom-field-merge.ts).

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Quita opciones duplicadas (case-insensitive, ignorando espacios al borde),
 * conservando la primera aparición con su texto original. Se aplica al CREAR un
 * campo, donde GHL acepta duplicados tal cual — al editar, mergePicklistOptions
 * ya deduplica.
 */
export function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const opt of options) {
    const clean = String(opt).trim();
    if (!clean) continue;
    if (seen.has(norm(clean))) continue;
    seen.add(norm(clean));
    out.push(clean);
  }
  return out;
}

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
  updates: Array<{ fields: Record<string, string | string[]> }>,
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
