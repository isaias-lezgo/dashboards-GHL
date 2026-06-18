// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signToken,
  safeEqual,
} from "@/lib/auth";

export const runtime = "nodejs";

// In-memory per-IP rate limiter. NOTE: on Vercel this state is per-instance and
// resets on cold starts, so it is a soft mitigation against scripted guessing,
// not an airtight distributed limiter (see design doc).
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const attempts = new Map<string, { count: number; firstMs: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Returns true if the IP is currently locked out.
function isLimited(ip: string): boolean {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstMs > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.firstMs > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstMs: now });
  } else {
    rec.count += 1;
  }
}

export async function POST(req: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || !process.env.DASHBOARD_AUTH_SECRET) {
    console.error("[auth] DASHBOARD_PASSWORD or DASHBOARD_AUTH_SECRET not set");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const ip = clientIp(req);
  if (isLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let submitted = "";
  try {
    const body = (await req.json()) as { password?: string };
    submitted = body.password ?? "";
  } catch {
    submitted = "";
  }

  if (!safeEqual(submitted, password)) {
    recordFailure(ip);
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  // Success: clear failures and set the signed session cookie.
  attempts.delete(ip);
  const expiryMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const token = await signToken(expiryMs);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
