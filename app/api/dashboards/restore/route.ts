// Undo / "como estaba ayer": writes an earlier version of the panel as a new
// version. Same tenant and conflict rules as PUT /api/dashboards.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClient, unauthorized } from "@/lib/session";
import { restoreVersion } from "@/lib/dashboard-store";

export const runtime = "nodejs";

const body = z.object({
  version: z.number().int().min(1),
  expectedVersion: z.number().int().min(0),
});

export async function POST(req: Request) {
  const client = await requireClient();
  if (!client) return unauthorized();
  if (!client.aiPanel) return NextResponse.json({ error: "El panel no está activado para esta cuenta" }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cuerpo inválido", issues: parsed.error.issues }, { status: 400 });

  try {
    const res = await restoreVersion(client.id, parsed.data.version, parsed.data.expectedVersion, `Restauró la versión ${parsed.data.version}`);
    if (!res.ok) return NextResponse.json({ doc: res.current.doc, version: res.current.version }, { status: 409 });
    return NextResponse.json({ version: res.version });
  } catch (err) {
    if (err instanceof Error && err.message.includes("ya no está en el historial")) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[/api/dashboards/restore] failed:", err);
    return NextResponse.json({ error: "No se pudo restaurar el panel" }, { status: 500 });
  }
}
