import { getContactNotes } from "@/lib/ghl-client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId") ?? "";

  if (!contactId) {
    return NextResponse.json({ error: "Missing contactId" }, { status: 400 });
  }

  try {
    const data = await getContactNotes(contactId);
    return NextResponse.json({
      notes: (data.notes ?? []).map((n) => ({
        id: n.id,
        body: n.body,
        userId: n.userId,
        dateAdded: n.dateAdded,
      })),
      count: data.notes?.length ?? 0,
    });
  } catch (err) {
    console.error("[/api/contact-notes]", err);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 502 });
  }
}
