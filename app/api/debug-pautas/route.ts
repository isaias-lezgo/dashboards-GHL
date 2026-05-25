import { NextResponse } from "next/server";
import { getCustomObjects, getCustomObjectSchema, getAllCustomObjectRecords } from "@/lib/ghl-client";

const BASE = "https://services.leadconnectorhq.com";
const PAUTA_KEY = "custom_objects.pautas";

async function probe(path: string, version: string, extraParams?: Record<string, string>) {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("locationId", locationId!);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, ok: res.ok, body };
  } catch (err) {
    return { status: 0, ok: false, body: String(err) };
  }
}

export async function GET() {
  const locationId = process.env.GHL_LOCATION_ID;

  const PAUTA_ID = "69688749ef7dd481203da14a";
  const token = process.env.GHL_API_TOKEN!;

  // Try GET /objects/records with no extra params — see what the 422 actually wants
  const recordsBase = await probe(`/objects/records`, "2023-02-21");

  // Try POST search on the object
  async function postProbe(path: string, body: unknown) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("locationId", locationId!);
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2023-02-21",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let b: unknown; try { b = JSON.parse(text); } catch { b = text; }
      return { status: res.status, ok: res.ok, body: b };
    } catch (err) { return { status: 0, ok: false, body: String(err) }; }
  }

  // POST without locationId in query string — the endpoint rejects it there
  async function postNoLoc(path: string, body: unknown) {
    const url = `${BASE}${path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2023-02-21",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let b: unknown; try { b = JSON.parse(text); } catch { b = text; }
      return { status: res.status, ok: res.ok, body: b };
    } catch (err) { return { status: 0, ok: false, body: String(err) }; }
  }

  // Test the actual ghl-client functions used by fetchAllPautas
  let step = "getCustomObjects";
  try {
    const schemasResp = await getCustomObjects();
    const objectsKeys = schemasResp.objects?.map(o => o.key);
    step = "find pauta schema";
    const stub = schemasResp.objects.find(
      s => s.labels.singular.toLowerCase().includes("pauta") || s.labels.plural.toLowerCase().includes("pautas")
    );
    if (!stub) return NextResponse.json({ error: "Pautas schema not found", objectsKeys });

    step = "getCustomObjectSchema";
    const { object: schema } = await getCustomObjectSchema(stub.key);
    const fieldNames = schema.fields?.map(f => ({ name: f.name, fieldKey: f.fieldKey }));

    step = "getAllCustomObjectRecords (first 5)";
    const allRecords = await getAllCustomObjectRecords(stub.key);

    // Also fetch 1 record directly to compare structure
    const firstId = allRecords[0]?.id;
    let directRecord: unknown = null;
    if (firstId) {
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/objects/${stub.key}/records/${firstId}`, {
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
            Version: "2023-02-21",
            Accept: "application/json",
          },
        });
        directRecord = await res.json();
      } catch (e) {
        directRecord = String(e);
      }
    }

    return NextResponse.json({
      success: true,
      pautaKey: stub.key,
      fields: fieldNames,
      totalRecords: allRecords.length,
      // Full raw record — shows ALL keys including associations
      rawSample: allRecords.slice(0, 2),
      directRecordFetch: directRecord,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), step });
  }
}
