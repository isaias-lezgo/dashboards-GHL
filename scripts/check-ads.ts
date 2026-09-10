// Read-only probe of every client's Meta ad connection. Run: pnpm check:ads
//   pnpm check:ads stanza-residencial   # just one client
//
// Wrapped in main() rather than using top-level await: this package is CJS.
//
// Why this exists: whether the ads section has anything to show is a per-client
// fact that lives entirely in GHL, is invisible from the code, and changes
// without anyone telling us. Driving the whole app to find out costs a
// multi-minute sync per client; this answers the same question in one request
// each, and prints the raw integration shape when something looks off.
//
// Read-only — it calls GETs only. It prints no tokens.
import { getClients } from "../lib/clients";
import { withClient } from "../lib/ghl-context";
import {
  getFacebookIntegration,
  getFacebookAdAccount,
  getFacebookAdReporting,
  getFacebookReportingList,
} from "../lib/ghl-client";

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

async function probe(client: ReturnType<typeof getClients>[number]) {
  return withClient(client, async () => {
    // REPORTING FIRST. The integration record is a different feature (Ad Manager
    // publishing) and is routinely absent on accounts whose reporting works —
    // sahai 404s on it while returning a full year of spend. Gating on it is the
    // bug this script exists to catch, so it must not repeat it.
    const to = new Date();
    const from = new Date(to.getTime() - 24 * DAY_MS);
    let accountId: string | undefined;
    for (const type of ["INTEGRATION", "AD_MANAGER"] as const) {
      try {
        const res = await getFacebookAdReporting({
          startDate: dayKey(from),
          endDate: dayKey(to),
          groupBy: "day",
          type,
        });
        const rows = res?.grouped ?? [];
        const spend = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
        accountId ??= rows.find((r) => r.accountId)?.accountId as string | undefined;
        console.log(`  reporting[${type}]: ${rows.length} días, spend ${spend.toFixed(2)}`);
      } catch (err) {
        console.log(`  reporting[${type}]: ERROR ${(err as Error).message.slice(0, 140)}`);
      }
    }

    if (accountId) {
      try {
        const acct = (await getFacebookAdAccount(accountId)) as Record<string, unknown>;
        console.log(`  account: ${acct.name} (${acct.currency}, ${acct.accountStatus}) ${accountId}`);
      } catch (err) {
        console.log(`  account: ERROR ${(err as Error).message.slice(0, 120)}`);
      }
      try {
        const camps = await getFacebookReportingList({
          listType: "campaigns",
          startDate: dayKey(from),
          endDate: dayKey(to),
        });
        console.log(`  campañas: ${camps.length}`);
      } catch (err) {
        console.log(`  campañas: ERROR ${(err as Error).message.slice(0, 120)}`);
      }
    }

    // Context only — never a verdict.
    try {
      const integration = (await getFacebookIntegration()) as Record<string, unknown>;
      console.log(
        `  integración (Ad Manager, informativa): status=${integration.status} adAccount=${integration.fbAdAccountId ?? "—"}`
      );
    } catch (err) {
      console.log(
        `  integración (Ad Manager, informativa): ausente — ${(err as Error).message.slice(0, 80)}`
      );
    }
  });
}

async function main() {
  const only = process.argv[2];
  const clients = getClients().filter((c) => !only || c.id === only);
  if (clients.length === 0) {
    console.error(only ? `No client with id "${only}"` : "Empty roster");
    process.exit(1);
  }

  for (const client of clients) {
    console.log(`\n=== ${client.id} (${client.locationId}) ===`);
    await probe(client);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
