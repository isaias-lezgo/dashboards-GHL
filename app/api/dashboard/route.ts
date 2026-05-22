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
  type GHLContact,
  type GHLOpportunity,
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

        // Fetch full message threads for first 5 contacts
        send({ type: "progress", message: "Cargando conversaciones…" });
        const messages: Message[] = [];
        const first5 = contacts.slice(0, 5);

        for (const contact of first5) {
          try {
            const convResp = await getConversations({ contactId: contact.id, limit: 20 });
            for (const conv of convResp.conversations.slice(0, 3)) {
              try {
                const msgResp = await getMessages(conv.id, { limit: 50 });
                for (const msg of msgResp.messages.messages) {
                  const transformed = ghlMessageToInternal(msg, contact.id);
                  if (transformed) messages.push(transformed);
                }
              } catch {
                // skip conversations that fail individually
              }
            }
          } catch {
            // skip contacts whose conversations can't be fetched
          }
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

