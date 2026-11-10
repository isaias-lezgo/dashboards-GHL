// The AI-managed panel document of the logged-in client.
//
// The client id comes ONLY from requireClient() — never from the body — so a
// session can read and write its own panel and nothing else. Writes are
// conditional on the version the browser last saw (lib/dashboard-store.ts):
// a stale write gets 409 with the current doc instead of overwriting it.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClient, unauthorized } from "@/lib/session";
import { checkDocSize, readDoc, writeDoc } from "@/lib/dashboard-store";
import { dashboardDocSchema, emptyDoc } from "@/lib/widgets/spec";

export const runtime = "nodejs";

const putBody = z.object({
  doc: z.unknown(),
  expectedVersion: z.number().int().min(0),
  change: z.string(),
  source: z.enum(["ai", "user"]),
});

export async function GET() {
  const client = await requireClient();
  if (!client) return unauthorized();
  if (!client.aiPanel) return NextResponse.json({ enabled: false, doc: emptyDoc(), version: 0 });
  try {
    const { doc, version } = await readDoc(client.id);
    return NextResponse.json({ enabled: true, doc, version });
  } catch (err) {
    console.error("[/api/dashboards] read failed:", err);
    return NextResponse.json({ error: "No se pudo leer el panel" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const client = await requireClient();
  if (!client) return unauthorized();
  if (!client.aiPanel) return NextResponse.json({ error: "El panel no está activado para esta cuenta" }, { status: 403 });

  const body = putBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Cuerpo inválido", issues: body.error.issues }, { status: 400 });
  const doc = dashboardDocSchema.safeParse(body.data.doc);
  if (!doc.success) return NextResponse.json({ error: "Panel inválido", issues: doc.error.issues }, { status: 400 });
  if (!checkDocSize(doc.data)) return NextResponse.json({ error: "El panel es demasiado grande" }, { status: 413 });

  try {
    const res = await writeDoc(client.id, doc.data, body.data.expectedVersion, body.data.change.slice(0, 200), body.data.source);
    if (!res.ok) return NextResponse.json({ doc: res.current.doc, version: res.current.version }, { status: 409 });
    return NextResponse.json({ version: res.version });
  } catch (err) {
    console.error("[/api/dashboards] write failed:", err);
    return NextResponse.json({ error: "No se pudo guardar el panel" }, { status: 500 });
  }
}
