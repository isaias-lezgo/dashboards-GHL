import {
  getAllContacts,
  getAllOpportunities,
  getPipelines,
  getConversations,
  getMessages,
  getUsers,
  getLostReasons,
  getCustomObjects,
  getAllCustomObjectRecords,
  getCalendarEvents,
  type GHLContact,
  type GHLConversation,
  type GHLOpportunity,
  type GHLCalendarEvent,
} from "@/lib/ghl-client";
import { ghlMessageToInternal } from "@/lib/ghl-message-mapper";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
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

// Transform GHL data to our internal types
function transformContact(ghl: GHLContact): Contact {
  return {
    id: ghl.id,
    name: ghl.name || `${ghl.firstName || ""} ${ghl.lastName || ""}`.trim() || "Unknown",
    email: ghl.email || "",
    phone: ghl.phone || "",
    tags: ghl.tags || [],
    createdAt: ghl.dateAdded,
    source: firstAttr(ghl.attributions)?.utmSource || firstAttr(ghl.attributions)?.adSource || ghl.source || "direct",
    campaign: buildCampaignLabel(
      firstAttr(ghl.attributions)?.utmContent,
      firstAttr(ghl.attributions)?.utmCampaign
    ),
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    assignedTo: ghl.assignedTo,
  };
}

function transformOpportunity(
  ghl: GHLOpportunity,
  pipelines: Map<string, { name: string; stages: Map<string, string> }>
): Opportunity {
  const pipeline = pipelines.get(ghl.pipelineId);
  const stageName = pipeline?.stages.get(ghl.pipelineStageId) || "Unknown";

  return {
    id: ghl.id,
    name: ghl.name,
    value: ghl.monetaryValue || 0,
    stage: stageName,
    status: ghl.status,
    pipelineId: ghl.pipelineId,
    pipelineName: pipeline?.name || "Unknown",
    contactId: ghl.contact.id,
    createdAt: ghl.dateAdded,
    updatedAt: ghl.dateUpdated || ghl.dateAdded,
    source: firstAttr(ghl.attributions)?.utmSource || firstAttr(ghl.attributions)?.adSource || ghl.source,
    campaign: buildCampaignLabel(
      firstAttr(ghl.attributions)?.utmContent,
      firstAttr(ghl.attributions)?.utmCampaign
    ),
    adType: firstAttr(ghl.attributions)?.utmMedium || firstAttr(ghl.attributions)?.utmSessionSource,
    lostReason: ghl.lostReasonId,
    assignedTo: ghl.assignedTo,
    tags: ghl.contact.tags || [],
  };
}


function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
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
    return records.map((r) => ({
      id: r.id,
      tipo: String(r.properties["tipo"] ?? "") || "Sin tipo",
      nombrePauta: String(r.properties["nombre_pauta"] ?? "") || "Sin nombre",
      createdAt: r.createdAt ?? new Date().toISOString(),
    }));
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

        // Fetch pipelines, users, lost reasons first (fast, no pagination)
        const [pipelinesResult, usersResult, lostReasonsResult] =
          await Promise.allSettled([
            getPipelines(),
            getUsers(),
            getLostReasons(),
          ]);

        send({ type: "progress", message: "Cargando pipelines y configuración…" });

        const pipelinesRaw = pipelinesResult.status === "fulfilled" ? pipelinesResult.value : { pipelines: [] };
        const usersRaw = usersResult.status === "fulfilled" ? usersResult.value : { users: [] };
        const lostReasonsRaw = lostReasonsResult.status === "fulfilled" ? lostReasonsResult.value : { customValues: [] };

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

        // Build lost reason map
        const lostReasonMap = new Map<string, string>();
        for (const cv of lostReasonsRaw.customValues) {
          lostReasonMap.set(cv.id, cv.name);
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
          const contact = transformContact(c);
          if (contact.assignedTo && userMap.has(contact.assignedTo)) {
            contact.assignedTo = userMap.get(contact.assignedTo);
          }
          return contact;
        });

        // Transform opportunities
        const opportunities: Opportunity[] = opportunitiesRaw.map((o) => {
          const opp = transformOpportunity(o, pipelineMap);
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
            email: embedded.email || "",
            phone: embedded.phone || "",
            tags: embedded.tags || [],
            createdAt: raw.dateAdded,
            source: attr?.utmSource || attr?.adSource || raw.source || "direct",
            campaign: buildCampaignLabel(attr?.utmContent, attr?.utmCampaign),
            adType: attr?.utmMedium || attr?.utmSessionSource,
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
          }
          if (opp.lostReason && lostReasonMap.has(opp.lostReason)) {
            opp.lostReason = lostReasonMap.get(opp.lostReason);
          }
        }

        // Fetch last 30 active conversations PER user (not 30 in total),
        // so every advisor with activity shows up in the conversation charts.
        send({ type: "progress", message: "Cargando conversaciones…" });
        const messages: Message[] = [];
        try {
          const userIds = Array.from(userMap.keys());
          const userConvLists = await Promise.allSettled(
            userIds.map(async (userId) => {
              const resp = await getConversations({ limit: 30, assignedTo: userId });
              return { userId, conversations: resp.conversations };
            })
          );

          // Dedupe conversations across users (a conv reassigned mid-stream
          // could surface under multiple users) and remember which user we
          // queried for, so we can attribute messages even if conv.assignedTo
          // is missing from the GHL payload.
          const convQueue: Array<{ conv: GHLConversation; queriedUserId: string }> = [];
          const seenConvIds = new Set<string>();
          for (const result of userConvLists) {
            if (result.status !== "fulfilled") continue;
            const { userId, conversations } = result.value;
            for (const conv of conversations) {
              if (seenConvIds.has(conv.id)) continue;
              seenConvIds.add(conv.id);
              convQueue.push({ conv, queriedUserId: userId });
            }
          }

          // Bounded-concurrency message fetches so a 100+-conversation queue
          // doesn't fan out to hundreds of simultaneous requests.
          const CONCURRENCY = 6;
          let cursor = 0;
          const collected: Message[][] = new Array(convQueue.length);
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, convQueue.length) }, async () => {
              while (cursor < convQueue.length) {
                const idx = cursor++;
                const { conv, queriedUserId } = convQueue[idx];
                const advisorId = conv.assignedTo ?? queriedUserId;
                const advisorName = userMap.get(advisorId) ?? advisorId;
                try {
                  const msgResp = await getMessages(conv.id, { limit: 50 });
                  const out: Message[] = [];
                  for (const msg of msgResp.messages.messages) {
                    const transformed = ghlMessageToInternal(msg, conv.contactId, {
                      conversationId: conv.id,
                      assignedTo: advisorName,
                    });
                    if (transformed) out.push(transformed);
                  }
                  collected[idx] = out;
                } catch {
                  collected[idx] = [];
                }
              }
            })
          );
          for (const batch of collected) {
            if (batch) messages.push(...batch);
          }
        } catch (err) {
          console.error("[GHL] Conversations fetch failed:", err);
        }

        // Fetch appointments per asesor over the last 90 days.
        // /calendars/events takes (userId, startTime, endTime); we fan out
        // across users with bounded concurrency. Per-user failures are
        // swallowed so one bad user doesn't blank the chart.
        send({ type: "progress", message: "Cargando citas…" });
        const appointments: Appointment[] = [];
        try {
          const now = Date.now();
          const apptStartTime = new Date(now - 90 * 86_400_000).toISOString();
          const apptEndTime = new Date(now).toISOString();
          const userIds = Array.from(userMap.keys());

          const CONCURRENCY_APPT = 6;
          let apptCursor = 0;
          const apptBatches: GHLCalendarEvent[][] = new Array(userIds.length);
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY_APPT, userIds.length) }, async () => {
              while (apptCursor < userIds.length) {
                const idx = apptCursor++;
                const userId = userIds[idx];
                try {
                  const resp = await getCalendarEvents({ userId, startTime: apptStartTime, endTime: apptEndTime });
                  apptBatches[idx] = resp.events ?? [];
                } catch (err) {
                  console.error(`[GHL] Calendar events fetch failed for user ${userId}:`, err);
                  apptBatches[idx] = [];
                }
              }
            })
          );

          // Dedupe by event id, then transform.
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
              });
            }
          }
        } catch (err) {
          console.error("[GHL] Appointments fetch failed:", err);
        }

        const calls: Call[] = [];
        const tasks: Task[] = [];

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

        send({
          type: "data",
          contacts,
          opportunities,
          calls,
          tasks,
          messages,
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
            totalMessages: messages.length,
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

