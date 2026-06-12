import {
  getAllContacts,
  getAllOpportunities,
  getPipelines,
  getUsers,
  getCustomFields,
  getCustomObjects,
  getAllCustomObjectRecords,
  getCalendarEvents,
  getCalendars,
  getLocation,
  searchLocationTasks,
  type GHLContact,
  type GHLOpportunity,
  type GHLCalendarEvent,
  type GHLTask,
} from "@/lib/ghl-client";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Pipeline,
  Pauta,
  Appointment,
} from "@/lib/types";

type Attribution = {
  isFirst?: boolean;
  utmCampaign?: string;
  utmContent?: string;
  utmMedium?: string;
  utmSource?: string;
  utmSessionSource?: string;
  adSource?: string;
  medium?: string;
  utmAdId?: string;
  url?: string;
  [key: string]: unknown;
};

function firstAttr(attributions?: Attribution[]): Attribution | undefined {
  if (!attributions?.length) return undefined;
  return attributions.find((a) => a.isFirst) ?? attributions[0];
}

function buildCampaignLabel(content?: string, campaign?: string): string | undefined {
  const parts = [content, campaign].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function resolveCustomFields(
  fields: Array<{ id: string; value?: unknown; fieldValue?: unknown; fieldValueString?: unknown }> | undefined,
  map: Map<string, string>
): Record<string, string | string[]> {
  if (!fields?.length || !map.size) return {};
  const result: Record<string, string | string[]> = {};
  for (const f of fields) {
    const name = map.get(f.id);
    if (!name) continue;
    // contacts use value; opportunities use fieldValue/fieldValueString.
    // Multi-option/checkbox fields arrive as an array of strings.
    const raw = f.fieldValue ?? f.fieldValueString ?? f.value;
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      const arr = raw.map((v) => String(v)).filter((s) => s.trim() !== "");
      if (arr.length === 1) result[name] = arr[0];
      else if (arr.length > 1) result[name] = arr;
    } else {
      const s = String(raw);
      if (s.trim() !== "") result[name] = s;
    }
  }
  return result;
}

// Narrow a resolved custom field to a single string (for scalar fields like
// "Motivo de Perdido"). Multi-value fields collapse to their first entry.
function cfString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v || undefined;
}

// Spread all GHL fields through; add computed fields on top.
function transformContact(ghl: GHLContact, customFieldMap: Map<string, string>): Contact {
  const customFieldsResolved = resolveCustomFields(ghl.customFields, customFieldMap);
  return {
    ...ghl,
    name:
      ghl.name?.trim() ||
      `${ghl.firstNameRaw ?? ""} ${ghl.lastNameRaw ?? ""}`.trim() ||
      ghl.contactName?.trim() ||
      `${ghl.firstName ?? ""} ${ghl.lastName ?? ""}`.trim() ||
      "Unknown",
    email: ghl.email ?? "",
    phone: ghl.phone ?? "",
    tags: ghl.tags ?? [],
    createdAt: ghl.dateAdded,
    source: firstAttr(ghl.attributions)?.utmSource || firstAttr(ghl.attributions)?.adSource || ghl.source || "direct",
    campaign: buildCampaignLabel(
      firstAttr(ghl.attributions)?.utmContent,
      firstAttr(ghl.attributions)?.utmCampaign
    ),
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    adId: firstAttr(ghl.attributions)?.utmAdId || undefined,
    attributionUrl: firstAttr(ghl.attributions)?.url || ghl.attributionSource?.url || undefined,
    attributionMedium: firstAttr(ghl.attributions)?.medium || firstAttr(ghl.attributions)?.utmSessionSource || undefined,
    ...(Object.keys(customFieldsResolved).length > 0 ? { customFieldsResolved } : {}),
  };
}

function transformOpportunity(
  ghl: GHLOpportunity,
  pipelines: Map<string, { name: string; stages: Map<string, string> }>,
  customFieldMap: Map<string, string>
): Opportunity {
  const pipeline = pipelines.get(ghl.pipelineId);
  const stageName = pipeline?.stages.get(ghl.pipelineStageId) || "Unknown";
  const customFieldsResolved = resolveCustomFields(ghl.customFields, customFieldMap);

  return {
    ...ghl,
    contactId: ghl.contact?.id || ghl.contactId || "",
    value: ghl.monetaryValue ?? 0,
    stage: stageName,
    pipelineName: pipeline?.name || "Unknown",
    tags: ghl.tags ?? ghl.contact?.tags ?? [],
    source: firstAttr(ghl.attributions)?.utmSource || firstAttr(ghl.attributions)?.adSource || ghl.source,
    campaign: buildCampaignLabel(
      firstAttr(ghl.attributions)?.utmContent,
      firstAttr(ghl.attributions)?.utmCampaign
    ),
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    adId: firstAttr(ghl.attributions)?.utmAdId || undefined,
    attributionUrl: firstAttr(ghl.attributions)?.url || undefined,
    attributionMedium: firstAttr(ghl.attributions)?.medium || firstAttr(ghl.attributions)?.utmSessionSource || undefined,
    lostReason:
      ghl.status === "lost"
        ? cfString(customFieldsResolved["Motivo de Perdido"])
        : undefined,
    ...(Object.keys(customFieldsResolved).length > 0 ? { customFieldsResolved } : {}),
  };
}


function transformTask(ghl: GHLTask): Task {
  const assignedFirst = ghl.assignedToUserDetails?.firstName ?? "";
  const assignedLast = ghl.assignedToUserDetails?.lastName ?? "";
  const assignedToName = [assignedFirst, assignedLast].filter(Boolean).join(" ") || undefined;
  const contactFirst = ghl.contactDetails?.firstName ?? "";
  const contactLast = ghl.contactDetails?.lastName ?? "";
  const contactName = [contactFirst, contactLast].filter(Boolean).join(" ") || undefined;
  return {
    id: ghl._id,
    title: ghl.title,
    body: ghl.body,
    status: ghl.completed ? "completed" : "pending",
    dueDate: ghl.dueDate,
    contactId: ghl.contactId,
    contactName,
    assignedTo: ghl.assignedTo,
    assignedToName,
    createdAt: ghl.createdAt ?? ghl.dateAdded,
  };
}

function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function resolveContactIdFromRelations(
  relations: import("@/lib/ghl-client").GHLCustomObjectRelation[] | undefined
): string | undefined {
  if (!relations?.length) return undefined;
  const contactRelation = relations.find((r) => r.objectKey === "contact");
  return contactRelation?.recordId ?? undefined;
}

async function fetchAllPautas(): Promise<Pauta[]> {
  try {
    // List all custom objects to find the Pautas schema key
    const schemasResp = await getCustomObjects();
    const stub = schemasResp.objects.find(
      (s) =>
        s.labels.singular.toLowerCase().includes("pauta") ||
        s.labels.plural.toLowerCase().includes("pautas")
    );
    if (!stub) {
      console.warn("[GHL] Pautas custom object schema not found");
      return [];
    }

    const records = await getAllCustomObjectRecords(stub.key);

    const SKIP_PROPERTY_KEYS = new Set(["tipo", "nombre_pauta", "id"]);

    return records.map((r) => {
      const properties: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.properties)) {
        if (SKIP_PROPERTY_KEYS.has(k)) continue;
        if (v === null || v === undefined) continue;
        const str = Array.isArray(v) ? v.join(", ") : String(v);
        if (str.trim()) properties[k] = str.trim();
      }

      return {
        id: r.id,
        tipo: String(r.properties["tipo"] ?? "") || "Sin tipo",
        nombrePauta: String(r.properties["nombre_pauta"] ?? "") || "Sin nombre",
        createdAt: r.createdAt ?? new Date().toISOString(),
        contactId: resolveContactIdFromRelations(r.relations),
        properties,
      };
    });
  } catch (err) {
    console.error("[GHL] Pautas fetch failed:", err);
    return [];
  }
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(enc(obj)));
      };

      try {
        send({ type: "progress", message: "Iniciando sincronización…" });

        // Resolve the sub-account name first so the loading screen can show which
        // location is being opened. Cheap single call — don't block the rest on it.
        let locationName = "";
        const locationPromise = getLocation()
          .then((res) => {
            const name = res?.location?.name?.trim();
            if (name) {
              locationName = name;
              send({ type: "location", name });
            }
          })
          .catch(() => {
            /* non-fatal: loading screen just omits the sub-account name */
          });

        // Fetch pipelines, users, lost reasons, and custom field definitions first (fast, no pagination)
        const [pipelinesResult, usersResult, customFieldsResult] =
          await Promise.allSettled([
            getPipelines(),
            getUsers(),
            getCustomFields(),
          ]);

        send({ type: "progress", message: "Cargando pipelines y configuración…" });

        const pipelinesRaw = pipelinesResult.status === "fulfilled" ? pipelinesResult.value : { pipelines: [] };
        const usersRaw = usersResult.status === "fulfilled" ? usersResult.value : { users: [] };
        const customFieldsRaw = customFieldsResult.status === "fulfilled" ? customFieldsResult.value : { customFields: [] };

        // Build custom field id→name lookup
        const customFieldMap = new Map<string, string>();
        for (const cf of customFieldsRaw.customFields) {
          customFieldMap.set(cf.id, cf.name);
        }

        // Build pipeline lookup map
        const pipelineMap = new Map<string, { name: string; stages: Map<string, string> }>();
        const pipelineList: Pipeline[] = [];

        for (const p of pipelinesRaw.pipelines) {
          const stageMap = new Map<string, string>();
          for (const s of p.stages) {
            stageMap.set(s.id, s.name);
          }
          pipelineMap.set(p.id, { name: p.name, stages: stageMap });
          pipelineList.push({
            id: p.id,
            name: p.name,
            stages: p.stages.map((s) => s.name),
          });
        }

        // Build user lookup map
        const userMap = new Map<string, string>();
        const members: string[] = [];
        for (const u of usersRaw.users) {
          const name = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim();
          userMap.set(u.id, name);
          members.push(name);
        }

        // Fetch contacts with progress
        send({ type: "progress", message: "Cargando contactos…" });
        const contactsRaw = await getAllContacts((count) => {
          send({ type: "progress", message: `Cargando contactos… ${count.toLocaleString("es-MX")}` });
        }).catch((err: unknown) => {
          console.error("[GHL] Contacts fetch failed:", err);
          return [] as import("@/lib/ghl-client").GHLContact[];
        });

        // Fetch opportunities with progress
        send({ type: "progress", message: "Cargando oportunidades…" });
        const opportunitiesRaw = await getAllOpportunities((count) => {
          send({ type: "progress", message: `Cargando oportunidades… ${count.toLocaleString("es-MX")}` });
        }).catch((err: unknown) => {
          console.error("[GHL] Opportunities fetch failed:", err);
          return [] as import("@/lib/ghl-client").GHLOpportunity[];
        });

        // Fetch pautas after contacts+opps to avoid rate-limiting (29+ concurrent pages)
        send({ type: "progress", message: "Cargando pautas…" });
        const pautas = await fetchAllPautas();

        send({ type: "progress", message: "Procesando datos…" });

        // Transform contacts
        const contacts: Contact[] = contactsRaw.map((c) => {
          const contact = transformContact(c, customFieldMap);
          if (contact.assignedTo && userMap.has(contact.assignedTo)) {
            contact.assignedTo = userMap.get(contact.assignedTo);
          }
          return contact;
        });

        // Transform opportunities
        const opportunities: Opportunity[] = opportunitiesRaw.map((o) => {
          const opp = transformOpportunity(o, pipelineMap, customFieldMap);
          if (opp.assignedTo && userMap.has(opp.assignedTo)) {
            opp.assignedTo = userMap.get(opp.assignedTo);
          }
          return opp;
        });

        // Enrich opportunities with attribution from linked contact
        const contactById = new Map<string, Contact>();
        for (const c of contacts) {
          contactById.set(c.id, c);
        }

        // GHL guarantees every opportunity has a contact, and the
        // /opportunities/search response already embeds { id, name, email,
        // phone, tags }. The /contacts/ list endpoint, however, sometimes
        // omits records (archived, restricted, pagination quirks). For any
        // opp whose contact wasn't returned by /contacts/, synthesize a
        // Contact from the opportunity-embedded data so the UI always
        // resolves the lookup.
        let synthesizedCount = 0;
        for (const raw of opportunitiesRaw) {
          const embedded = raw.contact;
          if (!embedded?.id) continue;
          if (contactById.has(embedded.id)) continue;

          const attr = firstAttr(raw.attributions);
          const synth: Contact = {
            id: embedded.id,
            name:
              embedded.name?.trim() ||
              embedded.email ||
              embedded.phone ||
              "Sin nombre",
            email: embedded.email ?? "",
            phone: embedded.phone ?? "",
            tags: embedded.tags ?? [],
            dateAdded: raw.createdAt,
            createdAt: raw.createdAt,
            source: attr?.utmSource || attr?.adSource || raw.source || "direct",
            campaign: buildCampaignLabel(attr?.utmContent, attr?.utmCampaign),
            adType: attr?.utmMedium || attr?.utmSessionSource,
            adId: attr?.utmAdId || undefined,
            attributionUrl: attr?.url || undefined,
            attributionMedium: attr?.medium || attr?.utmSessionSource || undefined,
            assignedTo:
              raw.assignedTo && userMap.has(raw.assignedTo)
                ? userMap.get(raw.assignedTo)
                : raw.assignedTo,
          };
          contactById.set(embedded.id, synth);
          contacts.push(synth);
          synthesizedCount++;
        }
        if (synthesizedCount > 0) {
          console.warn(
            `[GHL] Synthesized ${synthesizedCount} contacts from opportunity-embedded data ` +
              `(missing from /contacts/ list of ${contactsRaw.length}).`
          );
        }

        for (const opp of opportunities) {
          const contact = contactById.get(opp.contactId);
          if (contact) {
            if (!opp.campaign) opp.campaign = contact.campaign;
            if (!opp.adType) opp.adType = contact.adType;
            if (!opp.source) opp.source = contact.source;
            if (!opp.adId) opp.adId = contact.adId;
            if (!opp.attributionUrl) opp.attributionUrl = contact.attributionUrl;
            if (!opp.attributionMedium) opp.attributionMedium = contact.attributionMedium;
          }
        }

        // Conversations/messages are fetched separately by /api/dashboard-messages
        // (background load) so the expensive per-user message fan-out stays off
        // the critical path of the initial dashboard render.

        // Fetch appointments per calendar over the last 90 days.
        // /calendars/events requires one of (calendarId, userId, groupId);
        // empirically GHL doesn't index it on assignedUserId, so userId-based
        // queries return empty. Fan out across calendars instead and use each
        // event's assignedUserId for asesor attribution. Per-calendar failures
        // are swallowed so one bad calendar doesn't blank the chart.
        send({ type: "progress", message: "Cargando citas…" });
        const appointments: Appointment[] = [];
        try {
          const calsResp = await getCalendars().catch((err: unknown) => {
            console.error("[GHL] Calendars list fetch failed:", err);
            return { calendars: [] };
          });
          const calendarIds = calsResp.calendars.map((c) => c.id);

          if (calendarIds.length > 0) {
            // /calendars/events expects startTime/endTime as epoch ms strings;
            // ISO strings silently return empty.
            // Window spans 90 days back AND 90 days forward: appointments are
            // inherently future-facing, so an end of `now` would silently drop
            // every upcoming appointment (e.g. "citas de mañana" → 0). Widening
            // the range adds no extra requests — GHL returns all events in it.
            const now = Date.now();
            const apptStartTime = String(now - 90 * 86_400_000);
            const apptEndTime = String(now + 90 * 86_400_000);

            // Concurrency 3: appointments piggy-back on the same rate-limit
            // budget as the in-flight conversation fan-out (CONCURRENCY=6).
            const CONCURRENCY_APPT = 3;
            let apptCursor = 0;
            const apptBatches: GHLCalendarEvent[][] = new Array(calendarIds.length);
            await Promise.all(
              Array.from({ length: Math.min(CONCURRENCY_APPT, calendarIds.length) }, async () => {
                while (apptCursor < calendarIds.length) {
                  const idx = apptCursor++;
                  const calendarId = calendarIds[idx];
                  try {
                    const resp = await getCalendarEvents({ calendarId, startTime: apptStartTime, endTime: apptEndTime });
                    apptBatches[idx] = resp.events ?? [];
                  } catch (err) {
                    console.error(`[GHL] Calendar events fetch failed for calendar ${calendarId}:`, err);
                    apptBatches[idx] = [];
                  }
                }
              })
            );

            // Dedupe by event id (one event could appear under multiple
            // calendars in theory), then transform.
            const seen = new Set<string>();
            for (const batch of apptBatches) {
              if (!batch) continue;
              for (const ev of batch) {
                if (seen.has(ev.id)) continue;
                seen.add(ev.id);
                const advisorId = ev.assignedUserId;
                const advisorName = advisorId && userMap.has(advisorId)
                  ? userMap.get(advisorId)
                  : advisorId;
                appointments.push({
                  id: ev.id,
                  contactId: ev.contactId,
                  assignedTo: advisorName,
                  title: ev.title,
                  startTime: ev.startTime,
                  endTime: ev.endTime,
                  status: (ev.appointmentStatus ?? "").toLowerCase() || "sin estado",
                  notes: ev.notes,
                  location: ev.address ?? ev.location,
                });
              }
            }
          }
        } catch (err) {
          console.error("[GHL] Appointments fetch failed:", err);
        }

        const calls: Call[] = [];

        let tasks: Task[] = [];
        try {
          const tasksRaw = await searchLocationTasks();
          tasks = tasksRaw.map(transformTask);
        } catch (err) {
          console.error("[GHL] Tasks fetch failed:", err);
        }

        // Extract unique tags, campaigns, sources
        const tagSet = new Set<string>();
        const campaignSet = new Set<string>();
        const sourceSet = new Set<string>();
        for (const c of contacts) {
          for (const t of c.tags) tagSet.add(t);
          if (c.campaign) campaignSet.add(c.campaign);
          if (c.source) sourceSet.add(c.source);
        }
        for (const o of opportunities) {
          if (o.campaign) campaignSet.add(o.campaign);
          if (o.source) sourceSet.add(o.source);
        }

        // Debug: expose raw attributionSource from first few contacts so we can verify field names
        const debugAttribution = contactsRaw.slice(0, 5).map((c) => ({
          id: c.id,
          attributionSource: c.attributionSource ?? null,
        }));

        // Ensure the sub-account name is settled before the final payload.
        await locationPromise;

        send({
          type: "data",
          locationName,
          contacts,
          opportunities,
          calls,
          tasks,
          appointments,
          pipelines: pipelineList,
          members,
          tags: Array.from(tagSet),
          campaigns: Array.from(campaignSet),
          sources: Array.from(sourceSet),
          pautas,
          locationId: process.env.GHL_LOCATION_ID ?? "",
          meta: {
            totalContacts: contacts.length,
            totalOpportunities: opportunities.length,
            fetchedAt: new Date().toISOString(),
            debugAttribution,
          },
        });
      } catch (error) {
        console.error("[GHL Dashboard API Error]", error);
        send({
          type: "error",
          error: "Failed to fetch dashboard data",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

