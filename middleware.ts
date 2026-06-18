// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";

// Runs on every request matched by `config.matcher` below. Verifies the signed
// session cookie. Pages redirect to /login; API routes get a 401 JSON so the
// dashboard fetch fails cleanly instead of receiving an HTML redirect.
export async function middleware(req: NextRequest) {
  // Fail closed if misconfigured.
  if (!process.env.DASHBOARD_AUTH_SECRET) {
    console.error("[auth] DASHBOARD_AUTH_SECRET not set; denying all requests");
    return denied(req);
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifyToken(token);
  if (ok) return NextResponse.next();
  return denied(req);
}

function denied(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Match everything EXCEPT: the login page, the auth API routes, and Next static
// assets / favicon. Note `/login` and `/api/auth` are excluded so they stay
// reachable while unauthenticated.
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
