import { getContacts, getOpportunities } from "@/lib/ghl-client";
import { NextResponse } from "next/server";

const BASE = "https://services.leadconnectorhq.com";
const headers = () => ({
  Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
  Version: "2021-07-28",
  Accept: "application/json",
});

async function getFullContact(id: string) {
  const res = await fetch(`${BASE}/contacts/${id}`, { headers: headers() });
  return res.json();
}

export async function GET() {
  // 1. Fetch 50 contacts from the list endpoint and show raw objects
  const listRes = await getContacts({ limit: 50 });
  const rawList = listRes.contacts as unknown as Record<string, unknown>[];

  // Find first contact that has ANY attribution-related key
  const withAttribution = rawList.find((c) => {
    const keys = Object.keys(c);
    return keys.some((k) => k.toLowerCase().includes("attribution") || k.toLowerCase().includes("utm"));
  });

  // Find first contact whose source is not null
  const withSource = rawList.find((c) => c.source != null);

  // All unique top-level keys across all 50 contacts
  const allKeys = new Set<string>();
  for (const c of rawList) Object.keys(c).forEach((k) => allKeys.add(k));

  // 2. Fetch a single contact full record for the first one with source
  const targetId = (withSource?.id ?? rawList[0]?.id) as string;
  const fullContact = targetId ? await getFullContact(targetId) : null;

  // 3. Check a raw opportunity
  const oppsRes = await getOpportunities({ limit: 3 });
  const rawOpps = oppsRes.opportunities as unknown as Record<string, unknown>[];
  const oppKeys = new Set<string>();
  for (const o of rawOpps) Object.keys(o).forEach((k) => oppKeys.add(k));

  return NextResponse.json({
    listEndpointKeys: Array.from(allKeys).sort(),
    contactWithAttribution: withAttribution ?? null,
    contactWithSource: withSource ?? null,
    fullContactRecord: fullContact,
    opportunityKeys: Array.from(oppKeys).sort(),
    sampleOpportunity: rawOpps[0] ?? null,
  });
}
