// Contact-hub join index. Appointments, pautas, and messages only relate to
// opportunity value through their shared contact. Precomputing reverse lookups
// once lets the `relate` tool traverse those links in code (one turn) instead of
// the model orchestrating a multi-turn contactId join.

import type {
  Contact,
  Opportunity,
  Pauta,
  Appointment,
  Message,
} from "@/lib/types";
import type { ChatDataset } from "@/lib/ai-tools";

export interface ChatIndex {
  contactById: Map<string, Contact>;
  oppsByContact: Map<string, Opportunity[]>;
  pautasByContact: Map<string, Pauta[]>;
  apptsByContact: Map<string, Appointment[]>;
  msgsByContact: Map<string, Message[]>;
}

function pushTo<T>(map: Map<string, T[]>, key: string | undefined, val: T): void {
  if (!key) return;
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

export function buildChatIndex(data: ChatDataset): ChatIndex {
  const contactById = new Map<string, Contact>();
  for (const c of data.contacts) contactById.set(c.id, c);

  const oppsByContact = new Map<string, Opportunity[]>();
  for (const o of data.opportunities) pushTo(oppsByContact, o.contactId, o);

  const pautasByContact = new Map<string, Pauta[]>();
  for (const p of data.pautas) pushTo(pautasByContact, p.contactId, p);

  const apptsByContact = new Map<string, Appointment[]>();
  for (const a of data.appointments) pushTo(apptsByContact, a.contactId, a);

  const msgsByContact = new Map<string, Message[]>();
  for (const m of data.messages) pushTo(msgsByContact, m.contactId, m);

  return { contactById, oppsByContact, pautasByContact, apptsByContact, msgsByContact };
}

// Cache keyed on the contacts array reference (stable within a single agent run),
// so the index is built once per dataset rather than on every tool call. The
// WeakMap entry is garbage-collected with the dataset.
const cache = new WeakMap<Contact[], ChatIndex>();

export function getChatIndex(data: ChatDataset): ChatIndex {
  const existing = cache.get(data.contacts);
  if (existing) return existing;
  const built = buildChatIndex(data);
  cache.set(data.contacts, built);
  return built;
}
