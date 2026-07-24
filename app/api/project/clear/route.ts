// app/api/project/clear/route.ts
// Drops the project selection, sending the user back to the picker. The gate
// cookie survives — this is "cambiar proyecto", not "cerrar sesión".
import { NextResponse } from "next/server";
import { COOKIE_OPTIONS, PROJECT_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROJECT_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
