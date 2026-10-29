// app/embed/page.tsx
// Entry point of the "Dashboard" Custom Page in a GHL sub-account's left menu.
// Runs inside GHL's iframe: asks the parent frame who the user is, trades the
// encrypted answer for a session at /api/auth/sso, then opens the dashboard.
// Excluded from middleware — there is no session yet.
"use client";

import { useEffect, useState } from "react";

const MESSAGES: Record<string, string> = {
  no_parent: "Esta página se abre desde el menú de tu cuenta en Lezgo Suite CRM.",
  timeout: "No recibimos los datos de tu sesión. Recarga la página.",
  no_dashboard: "Esta sub-cuenta todavía no tiene dashboard. Escríbenos para activarlo.",
  agency_view: "Abre el dashboard desde una sub-cuenta, no desde la vista de agencia.",
  wrong_agency: "Esta cuenta no tiene acceso a este dashboard.",
  invalid_payload: "No pudimos verificar tu sesión. Recarga la página.",
};

function requestUserData(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("timeout"));
    }, timeoutMs);
    function onMessage({ data }: MessageEvent) {
      if (data?.message === "REQUEST_USER_DATA_RESPONSE" && typeof data.payload === "string") {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data.payload);
      }
    }
    window.addEventListener("message", onMessage);
    // The payload is encrypted and only our server can read it, so the target
    // origin does not need pinning — GHL also runs on white-label domains.
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
  });
}

export default function GhlEntryPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard - Lezgo Suite CRM";
    (async () => {
      if (window.parent === window) throw new Error("no_parent");
      const encryptedData = await requestUserData(10_000);
      const res = await fetch("/api/auth/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedData }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "invalid_payload");
      }
      window.location.replace("/");
    })().catch((err: Error) => setError(MESSAGES[err.message] ?? MESSAGES.invalid_payload));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-center text-sm text-muted-foreground">{error ?? "Abriendo tu dashboard…"}</p>
    </main>
  );
}
