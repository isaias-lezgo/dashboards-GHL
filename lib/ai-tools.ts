// Tool definitions shared between the /api/chat system prompt and the
// in-browser executor. Tools run client-side against the already-loaded
// dashboard data — no extra GHL calls, no server-side session state.

import type {
  Contact,
  Opportunity,
  Pauta,
  Appointment,
  Message,
  Task,
  Call,
} from "@/lib/types";
import { getChatIndex, type ChatIndex } from "@/lib/ai-index";

export interface ChatDataset {
  contacts: Contact[];
  opportunities: Opportunity[];
  pautas: Pauta[];
  appointments: Appointment[];
  messages: Message[];
  tasks: Task[];
  calls: Call[];
}

// ─── Tool schemas (sent to Claude) ────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "list_fields",
    description:
      "Lists the available entities (contacts, opportunities, pautas, appointments, messages) and their queryable fields. Always call this first if you're unsure what fields exist on pautas (custom-object properties vary per location).",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["contacts", "opportunities", "pautas", "appointments", "messages", "all"],
          description: "Entity to inspect. Use 'all' to get an overview.",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "list_values",
    description:
      "Returns the distinct values of a field (with counts) for an entity. USE THIS BEFORE filtering by source/campaign/adType/assignedTo/stage/tipo when you're not 100% sure of the exact value — values can differ in casing or wording between contacts and opportunities. Cheap (just a group-by).",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["contacts", "opportunities", "pautas", "appointments"],
        },
        field: {
          type: "string",
          description:
            "Field name to enumerate. Common: source, campaign, adType, assignedTo, stage, pipelineName, status, tipo, tags.",
        },
        limit: { type: "number", description: "Max distinct values to return (default 40)." },
      },
      required: ["entity", "field"],
    },
  },
  {
    name: "search_contacts",
    description:
      "Search contacts by name/email/phone substring, tags, source, campaign, adType, assigned advisor, company, or location. Also accepts a contactIds array to resolve a specific set of IDs to names. Filter values are matched case-insensitively. Returns compact rows. Use get_contact for full details.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on name, email, or phone (case-insensitive)." },
        contactIds: { type: "array", items: { type: "string" }, description: "Only return contacts whose id is in this list. Use this to resolve a set of contactIds (from appointments, pautas, etc.) into human-readable names — NEVER print raw IDs; call this tool instead." },
        tags: { type: "array", items: { type: "string" }, description: "Filter to contacts having ALL of these tags (case-insensitive)." },
        source: { type: "string", description: "Source match, case-insensitive (e.g. 'meta', 'Paid Social')." },
        campaign: { type: "string", description: "Campaign substring match, case-insensitive." },
        adType: { type: "string", description: "AdType match, case-insensitive." },
        assignedTo: { type: "string", description: "Advisor name, case-insensitive exact." },
        companyName: { type: "string", description: "Company name substring match, case-insensitive." },
        city: { type: "string", description: "City substring match, case-insensitive." },
        state: { type: "string", description: "State substring match, case-insensitive." },
        country: { type: "string", description: "Country substring match, case-insensitive." },
        dnd: { type: "boolean", description: "Filter by Do Not Disturb status (true = DND on, false = DND off)." },
        createdAfter: { type: "string", description: "ISO date — only contacts created on/after this date." },
        createdBefore: { type: "string", description: "ISO date — only contacts created on/before this date." },
        limit: { type: "number", description: "Max rows to return (default 25, max 100)." },
      },
    },
  },
  {
    name: "get_contact",
    description: "Full record for one contact (all fields).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_contact_related",
    description:
      "Fetches related records for one contact from the pre-loaded dashboard data: opportunities, pautas, appointments, messages. NOTE: the `messages` field here is drawn from a recent sample (top conversations per advisor) and may be empty or incomplete for a specific contact. For the actual conversation of a specific contact, ALWAYS prefer `get_contact_messages` which queries GHL live.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Contact id." },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["opportunities", "pautas", "appointments", "messages"] },
          description: "Which kinds to include. Defaults to all.",
        },
        messageLimit: { type: "number", description: "Max messages to return from the in-memory sample (default 20, newest first). For the real conversation, use get_contact_messages." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_contact_messages",
    description:
      "Fetches the live conversation messages for ONE contact directly from GoHighLevel (bypasses the in-memory sample). Use this whenever the user asks what was said, what messages exist, or to summarize a conversation for a specific contact — even if `get_contact_related` returned 0 messages. Returns up to ~100 messages, newest first.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Contact id to fetch the conversation for." },
        limit: { type: "number", description: "Max messages to return (default 50, max 100)." },
      },
      required: ["contactId"],
    },
  },
  {
    name: "search_opportunities",
    description:
      "Search/filter opportunities. Filter values for source/campaign/adType/assignedTo/stage/pipeline/priority are matched case-insensitively. Returns compact rows. Use get_opportunity for full details.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on opportunity name." },
        contactIds: { type: "array", items: { type: "string" }, description: "Only return opps whose contactId is in this list. Use this to cross-join from appointments/pautas/messages → opportunities via contactId." },
        pipeline: { type: "string", description: "Exact pipeline name." },
        stage: { type: "string", description: "Exact stage name." },
        status: { type: "string", enum: ["open", "won", "lost", "abandoned"] },
        source: { type: "string" },
        assignedTo: { type: "string" },
        priority: { type: "string", description: "Priority filter, case-insensitive (e.g. 'high', 'medium', 'low')." },
        archived: { type: "boolean", description: "Filter by archived status. Omit to include all." },
        minValue: { type: "number" },
        maxValue: { type: "number" },
        minProbability: { type: "number", description: "Minimum probability (0–100)." },
        maxProbability: { type: "number", description: "Maximum probability (0–100)." },
        createdAfter: { type: "string", description: "ISO date — only opps created on/after this date." },
        createdBefore: { type: "string", description: "ISO date — only opps created on/before this date." },
        closedAfter: { type: "string", description: "ISO date — only opps closed on/after this date." },
        closedBefore: { type: "string", description: "ISO date — only opps closed on/before this date." },
        limit: { type: "number", description: "Max rows to return (default 25, max 100)." },
      },
    },
  },
  {
    name: "get_opportunity",
    description: "Full record for one opportunity.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "search_pautas",
    description: "Search pautas (custom objects). Returns compact rows. Use get_pauta for full custom properties.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on nombrePauta or tipo." },
        tipo: { type: "string", description: "Exact tipo match." },
        contactId: { type: "string", description: "Only pautas linked to this contact." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_pauta",
    description: "Full record for one pauta including all custom properties.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_appointments",
    description: "List appointments (last 90 days). Returns compact rows.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Exact status match (e.g. 'confirmed', 'showed', 'no_show')." },
        assignedTo: { type: "string" },
        contactId: { type: "string" },
        startAfter: { type: "string", description: "ISO date — appointments starting on/after." },
        startBefore: { type: "string", description: "ISO date — appointments starting on/before." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "aggregate",
    description:
      "Deterministic counts/sums/averages. USE THIS for any numeric question — do not eyeball counts from search results. Filter values for source/campaign/adType/assignedTo/stage/pipeline/tipo/status are matched case-insensitively. Returns { groups: [{ key, count, sum?, avg? }], total }.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["contacts", "opportunities", "pautas", "appointments"],
        },
        groupBy: {
          type: "string",
          description:
            "Field to group by. Common: 'source', 'campaign', 'adType', 'assignedTo', 'status', 'stage', 'pipelineName', 'priority', 'archived', 'companyName', 'city', 'state', 'country', 'tipo', 'tags' (tags fans out per tag). Use 'none' for a single total.",
        },
        metric: {
          type: "string",
          enum: ["count", "sum", "avg"],
          description: "'sum' and 'avg' apply to opportunity.value only.",
        },
        filters: {
          type: "object",
          description:
            "Optional filters: same keys as search_* tools. Contacts: source, campaign, adType, assignedTo, tags, companyName, city, state, country, dnd, createdAfter, createdBefore, contactIds (array). Opportunities: status, source, assignedTo, stage, pipeline, priority, archived, minValue, maxValue, minProbability, maxProbability, createdAfter, createdBefore, closedAfter, closedBefore, contactIds (array — use to cross-join from appointments/pautas). Pautas: tipo, contactId. Appointments: status, assignedTo, startAfter, startBefore.",
          additionalProperties: true,
        },
        limit: { type: "number", description: "Max groups to return (default 50)." },
      },
      required: ["entity", "groupBy", "metric"],
    },
  },
  {
    name: "export_csv",
    description:
      "Exports a filtered dataset to a CSV file that the user can download. Call this when the user asks to export, download, or save data to a file. Always run a search_* or aggregate call first to confirm what data exists, then call export_csv with the same entity and filters. NEVER pass rows directly — only pass entity + filters.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["contacts", "opportunities", "appointments", "pautas"],
          description: "The entity to export.",
        },
        filters: {
          type: "object",
          description:
            "Optional filters — same keys as the corresponding search_* tool. Contacts: source, campaign, adType, assignedTo, tags, companyName, city, state, country, dnd, createdAfter, createdBefore, contactIds. Opportunities: status, source, assignedTo, stage, pipeline, priority, archived, minValue, maxValue, minProbability, maxProbability, createdAfter, createdBefore, closedAfter, closedBefore, contactIds. Pautas: tipo, contactId. Appointments: status, assignedTo, startAfter, startBefore.",
          additionalProperties: true,
        },
        columns: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of column names to include. Defaults to all standard columns for the entity.",
        },
        filename: {
          type: "string",
          description:
            "Suggested base filename without extension (e.g. 'contactos-meta-mayo'). Defaults to '{entity}-{YYYY-MM-DD}'.",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "search_conversations",
    description:
      "Fetches full conversation message threads for a list of contacts from GoHighLevel. Always derive contactIds first using list_appointments, search_contacts, search_opportunities, or other tools — never ask the user for IDs. May take several seconds for large batches. Returns full message history per contact (newest first), content truncated to 500 chars. For a single contact's conversation, use get_contact_messages instead.",
    input_schema: {
      type: "object",
      properties: {
        contactIds: {
          type: "array",
          items: { type: "string" },
          description:
            "List of contact IDs to fetch conversation threads for. Derive these from other tool calls such as list_appointments, search_contacts, or search_opportunities.",
        },
        limit: {
          type: "number",
          description: "Max number of contacts to process (default 20, max 50).",
        },
        messageLimit: {
          type: "number",
          description: "Max messages to return per thread (default 100).",
        },
      },
      required: ["contactIds"],
    },
  },
  {
    name: "get_contact_tasks",
    description:
      "Fetches all tasks for a contact directly from GoHighLevel. Returns task title, due date, status (completed/pending), and assigned user. Use when the user asks about pending work, follow-ups, overdue items, or to-dos for a specific contact. Always resolve the contactId first with search_contacts if you only have a name.",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "Contact ID to fetch tasks for.",
        },
      },
      required: ["contactId"],
    },
  },
  {
    name: "get_contact_notes",
    description:
      "Fetches all advisor-written notes for a contact from GoHighLevel. Notes are internal observations — NOT chat messages. Use when the user asks what was noted, observed, or documented about a contact, or to cross-reference notes against the conversation.",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "Contact ID to fetch notes for.",
        },
      },
      required: ["contactId"],
    },
  },
  {
    name: "relate",
    description:
      "Cross-entity join through the shared contact — THE one tool for any question that links appointments, pautas, opportunities, or contacts to each other (e.g. '¿cuánto valen las citas de mayo?', '¿qué ventas ganadas vinieron de la pauta X?'). It filters the `from` set, hops to the SAME contacts' `to` records, applies `to` filters, and aggregates — all in ONE call. NEVER hand-roll this by extracting contactIds and calling aggregate/search yourself; that is slow and expensive. Returns { groups, total, matchedContacts, contactIds? }. matchedContacts = distinct contacts that have BOTH a `from` and a `to` record.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "object",
          description: "Anchor set. { entity, filters? }.",
          properties: {
            entity: {
              type: "string",
              enum: ["contacts", "opportunities", "pautas", "appointments"],
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description:
                "Same filter keys as search_<entity>/aggregate. Appointments: status, assignedTo, startAfter, startBefore. Pautas: tipo, contactId. Opportunities: status, source, assignedTo, stage, pipeline, priority, archived, minValue, maxValue, minProbability, maxProbability, createdAfter, createdBefore, closedAfter, closedBefore. Contacts: source, campaign, adType, assignedTo, tags, companyName, city, state, country, dnd, createdAfter, createdBefore.",
            },
          },
          required: ["entity"],
        },
        to: {
          type: "object",
          description: "Related set, reached via the shared contact. { entity, filters? }.",
          properties: {
            entity: {
              type: "string",
              enum: ["contacts", "opportunities", "pautas", "appointments"],
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Same filter keys as search_<entity>/aggregate (see from.filters).",
            },
          },
          required: ["entity"],
        },
        metric: {
          type: "string",
          enum: ["count", "sum", "avg"],
          description: "Aggregation over the `to` set. 'sum'/'avg' apply to opportunity.value only. Use 'count' otherwise.",
        },
        groupBy: {
          type: "string",
          description:
            "Optional field on the `to` entity to group by (e.g. 'status', 'stage', 'source', 'assignedTo'). Omit (or 'none') for a single total.",
        },
        includeContactIds: {
          type: "boolean",
          description:
            "When true, also returns the matched contactIds (capped at `limit`) so you can chain show_in_panel or a live per-contact fetch (get_contact_tasks/get_contact_notes/get_contact_messages). Default false — leave off for pure numeric questions to keep the response small.",
        },
        limit: {
          type: "number",
          description: "Max groups and max contactIds returned (default 50).",
        },
      },
      required: ["from", "to", "metric"],
    },
  },
  {
    name: "show_in_panel",
    description:
      "Displays a curated set of contacts in the left context panel so the user can see and click them. CRITICAL: call this as your FINAL step whenever your answer is about a specific set of contacts (e.g. 'leads con actividad hoy', 'contactos sin responder', 'clientes de Meta'). Pass ONLY the contactIds you are actually reporting in your answer — NOT every contact you inspected while researching. The panel must match your conclusion: if you tell the user about 4 leads, pass those 4 ids, not the 20 you scanned. The panel resolves names, opportunity value, and lets the user open each contact. This tool does not return data — it only updates the UI.",
    input_schema: {
      type: "object",
      properties: {
        contactIds: {
          type: "array",
          items: { type: "string" },
          description:
            "The exact contact IDs your answer is about. These are shown, in this order, in the panel.",
        },
        title: {
          type: "string",
          description:
            "Short heading describing the set, in Spanish (e.g. 'Leads con actividad hoy', 'Sin responder +24h · Meta'). Shown at the top of the panel.",
        },
      },
      required: ["contactIds"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

// ─── Executor ─────────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;
type ToolOutput = unknown;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function clampLimit(n: unknown, def = DEFAULT_LIMIT): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : def;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(v)));
}

// Parse an ISO date filter bound to a millisecond timestamp. A date-only string
// ("2026-05-31") is interpreted in local time; upper ("before") bounds are pushed
// to the end of that day so a date-only `*Before` includes records from anywhere
// on that day instead of cutting off at local midnight. Strings carrying a time
// component are parsed as-is.
function dateBound(s: string, end: boolean): number {
  const trimmed = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) {
    const [, y, mo, d] = m;
    return end
      ? new Date(+y, +mo - 1, +d, 23, 59, 59, 999).getTime()
      : new Date(+y, +mo - 1, +d, 0, 0, 0, 0).getTime();
  }
  return new Date(trimmed).getTime();
}

const startBound = (s: string): number => dateBound(s, false);
const endBound = (s: string): number => dateBound(s, true);

function lc(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function includesAll<T>(haystack: T[], needles: T[]): boolean {
  return needles.every((n) => haystack.includes(n));
}

function ieq(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function isub(haystack: unknown, needle: unknown): boolean {
  if (haystack === undefined || haystack === null || needle === undefined || needle === null) return false;
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
}

function includesAllCI(haystack: string[], needles: string[]): boolean {
  const lower = haystack.map((h) => h.toLowerCase());
  return needles.every((n) => lower.includes(n.toLowerCase()));
}

function compactContact(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    email: c.email || undefined,
    phone: c.phone || undefined,
    companyName: c.companyName || undefined,
    city: c.city || undefined,
    state: c.state || undefined,
    country: c.country || undefined,
    tags: c.tags?.length ? c.tags : undefined,
    source: c.source,
    campaign: c.campaign || undefined,
    adType: c.adType || undefined,
    assignedTo: c.assignedTo,
    dnd: c.dnd || undefined,
    lastActivity: c.lastActivity || undefined,
    createdAt: c.createdAt,
  };
}

function compactOpp(o: Opportunity) {
  return {
    id: o.id,
    name: o.name,
    contactId: o.contactId,
    pipeline: o.pipelineName,
    stage: o.stage,
    status: o.status,
    value: o.value,
    currency: o.currency || undefined,
    probability: o.probability ?? undefined,
    priority: o.priority || undefined,
    closedAt: o.closedAt || undefined,
    archived: o.archived || undefined,
    source: o.source || undefined,
    campaign: o.campaign || undefined,
    adType: o.adType || undefined,
    assignedTo: o.assignedTo,
    lostReason: o.lostReason || undefined,
    notes: o.notes ? (o.notes.length > 200 ? o.notes.slice(0, 200) + "…" : o.notes) : undefined,
    lastActivity: o.lastActivity || undefined,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt || undefined,
  };
}

function oppRollup(
  contactId: string | undefined,
  index: ChatIndex
): { oppCount: number; oppValueSum: number } {
  if (!contactId) return { oppCount: 0, oppValueSum: 0 };
  const opps = index.oppsByContact.get(contactId) ?? [];
  let sum = 0;
  for (const o of opps) sum += typeof o.value === "number" ? o.value : 0;
  return { oppCount: opps.length, oppValueSum: sum };
}

function compactPauta(p: Pauta, index: ChatIndex) {
  return {
    id: p.id,
    tipo: p.tipo,
    nombre: p.nombrePauta,
    contactId: p.contactId,
    createdAt: p.createdAt,
    ...oppRollup(p.contactId, index),
  };
}

function compactAppt(a: Appointment, index: ChatIndex) {
  return {
    id: a.id,
    contactId: a.contactId,
    assignedTo: a.assignedTo,
    title: a.title,
    startTime: a.startTime,
    status: a.status,
    location: a.location,
    ...oppRollup(a.contactId, index),
  };
}

function compactMessage(m: Message) {
  return {
    id: m.id,
    contactId: m.contactId,
    direction: m.direction,
    source: m.source,
    content: m.content ? (m.content.length > 280 ? m.content.slice(0, 280) + "…" : m.content) : undefined,
    createdAt: m.createdAt,
  };
}

export function executeTool(
  name: string,
  input: ToolInput,
  data: ChatDataset
): ToolOutput {
  switch (name) {
    case "list_fields":
      return listFields(input, data);
    case "list_values":
      return listValues(input, data);
    case "search_contacts":
      return searchContacts(input, data);
    case "get_contact":
      return getContact(input, data);
    case "get_contact_related":
      return getContactRelated(input, data, getChatIndex(data));
    case "search_opportunities":
      return searchOpportunities(input, data);
    case "get_opportunity":
      return getOpportunity(input, data);
    case "search_pautas":
      return searchPautas(input, data, getChatIndex(data));
    case "get_pauta":
      return getPauta(input, data);
    case "list_appointments":
      return listAppointments(input, data, getChatIndex(data));
    case "aggregate":
      return aggregate(input, data);
    case "relate":
      return relate(input, data, getChatIndex(data));
    case "show_in_panel": {
      // UI-only directive. The real panel update happens client-side in the
      // chat component's onToolExecuted handler (it reads contactIds from the
      // tool input). Here we just acknowledge so the model knows it succeeded.
      const ids = Array.isArray(input.contactIds) ? (input.contactIds as string[]) : [];
      return { ok: true, shown: ids.length };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export interface ExportCsvResult {
  csvContent: string;
  filename: string;
  rowCount: number;
}

const CSV_COLUMNS: Record<string, string[]> = {
  contacts: [
    "name", "email", "phone", "companyName", "city", "state", "country",
    "source", "campaign", "adType", "assignedTo", "tags", "dnd", "createdAt",
  ],
  opportunities: [
    "name", "contactId", "pipeline", "stage", "status", "value", "currency",
    "probability", "priority", "source", "campaign", "adType", "assignedTo",
    "closedAt", "lostReason", "createdAt",
  ],
  appointments: ["contactId", "assignedTo", "title", "status", "location", "startTime"],
  pautas: ["id", "tipo", "nombrePauta", "contactId", "createdAt"],
};

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str: string;
  if (Array.isArray(val)) str = (val as unknown[]).join("|");
  else if (typeof val === "object") str = JSON.stringify(val);
  else str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  }
  return lines.join("\r\n");
}

export function executeExportCsv(input: ToolInput, data: ChatDataset): ExportCsvResult {
  const entity = String(input.entity ?? "");
  const filters = (
    input.filters && typeof input.filters === "object" ? input.filters : {}
  ) as ToolInput;
  const userColumns = Array.isArray(input.columns) ? (input.columns as string[]) : null;
  const today = new Date().toISOString().slice(0, 10);
  const baseFilename =
    typeof input.filename === "string" && input.filename.trim()
      ? input.filename.trim().replace(/\.csv$/i, "")
      : `${entity}-${today}`;
  const filename = `${baseFilename}.csv`;

  let headers: string[];
  let rows: Array<Record<string, unknown>>;

  switch (entity) {
    case "contacts": {
      const filtered = applyContactFilters(data.contacts, filters);
      headers = userColumns ?? CSV_COLUMNS.contacts;
      rows = filtered.map((c) => ({
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ?? "",
        companyName: c.companyName ?? "",
        city: c.city ?? "",
        state: c.state ?? "",
        country: c.country ?? "",
        source: c.source ?? "",
        campaign: c.campaign ?? "",
        adType: c.adType ?? "",
        assignedTo: c.assignedTo ?? "",
        tags: (c.tags ?? []).join("|"),
        dnd: c.dnd ? "true" : "false",
        createdAt: c.createdAt,
      }));
      break;
    }
    case "opportunities": {
      const filtered = applyOppFilters(data.opportunities, filters);
      headers = userColumns ?? CSV_COLUMNS.opportunities;
      rows = filtered.map((o) => ({
        name: o.name,
        contactId: o.contactId,
        pipeline: o.pipelineName ?? "",
        stage: o.stage ?? "",
        status: o.status,
        value: o.value,
        currency: o.currency ?? "",
        probability: o.probability ?? "",
        priority: o.priority ?? "",
        source: o.source ?? "",
        campaign: o.campaign ?? "",
        adType: o.adType ?? "",
        assignedTo: o.assignedTo ?? "",
        closedAt: o.closedAt ?? "",
        lostReason: o.lostReason ?? "",
        createdAt: o.createdAt,
      }));
      break;
    }
    case "appointments": {
      const filtered = applyApptFilters(data.appointments, filters);
      headers = userColumns ?? CSV_COLUMNS.appointments;
      rows = filtered.map((a) => ({
        contactId: a.contactId,
        assignedTo: a.assignedTo ?? "",
        title: a.title ?? "",
        status: a.status,
        location: a.location ?? "",
        startTime: a.startTime,
      }));
      break;
    }
    case "pautas": {
      const filtered = applyPautaFilters(data.pautas, filters);
      const propKeys = new Set<string>();
      for (const p of filtered) {
        if (p.properties) for (const k of Object.keys(p.properties)) propKeys.add(k);
      }
      const propCols = Array.from(propKeys).sort();
      headers = userColumns ?? [...CSV_COLUMNS.pautas, ...propCols];
      rows = filtered.map((p) => {
        const base: Record<string, unknown> = {
          id: p.id,
          tipo: p.tipo ?? "",
          nombrePauta: p.nombrePauta ?? "",
          contactId: p.contactId ?? "",
          createdAt: p.createdAt,
        };
        for (const k of propCols) {
          base[k] = p.properties?.[k] ?? "";
        }
        return base;
      });
      break;
    }
    default:
      return { csvContent: "", filename, rowCount: 0 };
  }

  return { csvContent: buildCsv(headers, rows), filename, rowCount: rows.length };
}

// ─── list_fields ──────────────────────────────────────────────────────────────

function listFields(input: ToolInput, data: ChatDataset) {
  const entity = String(input.entity ?? "all");

  // Collect pauta custom-field keys from observed properties
  const pautaPropKeys = new Set<string>();
  for (const p of data.pautas) {
    if (p.properties) {
      for (const k of Object.keys(p.properties)) pautaPropKeys.add(k);
    }
  }

  const all = {
    contacts: {
      fields: [
        "id", "name", "firstName", "lastName", "email", "phone", "companyName",
        "city", "state", "country", "address1", "postalCode", "timezone", "website",
        "tags", "source", "campaign", "adType", "assignedTo",
        "dateOfBirth", "lastActivity", "dateAdded", "createdAt", "dateUpdated",
        "dnd", "type", "customFields", "customFieldsResolved", "attributionSource", "attributions",
      ],
      note: "customFieldsResolved is a key→value object with human-readable field names (e.g. {\"Servicio Técnico\": \"Estándar\"}). Use get_contact to see the actual keys for a record.",
      count: data.contacts.length,
    },
    opportunities: {
      fields: [
        "id", "name", "contactId", "pipelineId", "pipelineName", "stage", "status",
        "value", "monetaryValue", "currency", "probability",
        "source", "campaign", "adType", "assignedTo", "tags", "priority",
        "closedAt", "createdAt", "updatedAt", "lastActivity",
        "lostReason", "lostReasonId", "notes", "archived", "origin",
        "campaignId", "funnelId", "workflowId", "customFields", "customFieldsResolved", "attributions",
      ],
      note: "customFieldsResolved is a key→value object with human-readable field names (e.g. {\"Usuarios Contratados\": \"10\", \"Servicio Técnico\": \"Estándar\"}). Use get_opportunity to see the actual keys for a record.",
      count: data.opportunities.length,
    },
    pautas: {
      fields: ["id", "tipo", "nombrePauta", "contactId", "createdAt"],
      customProperties: Array.from(pautaPropKeys).sort(),
      count: data.pautas.length,
    },
    appointments: {
      fields: ["id", "contactId", "assignedTo", "title", "startTime", "endTime", "status", "notes"],
      count: data.appointments.length,
      note: "Last 90 days only.",
    },
    messages: {
      fields: ["id", "contactId", "conversationId", "assignedTo", "direction", "source", "content", "createdAt"],
      count: data.messages.length,
      note: "Sample of recent conversations per advisor, not exhaustive.",
    },
  };

  if (entity === "all") return all;
  return (all as Record<string, unknown>)[entity] ?? { error: `Unknown entity: ${entity}` };
}

// ─── list_values ──────────────────────────────────────────────────────────────

function listValues(input: ToolInput, data: ChatDataset) {
  const entity = String(input.entity ?? "");
  const field = String(input.field ?? "");
  const limit = clampLimit(input.limit, 40);

  let rows: Array<Record<string, unknown>>;
  switch (entity) {
    case "contacts":
      rows = data.contacts as unknown as Array<Record<string, unknown>>;
      break;
    case "opportunities":
      rows = data.opportunities as unknown as Array<Record<string, unknown>>;
      break;
    case "pautas":
      rows = data.pautas as unknown as Array<Record<string, unknown>>;
      break;
    case "appointments":
      rows = data.appointments as unknown as Array<Record<string, unknown>>;
      break;
    default:
      return { error: `Unknown entity: ${entity}` };
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[field];
    if (Array.isArray(v)) {
      if (v.length === 0) counts.set("(sin valor)", (counts.get("(sin valor)") ?? 0) + 1);
      for (const item of v) {
        const k = item === null || item === undefined || item === "" ? "(sin valor)" : String(item);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    } else {
      const k = v === null || v === undefined || v === "" ? "(sin valor)" : String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const values = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return {
    field,
    entity,
    distinct: values.length,
    values: values.slice(0, limit),
    truncated: values.length > limit,
  };
}

// ─── search_contacts ──────────────────────────────────────────────────────────

function searchContacts(input: ToolInput, data: ChatDataset) {
  const q = lc(input.query);
  const contactIds = Array.isArray(input.contactIds) ? new Set(input.contactIds as string[]) : undefined;
  const tags = Array.isArray(input.tags) ? (input.tags as string[]) : undefined;
  const source = typeof input.source === "string" ? input.source : undefined;
  const campaign = typeof input.campaign === "string" ? input.campaign : undefined;
  const adType = typeof input.adType === "string" ? input.adType : undefined;
  const assignedTo = typeof input.assignedTo === "string" ? input.assignedTo : undefined;
  const companyName = typeof input.companyName === "string" ? input.companyName : undefined;
  const city = typeof input.city === "string" ? input.city : undefined;
  const state = typeof input.state === "string" ? input.state : undefined;
  const country = typeof input.country === "string" ? input.country : undefined;
  const dnd = typeof input.dnd === "boolean" ? input.dnd : undefined;
  const after = typeof input.createdAfter === "string" ? startBound(input.createdAfter) : undefined;
  const before = typeof input.createdBefore === "string" ? endBound(input.createdBefore) : undefined;
  const limit = clampLimit(input.limit);

  const out: Contact[] = [];
  for (const c of data.contacts) {
    if (contactIds && !contactIds.has(c.id)) continue;
    if (q) {
      const hay = `${lc(c.name)} ${lc(c.email)} ${lc(c.phone)}`;
      if (!hay.includes(q)) continue;
    }
    if (tags?.length && !includesAllCI(c.tags ?? [], tags)) continue;
    if (source && !ieq(c.source, source)) continue;
    if (campaign && !isub(c.campaign, campaign)) continue;
    if (adType && !ieq(c.adType, adType)) continue;
    if (assignedTo && !ieq(c.assignedTo, assignedTo)) continue;
    if (companyName && !isub(c.companyName, companyName)) continue;
    if (city && !isub(c.city, city)) continue;
    if (state && !isub(c.state, state)) continue;
    if (country && !isub(c.country, country)) continue;
    if (dnd !== undefined && Boolean(c.dnd) !== dnd) continue;
    if (after !== undefined && +new Date(c.createdAt) < after) continue;
    if (before !== undefined && +new Date(c.createdAt) > before) continue;
    out.push(c);
    if (out.length > limit) break;
  }
  const truncated = out.length > limit;
  const rows = truncated ? out.slice(0, limit) : out;
  return {
    rows: rows.map(compactContact),
    returned: rows.length,
    truncated,
  };
}

function getContact(input: ToolInput, data: ChatDataset) {
  const id = String(input.id ?? "");
  const c = data.contacts.find((x) => x.id === id);
  return c ?? { error: `Contact not found: ${id}` };
}

// ─── get_contact_related ──────────────────────────────────────────────────────

function getContactRelated(input: ToolInput, data: ChatDataset, index: ChatIndex) {
  const id = String(input.id ?? "");
  const c = data.contacts.find((x) => x.id === id);
  if (!c) return { error: `Contact not found: ${id}` };

  const kinds = Array.isArray(input.kinds) && input.kinds.length > 0
    ? (input.kinds as string[])
    : ["opportunities", "pautas", "appointments", "messages"];
  const messageLimit = clampLimit(input.messageLimit, 20);

  const result: Record<string, unknown> = { contact: c };

  if (kinds.includes("opportunities")) {
    result.opportunities = data.opportunities
      .filter((o) => o.contactId === id)
      .map(compactOpp);
  }
  if (kinds.includes("pautas")) {
    result.pautas = data.pautas
      .filter((p) => p.contactId === id)
      .map((p) => compactPauta(p, index));
  }
  if (kinds.includes("appointments")) {
    result.appointments = data.appointments
      .filter((a) => a.contactId === id)
      .map((a) => compactAppt(a, index));
  }
  if (kinds.includes("messages")) {
    const msgs = data.messages
      .filter((m) => m.contactId === id)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, messageLimit);
    result.messages = msgs.map(compactMessage);
  }

  return result;
}

// ─── opportunities ────────────────────────────────────────────────────────────

function searchOpportunities(input: ToolInput, data: ChatDataset) {
  const q = lc(input.query);
  const contactIds = Array.isArray(input.contactIds) ? new Set(input.contactIds as string[]) : undefined;
  const pipeline = typeof input.pipeline === "string" ? input.pipeline : undefined;
  const stage = typeof input.stage === "string" ? input.stage : undefined;
  const status = typeof input.status === "string" ? input.status : undefined;
  const source = typeof input.source === "string" ? input.source : undefined;
  const assignedTo = typeof input.assignedTo === "string" ? input.assignedTo : undefined;
  const priority = typeof input.priority === "string" ? input.priority : undefined;
  const archived = typeof input.archived === "boolean" ? input.archived : undefined;
  const minValue = typeof input.minValue === "number" ? input.minValue : undefined;
  const maxValue = typeof input.maxValue === "number" ? input.maxValue : undefined;
  const minProb = typeof input.minProbability === "number" ? input.minProbability : undefined;
  const maxProb = typeof input.maxProbability === "number" ? input.maxProbability : undefined;
  const after = typeof input.createdAfter === "string" ? startBound(input.createdAfter) : undefined;
  const before = typeof input.createdBefore === "string" ? endBound(input.createdBefore) : undefined;
  const closedAfter = typeof input.closedAfter === "string" ? startBound(input.closedAfter) : undefined;
  const closedBefore = typeof input.closedBefore === "string" ? endBound(input.closedBefore) : undefined;
  const limit = clampLimit(input.limit);

  const out: Opportunity[] = [];
  for (const o of data.opportunities) {
    if (q && !lc(o.name).includes(q)) continue;
    if (contactIds && !contactIds.has(o.contactId)) continue;
    if (pipeline && !ieq(o.pipelineName, pipeline)) continue;
    if (stage && !ieq(o.stage, stage)) continue;
    if (status && !ieq(o.status, status)) continue;
    if (source && !ieq(o.source, source)) continue;
    if (assignedTo && !ieq(o.assignedTo, assignedTo)) continue;
    if (priority && !ieq(o.priority, priority)) continue;
    if (archived !== undefined && Boolean(o.archived) !== archived) continue;
    if (minValue !== undefined && o.value < minValue) continue;
    if (maxValue !== undefined && o.value > maxValue) continue;
    if (minProb !== undefined && (o.probability ?? 0) < minProb) continue;
    if (maxProb !== undefined && (o.probability ?? 100) > maxProb) continue;
    if (after !== undefined || before !== undefined) {
      const t = +new Date(o.createdAt);
      if (after !== undefined && t < after) continue;
      if (before !== undefined && t > before) continue;
    }
    if (closedAfter !== undefined || closedBefore !== undefined) {
      const t = o.closedAt ? +new Date(o.closedAt) : undefined;
      if (t === undefined) continue;
      if (closedAfter !== undefined && t < closedAfter) continue;
      if (closedBefore !== undefined && t > closedBefore) continue;
    }
    out.push(o);
    if (out.length > limit) break;
  }
  const truncated = out.length > limit;
  const rows = truncated ? out.slice(0, limit) : out;
  return {
    rows: rows.map(compactOpp),
    returned: rows.length,
    truncated,
  };
}

function getOpportunity(input: ToolInput, data: ChatDataset) {
  const id = String(input.id ?? "");
  const o = data.opportunities.find((x) => x.id === id);
  return o ?? { error: `Opportunity not found: ${id}` };
}

// ─── pautas ───────────────────────────────────────────────────────────────────

function searchPautas(input: ToolInput, data: ChatDataset, index: ChatIndex) {
  const q = lc(input.query);
  const tipo = typeof input.tipo === "string" ? input.tipo : undefined;
  const contactId = typeof input.contactId === "string" ? input.contactId : undefined;
  const limit = clampLimit(input.limit);

  const out: Pauta[] = [];
  for (const p of data.pautas) {
    if (q) {
      const hay = `${lc(p.nombrePauta)} ${lc(p.tipo)}`;
      if (!hay.includes(q)) continue;
    }
    if (tipo && p.tipo !== tipo) continue;
    if (contactId && p.contactId !== contactId) continue;
    out.push(p);
    if (out.length > limit) break;
  }
  const truncated = out.length > limit;
  const rows = truncated ? out.slice(0, limit) : out;
  return {
    rows: rows.map((p) => compactPauta(p, index)),
    returned: rows.length,
    truncated,
  };
}

function getPauta(input: ToolInput, data: ChatDataset) {
  const id = String(input.id ?? "");
  const p = data.pautas.find((x) => x.id === id);
  return p ?? { error: `Pauta not found: ${id}` };
}

// ─── appointments ─────────────────────────────────────────────────────────────

function listAppointments(input: ToolInput, data: ChatDataset, index: ChatIndex) {
  const status = typeof input.status === "string" ? input.status : undefined;
  const assignedTo = typeof input.assignedTo === "string" ? input.assignedTo : undefined;
  const contactId = typeof input.contactId === "string" ? input.contactId : undefined;
  const after = typeof input.startAfter === "string" ? startBound(input.startAfter) : undefined;
  const before = typeof input.startBefore === "string" ? endBound(input.startBefore) : undefined;
  const limit = clampLimit(input.limit);

  const out: Appointment[] = [];
  for (const a of data.appointments) {
    if (status && a.status !== status) continue;
    if (assignedTo && a.assignedTo !== assignedTo) continue;
    if (contactId && a.contactId !== contactId) continue;
    if (after !== undefined || before !== undefined) {
      const t = +new Date(a.startTime);
      if (after !== undefined && t < after) continue;
      if (before !== undefined && t > before) continue;
    }
    out.push(a);
    if (out.length > limit) break;
  }
  const truncated = out.length > limit;
  const rows = truncated ? out.slice(0, limit) : out;
  return {
    rows: rows.map((a) => compactAppt(a, index)),
    returned: rows.length,
    truncated,
  };
}

// ─── aggregate ────────────────────────────────────────────────────────────────

// Resolve an entity + filters to filtered rows. Shared by `aggregate` and `relate`.
function filteredRows(
  entity: string,
  filters: ToolInput,
  data: ChatDataset
): Array<Record<string, unknown>> {
  switch (entity) {
    case "contacts":
      return applyContactFilters(data.contacts, filters) as unknown as Array<Record<string, unknown>>;
    case "opportunities":
      return applyOppFilters(data.opportunities, filters) as unknown as Array<Record<string, unknown>>;
    case "pautas":
      return applyPautaFilters(data.pautas, filters) as unknown as Array<Record<string, unknown>>;
    case "appointments":
      return applyApptFilters(data.appointments, filters) as unknown as Array<Record<string, unknown>>;
    default:
      return [];
  }
}

// Group + metric over already-filtered rows. Shared by `aggregate` and `relate`.
function aggregateRows(
  rows: Array<Record<string, unknown>>,
  groupBy: string,
  metric: string,
  entity: string,
  limit: number
) {
  if (groupBy === "none") {
    return {
      groups: [{ key: "total", count: rows.length, ...metricValue(rows, metric, entity) }],
      total: rows.length,
      truncated: false,
    };
  }

  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const raw = r[groupBy];
    if (groupBy === "tags" && Array.isArray(raw)) {
      // fan out per tag
      if (raw.length === 0) push(buckets, "(sin tag)", r);
      for (const t of raw) push(buckets, String(t), r);
    } else {
      const key = raw === undefined || raw === null || raw === "" ? "(sin valor)" : String(raw);
      push(buckets, key, r);
    }
  }

  const groups = Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      count: items.length,
      ...metricValue(items, metric, entity),
    }))
    .sort((a, b) => {
      const av = metric === "count" ? a.count : (a as { sum?: number; avg?: number }).sum ?? (a as { avg?: number }).avg ?? 0;
      const bv = metric === "count" ? b.count : (b as { sum?: number; avg?: number }).sum ?? (b as { avg?: number }).avg ?? 0;
      return bv - av;
    })
    .slice(0, limit);

  return { groups, total: rows.length, truncated: buckets.size > limit };
}

function aggregate(input: ToolInput, data: ChatDataset) {
  const entity = String(input.entity ?? "");
  const groupBy = String(input.groupBy ?? "none");
  const metric = String(input.metric ?? "count");
  const filters = (input.filters && typeof input.filters === "object" ? input.filters : {}) as ToolInput;
  const limit = clampLimit(input.limit, 50);

  if (!["contacts", "opportunities", "pautas", "appointments"].includes(entity)) {
    return { error: `Unknown entity: ${entity}` };
  }

  const rows = filteredRows(entity, filters, data);
  return aggregateRows(rows, groupBy, metric, entity, limit);
}

// ─── relate (cross-entity join through the shared contact) ──────────────────────

const RELATABLE = ["contacts", "opportunities", "pautas", "appointments"];

function contactIdOf(entity: string, row: Record<string, unknown>): string | undefined {
  if (entity === "contacts") return typeof row.id === "string" ? row.id : undefined;
  return typeof row.contactId === "string" ? row.contactId : undefined;
}

// Gather rows of `entity` whose contact is in `contactIds`, using the index.
function rowsForContacts(
  entity: string,
  contactIds: Set<string>,
  index: ChatIndex
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  switch (entity) {
    case "contacts":
      for (const id of contactIds) {
        const c = index.contactById.get(id);
        if (c) out.push(c as unknown as Record<string, unknown>);
      }
      break;
    case "opportunities":
      for (const id of contactIds) {
        const arr = index.oppsByContact.get(id);
        if (arr) for (const o of arr) out.push(o as unknown as Record<string, unknown>);
      }
      break;
    case "pautas":
      for (const id of contactIds) {
        const arr = index.pautasByContact.get(id);
        if (arr) for (const p of arr) out.push(p as unknown as Record<string, unknown>);
      }
      break;
    case "appointments":
      for (const id of contactIds) {
        const arr = index.apptsByContact.get(id);
        if (arr) for (const a of arr) out.push(a as unknown as Record<string, unknown>);
      }
      break;
  }
  return out;
}

function applyEntityFilters(
  entity: string,
  rows: Array<Record<string, unknown>>,
  filters: ToolInput
): Array<Record<string, unknown>> {
  switch (entity) {
    case "contacts":
      return applyContactFilters(rows as unknown as Contact[], filters) as unknown as Array<Record<string, unknown>>;
    case "opportunities":
      return applyOppFilters(rows as unknown as Opportunity[], filters) as unknown as Array<Record<string, unknown>>;
    case "pautas":
      return applyPautaFilters(rows as unknown as Pauta[], filters) as unknown as Array<Record<string, unknown>>;
    case "appointments":
      return applyApptFilters(rows as unknown as Appointment[], filters) as unknown as Array<Record<string, unknown>>;
    default:
      return rows;
  }
}

function relate(input: ToolInput, data: ChatDataset, index: ChatIndex) {
  const from = (input.from && typeof input.from === "object" ? input.from : {}) as ToolInput;
  const to = (input.to && typeof input.to === "object" ? input.to : {}) as ToolInput;
  const fromEntity = String(from.entity ?? "");
  const toEntity = String(to.entity ?? "");
  const metric = String(input.metric ?? "count");
  const groupBy = String(input.groupBy ?? "none");
  const includeContactIds = input.includeContactIds === true;
  const limit = clampLimit(input.limit, 50);

  if (!RELATABLE.includes(fromEntity)) return { error: `Unknown from.entity: ${fromEntity}` };
  if (!RELATABLE.includes(toEntity)) return { error: `Unknown to.entity: ${toEntity}` };

  const fromFilters = (from.filters && typeof from.filters === "object" ? from.filters : {}) as ToolInput;
  const toFilters = (to.filters && typeof to.filters === "object" ? to.filters : {}) as ToolInput;

  // 1. anchor set
  const fromRows = filteredRows(fromEntity, fromFilters, data);

  // 2. contacts of the anchor set
  const contactIds = new Set<string>();
  for (const r of fromRows) {
    const cid = contactIdOf(fromEntity, r);
    if (cid) contactIds.add(cid);
  }

  // 3. related rows via index, then 4. apply to-filters
  const related = rowsForContacts(toEntity, contactIds, index);
  const toRows = applyEntityFilters(toEntity, related, toFilters);

  // 5. aggregate
  const agg = aggregateRows(toRows, groupBy, metric, toEntity, limit);

  // distinct contacts present on BOTH sides (the join count)
  const matched = new Set<string>();
  for (const r of toRows) {
    const cid = contactIdOf(toEntity, r);
    if (cid) matched.add(cid);
  }

  const result: Record<string, unknown> = { ...agg, matchedContacts: matched.size };
  if (includeContactIds) result.contactIds = Array.from(matched).slice(0, limit);
  return result;
}

function push<T>(map: Map<string, T[]>, key: string, val: T) {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

function metricValue(
  rows: Array<Record<string, unknown>>,
  metric: string,
  entity: string
): Record<string, number> {
  if (metric === "count") return {};
  if (entity !== "opportunities") return {}; // sum/avg only meaningful on value
  const values = rows.map((r) => (typeof r.value === "number" ? r.value : 0));
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (metric === "sum") return { sum };
  if (metric === "avg") return { avg: values.length ? sum / values.length : 0 };
  return {};
}

// Shared filter helpers used by aggregate
function applyContactFilters(rows: Contact[], f: ToolInput): Contact[] {
  const contactIdSet = Array.isArray(f.contactIds) ? new Set(f.contactIds as string[]) : undefined;
  return rows.filter((c) => {
    if (contactIdSet && !contactIdSet.has(c.id)) return false;
    if (typeof f.source === "string" && !ieq(c.source, f.source)) return false;
    if (typeof f.campaign === "string" && !isub(c.campaign, f.campaign)) return false;
    if (typeof f.adType === "string" && !ieq(c.adType, f.adType)) return false;
    if (typeof f.assignedTo === "string" && !ieq(c.assignedTo, f.assignedTo)) return false;
    if (Array.isArray(f.tags) && !includesAllCI(c.tags ?? [], f.tags as string[])) return false;
    if (typeof f.companyName === "string" && !isub(c.companyName, f.companyName)) return false;
    if (typeof f.city === "string" && !isub(c.city, f.city)) return false;
    if (typeof f.state === "string" && !isub(c.state, f.state)) return false;
    if (typeof f.country === "string" && !isub(c.country, f.country)) return false;
    if (typeof f.dnd === "boolean" && Boolean(c.dnd) !== f.dnd) return false;
    if (typeof f.createdAfter === "string" && +new Date(c.createdAt) < startBound(f.createdAfter)) return false;
    if (typeof f.createdBefore === "string" && +new Date(c.createdAt) > endBound(f.createdBefore)) return false;
    return true;
  });
}

function applyOppFilters(rows: Opportunity[], f: ToolInput): Opportunity[] {
  const contactIdSet = Array.isArray(f.contactIds) ? new Set(f.contactIds as string[]) : undefined;
  return rows.filter((o) => {
    if (contactIdSet && !contactIdSet.has(o.contactId)) return false;
    if (typeof f.pipeline === "string" && !ieq(o.pipelineName, f.pipeline)) return false;
    if (typeof f.stage === "string" && !ieq(o.stage, f.stage)) return false;
    if (typeof f.status === "string" && !ieq(o.status, f.status)) return false;
    if (typeof f.source === "string" && !ieq(o.source, f.source)) return false;
    if (typeof f.campaign === "string" && !isub(o.campaign, f.campaign)) return false;
    if (typeof f.adType === "string" && !ieq(o.adType, f.adType)) return false;
    if (typeof f.assignedTo === "string" && !ieq(o.assignedTo, f.assignedTo)) return false;
    if (typeof f.priority === "string" && !ieq(o.priority, f.priority)) return false;
    if (typeof f.archived === "boolean" && Boolean(o.archived) !== f.archived) return false;
    if (typeof f.minValue === "number" && o.value < f.minValue) return false;
    if (typeof f.maxValue === "number" && o.value > f.maxValue) return false;
    if (typeof f.minProbability === "number" && (o.probability ?? 0) < f.minProbability) return false;
    if (typeof f.maxProbability === "number" && (o.probability ?? 100) > f.maxProbability) return false;
    if (typeof f.createdAfter === "string" && +new Date(o.createdAt) < startBound(f.createdAfter)) return false;
    if (typeof f.createdBefore === "string" && +new Date(o.createdAt) > endBound(f.createdBefore)) return false;
    if (typeof f.closedAfter === "string") {
      if (!o.closedAt || +new Date(o.closedAt) < startBound(f.closedAfter)) return false;
    }
    if (typeof f.closedBefore === "string") {
      if (!o.closedAt || +new Date(o.closedAt) > endBound(f.closedBefore)) return false;
    }
    return true;
  });
}

function applyPautaFilters(rows: Pauta[], f: ToolInput): Pauta[] {
  return rows.filter((p) => {
    if (typeof f.tipo === "string" && !ieq(p.tipo, f.tipo)) return false;
    if (typeof f.contactId === "string" && p.contactId !== f.contactId) return false;
    return true;
  });
}

function applyApptFilters(rows: Appointment[], f: ToolInput): Appointment[] {
  return rows.filter((a) => {
    if (typeof f.status === "string" && !ieq(a.status, f.status)) return false;
    if (typeof f.assignedTo === "string" && !ieq(a.assignedTo, f.assignedTo)) return false;
    if (typeof f.startAfter === "string" && +new Date(a.startTime) < startBound(f.startAfter)) return false;
    if (typeof f.startBefore === "string" && +new Date(a.startTime) > endBound(f.startBefore)) return false;
    return true;
  });
}
