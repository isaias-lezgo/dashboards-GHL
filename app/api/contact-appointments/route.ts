import { NextResponse } from "next/server";
import { getOpportunityById } from "@/lib/ghl-client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const opportunityId = searchParams.get("opportunityId");

  if (!opportunityId) {
    return NextResponse.json({ error: "opportunityId requerido" }, { status: 400 });
  }

  try {
    const opp = await getOpportunityById(opportunityId);
    return NextResponse.json({ appointments: opp.calendarEvents ?? [] });
  } catch (err) {
    console.error("[contact-appointments] Error:", err);
    return NextResponse.json(
      { error: "No se pudieron obtener las citas" },
      { status: 500 }
    );
  }
}
