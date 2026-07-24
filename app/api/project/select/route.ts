// app/api/project/select/route.ts
// Sets the dash_project cookie. Sits behind the middleware gate, so reaching this
// route already proves dash_access is valid.
import { NextResponse } from "next/server";
import {
  COOKIE_OPTIONS,
  PROJECT_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signToken,
} from "@/lib/auth";
import { getClientById } from "@/lib/clients";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let id = "";
  try {
    const body = (await req.json()) as { id?: string };
    id = body.id ?? "";
  } catch {
    id = "";
  }

  // Validate against the roster BEFORE signing: signing an unknown id would mint a
  // cookie that passes verifyToken but resolves to null on every request, which
  // reads as "logged out" rather than as the bad input it is.
  let known = false;
  try {
    known = getClientById(id) !== null;
  } catch (err) {
    console.error("[project] Could not load project roster:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!known) {
    return NextResponse.json({ error: "unknown_project" }, { status: 400 });
  }

  const expiryMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const token = await signToken(id, expiryMs);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROJECT_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS });
  return res;
}
