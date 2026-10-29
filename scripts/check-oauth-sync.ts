// Read-only probe: does a client's dashboard come out the same over the
// Marketplace app's OAuth token as over its PIT? Runs the real syncProject twice
// and diffs every dataset count plus the Meta report.
//
// Run before trusting OAuth for a client: an OAuth token whose scopes miss one
// endpoint does not fail the sync — the caller's catch turns that dataset into
// an EMPTY array, and the dashboard renders a quiet zero. Only a diff shows it.
//
//   pnpm check:oauth-sync <clientId>
//
// Wrapped in main(): CommonJS under tsx, no top-level await.
import { getClientById } from "../lib/clients";
import { syncProject } from "../lib/sync";
import { resolveGhlToken, __resetTokenCache } from "../lib/ghl-token";
import type { DashboardPayload } from "../lib/types";

function summarize(p: DashboardPayload): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v)) out[k] = v.length;
  }
  out["ads.status"] = p.ads?.status ?? "(none)";
  out["ads.days"] = p.ads?.daily.length ?? 0;
  out["ads.spend"] = Math.round((p.ads?.daily ?? []).reduce((s, d) => s + (d.spend ?? 0), 0) * 100) / 100;
  return out;
}

async function run(clientId: string, mode: "pit" | "oauth") {
  const client = getClientById(clientId);
  if (!client) throw new Error(`Unknown client ${clientId}`);
  __resetTokenCache();
  process.env.GHL_OAUTH_DISABLED = mode === "pit" ? "1" : "0";
  const { source } = await resolveGhlToken(client);
  if (source !== mode) throw new Error(`Asked for ${mode} but resolved ${source} — is the app installed on ${clientId}?`);
  // Count GHL's 429s for this run: a slow run with many 429s is the shared
  // per-location rate budget talking, not the token type.
  let throttled = 0;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[GHL] 429")) throttled++;
    else warn(...args);
  };
  const t0 = Date.now();
  try {
    const payload = await syncProject(client);
    return { summary: summarize(payload), seconds: Math.round((Date.now() - t0) / 100) / 10, throttled };
  } finally {
    console.warn = warn;
  }
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) throw new Error("Usage: pnpm check:oauth-sync <clientId>");
  // OAuth first, then a pause, then the PIT: the two runs share the location's
  // rate budget, so whichever goes second inherits the first one's 429s.
  const oauth = await run(clientId, "oauth");
  await new Promise((r) => setTimeout(r, 30_000));
  const pit = await run(clientId, "pit");

  const keys = [...new Set([...Object.keys(pit.summary), ...Object.keys(oauth.summary)])].sort();
  let diffs = 0;
  console.log(`\n${"dataset".padEnd(22)}${"PIT".padStart(12)}${"OAuth".padStart(12)}`);
  for (const k of keys) {
    const a = pit.summary[k];
    const b = oauth.summary[k];
    const same = a === b;
    if (!same) diffs++;
    console.log(`${k.padEnd(22)}${String(a).padStart(12)}${String(b).padStart(12)}${same ? "" : "   ← DIFERENTE"}`);
  }
  console.log(`\nOAuth ${oauth.seconds}s (${oauth.throttled}× 429) · PIT ${pit.seconds}s (${pit.throttled}× 429) — OAuth corrió primero`);
  // Counts that move between two live reads seconds apart (a new lead, a new
  // message) are expected; an OAuth zero against a PIT non-zero is not.
  console.log(diffs === 0 ? "✅ idénticos" : `⚠️  ${diffs} diferencia(s) — revisa si son datos nuevos o un scope faltante`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
