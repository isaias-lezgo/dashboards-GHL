// Resolved custom fields (`customFieldsResolved`) hold a plain string for
// single-value fields and keep their array shape for multi-option / checkbox
// fields. These helpers normalize both, so contacts and opportunities can be
// filtered, grouped and enumerated by any custom field through the
// `cf:<Field Name>` (alias `customField:<Field Name>`) convention.
// Shared by the AI assistant tools (lib/ai-tools.ts) and the panel engine
// (lib/widgets/semantic.ts) so both read custom fields identically.

export type CustomFieldsResolved = Record<string, string | string[]> | undefined;

// Case-insensitive lookup of a custom-field value by display name.
export function cfLookup(resolved: CustomFieldsResolved, name: string): string | string[] | undefined {
  if (!resolved) return undefined;
  if (name in resolved) return resolved[name];
  const target = name.trim().toLowerCase();
  for (const k of Object.keys(resolved)) {
    if (k.toLowerCase() === target) return resolved[k];
  }
  return undefined;
}

// Normalize a resolved custom-field value to a flat array of trimmed strings.
export function cfValues(resolved: CustomFieldsResolved, name: string): string[] {
  const v = cfLookup(resolved, name);
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => String(s)).filter((s) => s.trim() !== "");
}

// If `field`/`groupBy` is "cf:Name" or "customField:Name", return the field name.
export function customFieldName(spec: string): string | null {
  const m = /^(?:cf|customField):(.+)$/.exec(spec);
  return m ? m[1].trim() : null;
}
