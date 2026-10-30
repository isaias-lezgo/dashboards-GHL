// Where does a business concept live in THIS account's data? (spec §6.7)
//
// The code never decides what "perdido", "activo" or "calificado" means — the
// same word is a GHL status in one account, a stage in another, a tag or a
// custom-field option in a third. This module only gathers EVIDENCE: every field
// value whose text matches the term, how many records and contacts each reading
// covers, and how much the readings overlap. The model reasons over that and
// asks the user only when the readings would give materially different answers.
import type { EntityId, FilterClause } from "./spec";
import {
  ENTITY_FIELDS,
  ENTITY_SOURCE,
  EMPTY_TAG,
  EMPTY_VALUE,
  SOURCE_DEFS,
  contactsMatchingRelated,
  knownCustomFields,
  listFieldValues,
  matchesClause,
  resolveCtx,
  type EngineContext,
  type ResolvedCtx,
} from "./semantic";
import { ENUM_LABELS_ES, fieldLabel } from "./labels";

export interface TermCandidate {
  entity: EntityId;
  field: string;
  fieldLabel: string;
  values: string[];
  matched: string;
  kind: "value" | "field_name";
  clause: FilterClause;
  records: number;
  contacts: number;
}

export interface TermResolution {
  term: string;
  candidates: TermCandidate[];
  /** Pairwise contact overlap among the first 4 candidates (indexes into `candidates`). */
  overlaps: { a: number; b: number; both: number; onlyA: number; onlyB: number }[];
  unionContacts: number;
  /** A hint, not a verdict: ≥2 readings with real volume whose contacts barely overlap. */
  materiallyDifferent: boolean;
}

export function normalizeTerm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SUFFIXES = ["es", "os", "as", "s", "o", "a"];
const MIN_ROOT = 4;

/** Roots of each word of ≥4 letters: the longest listed suffix is dropped while the root keeps ≥4 letters. */
export function termRoots(s: string): string[] {
  const roots: string[] = [];
  for (const word of normalizeTerm(s).split(/[^a-z0-9ñ]+/)) {
    if (word.length < MIN_ROOT) continue;
    const suffix = SUFFIXES.filter((x) => word.endsWith(x) && word.length - x.length >= MIN_ROOT).sort((a, b) => b.length - a.length)[0];
    roots.push(suffix ? word.slice(0, -suffix.length) : word);
  }
  return roots;
}

// Where to look: enumerable fields per object. Custom fields are added per account.
const SEARCH_FIELDS: Record<EntityId, string[]> = {
  opportunity: ["status", "stage", "pipelineName", "lostReason", "source"],
  contact: ["tags", "source", "attributionMedium"],
  appointment: ["status"],
  task: ["status"],
  pauta: ["tipo"],
};

const ENTITY_ORDER: EntityId[] = ["opportunity", "contact", "appointment", "task", "pauta"];
const MAX_CANDIDATES = 8;
const OVERLAP_TOP = 4;
/**
 * Longer than this, a value is a note, not a category: lezgo-suite's
 * "Comentarios de Negociación" turned every word of its sentences into a
 * "reading" of the concept.
 */
const MAX_CATEGORY_LENGTH = 60;
/** A reading below this share of the largest one's contacts is evidence, not a competing definition. */
const RELEVANT_SHARE = 0.2;

function labelOf(entity: EntityId, field: string): string {
  return ENTITY_FIELDS[entity].find((f) => f.field === field)?.label ?? fieldLabel(field);
}

function countRecords(entity: EntityId, clause: FilterClause, ctx: ResolvedCtx): number {
  const source = ENTITY_SOURCE[entity];
  let n = 0;
  for (const r of SOURCE_DEFS[source].rows(ctx)) if (matchesClause(source, r, clause, ctx)) n++;
  return n;
}

export function resolveTerm(term: string, entityHint: EntityId | null, ctx: EngineContext): TermResolution {
  const r = resolveCtx(ctx);
  const normalized = normalizeTerm(term);
  const roots = termRoots(term);
  const empty: TermResolution = { term, candidates: [], overlaps: [], unionContacts: 0, materiallyDifferent: false };
  if (roots.length === 0) return empty;

  // Each root must START a word: "desactivar bot" is not "activo", while
  // "pulso-activo" and "Prospecto Perdido" are.
  const matches = (text: string): boolean => {
    const n = normalizeTerm(text);
    if (n === normalized) return true;
    const words = n.split(/[^a-z0-9ñ]+/);
    return roots.every((root) => words.some((w) => w.startsWith(root)));
  };

  type Draft = Omit<TermCandidate, "records" | "contacts">;
  const drafts: Draft[] = [];
  for (const entity of ENTITY_ORDER) {
    const source = ENTITY_SOURCE[entity];
    const cfNames = source === "contacts" || source === "opportunities" ? [...knownCustomFields(source, r)].sort() : [];
    const fields = [...SEARCH_FIELDS[entity], ...cfNames.map((n) => `cf:${n}`)];
    for (const field of fields) {
      const enumLabels = ENUM_LABELS_ES[`${entity}.${field}`] ?? {};
      const hit: string[] = [];
      let matched = "";
      for (const { value } of listFieldValues(entity, field, r)) {
        if (value === EMPTY_VALUE || value === EMPTY_TAG || value.length > MAX_CATEGORY_LENGTH) continue;
        const label = enumLabels[value];
        if (matches(value) || (label && matches(label))) {
          hit.push(value);
          if (!matched) matched = label ?? value;
        }
      }
      if (hit.length) {
        drafts.push({
          entity,
          field,
          fieldLabel: labelOf(entity, field),
          values: hit,
          matched,
          kind: "value",
          clause: { anyOf: [{ field, op: "in", values: hit }] },
        });
      }
    }
    // The concept may be a custom field's NAME ("temperatura" → "Temperatura del lead").
    for (const name of cfNames) {
      if (!matches(name)) continue;
      drafts.push({
        entity,
        field: `cf:${name}`,
        fieldLabel: name,
        values: [],
        matched: name,
        kind: "field_name",
        clause: { anyOf: [{ field: `cf:${name}`, op: "is_not_empty", values: [] }] },
      });
    }
  }

  const contactSets = new Map<TermCandidate, Set<string>>();
  const candidates: TermCandidate[] = drafts.map((d) => {
    const set = contactsMatchingRelated({ entity: d.entity, quantifier: "any", conditions: [d.clause] }, r);
    const c: TermCandidate = { ...d, records: countRecords(d.entity, d.clause, r), contacts: set.size };
    contactSets.set(c, set);
    return c;
  });

  candidates.sort((a, b) => {
    if (entityHint) {
      const ha = a.entity === entityHint ? 0 : 1;
      const hb = b.entity === entityHint ? 0 : 1;
      if (ha !== hb) return ha - hb;
    }
    return b.contacts - a.contacts || b.records - a.records;
  });
  const ordered = candidates.slice(0, MAX_CANDIDATES);
  const orderedSets = ordered.map((c) => contactSets.get(c)!);

  const overlaps: TermResolution["overlaps"] = [];
  const top = Math.min(OVERLAP_TOP, ordered.length);
  for (let a = 0; a < top; a++) {
    for (let b = a + 1; b < top; b++) {
      let both = 0;
      for (const id of orderedSets[a]) if (orderedSets[b].has(id)) both++;
      overlaps.push({ a, b, both, onlyA: orderedSets[a].size - both, onlyB: orderedSets[b].size - both });
    }
  }

  const union = new Set<string>();
  for (const s of orderedSets) for (const id of s) union.add(id);

  // Only VALUE readings compete as definitions. A field merely NAMED after the
  // concept ("Motivo de Perdido") describes those records — it stays in the
  // evidence, but on lezgo-suite it alone made nested readings (stage ⊂ status,
  // 398 of 419 contacts) look like a question worth asking.
  const values = ordered.map((c, i) => ({ c, set: orderedSets[i] })).filter(({ c }) => c.kind === "value");
  const pool = values.length ? values : ordered.map((c, i) => ({ c, set: orderedSets[i] }));
  const maxContacts = Math.max(0, ...pool.map(({ c }) => c.contacts));
  const relevant = pool.filter(({ c }) => c.records >= 3 && c.contacts >= RELEVANT_SHARE * maxContacts);
  let materiallyDifferent = false;
  for (let i = 0; i < relevant.length && !materiallyDifferent; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      let both = 0;
      for (const id of relevant[i].set) if (relevant[j].set.has(id)) both++;
      const unionSize = relevant[i].set.size + relevant[j].set.size - both;
      if (unionSize > 0 && both / unionSize < 0.9) {
        materiallyDifferent = true;
        break;
      }
    }
  }

  return { term, candidates: ordered, overlaps, unionContacts: union.size, materiallyDifferent };
}
