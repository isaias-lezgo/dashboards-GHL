// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, COOKIE_OPTIONS, PROJECT_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Both, always: leaving dash_project behind would drop the next person straight
  // into the previous project once they log back in.
  res.cookies.set(ACCESS_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  res.cookies.set(PROJECT_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
