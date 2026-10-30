// Verification for lib/dashboard-store.ts. Run: pnpm verify:dashboard-store
//
// Wrapped in main() rather than using top-level await: this package is CJS.
//
// The store is where a lost edit would happen: two sessions saving over each
// other, a history that grows forever, an undo that restores the wrong thing.
// The DB assertions run only when DATABASE_URL is set, against throwaway
// `__verify__<ts>` rows that are always deleted.
import assert from "node:assert/strict";
import { getSql, isDbConfigured } from "../lib/db";
import { checkDocSize, listVersions, readDoc, restoreVersion, writeDoc } from "../lib/dashboard-store";
import { DOC_LIMITS, emptyDoc, type DashboardDoc } from "../lib/widgets/spec";

const titled = (title: string): DashboardDoc => ({ ...emptyDoc(), tabs: [{ id: "t1", title, widgets: [] }] });

function pureAssertions(): void {
  assert.equal(checkDocSize(emptyDoc()), true);
  const huge = titled("x");
  huge.tabs[0].title = "x".repeat(DOC_LIMITS.maxDocBytes + 1);
  assert.equal(checkDocSize(huge), false, "a doc over maxDocBytes is rejected");
  console.log("✅ checkDocSize");
}

async function dbAssertions(): Promise<void> {
  const id = `__verify__${Date.now()}`;
  const sql = getSql();
  try {
    const empty = await readDoc(id);
    assert.equal(empty.version, 0);
    assert.deepEqual(empty.doc, emptyDoc());

    const first = await writeDoc(id, titled("A"), 0, "crea A", "ai");
    assert.deepEqual(first, { ok: true, version: 1 });
    const firstAgain = await writeDoc(id, titled("A2"), 0, "crea A otra vez", "ai");
    assert.equal(firstAgain.ok, false, "a second insert at version 0 loses");

    // Two sessions holding version 1: the first save wins, the second gets the current doc back.
    const winner = await writeDoc(id, titled("B"), 1, "B", "user");
    assert.deepEqual(winner, { ok: true, version: 2 });
    const loser = await writeDoc(id, titled("C"), 1, "C", "user");
    assert.equal(loser.ok, false);
    if (!loser.ok) {
      assert.equal(loser.current.version, 2);
      assert.equal(loser.current.doc.tabs[0].title, "B");
    }

    // Undo: restoring version 1 writes its doc as a NEW version.
    const restored = await restoreVersion(id, 1, 2, "deshacer");
    assert.deepEqual(restored, { ok: true, version: 3 });
    const now = await readDoc(id);
    assert.equal(now.version, 3);
    assert.equal(now.doc.tabs[0].title, "A");

    // The history is capped.
    let version = 3;
    for (let i = 0; i < 55; i++) {
      const res = await writeDoc(id, titled(`v${i}`), version, `v${i}`, "ai");
      assert.equal(res.ok, true);
      if (res.ok) version = res.version;
    }
    const history = await listVersions(id);
    assert.ok(history.length <= DOC_LIMITS.maxVersions, `history kept ${history.length} versions`);
    assert.equal(history[0].version, version, "newest first");

    console.log("✅ Postgres: escritura condicional, conflicto, restauración y tope del historial");
  } finally {
    await sql`DELETE FROM dashboard_doc_version WHERE client_id = ${id}`;
    await sql`DELETE FROM dashboard_doc WHERE client_id = ${id}`;
  }
}

async function main(): Promise<void> {
  pureAssertions();
  if (isDbConfigured()) await dbAssertions();
  else console.log("⏭  DATABASE_URL ausente — se omitieron las aserciones contra Postgres");
  console.log("✅ verify:dashboard-store OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
