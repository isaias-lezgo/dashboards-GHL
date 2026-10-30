// The AI-managed panel's persistence: one document per client plus its recent
// history. The ONLY module that knows the dashboard_doc tables — the same role
// lib/sync-store.ts plays for project_sync.
//
// Server-only. Every caller has already resolved the client through
// requireClient(); the client id NEVER comes from a request body.
//
// Unlike the sync cache, this is client content: nothing here is disposable.
import { getSql } from "./db";
import { DOC_LIMITS, emptyDoc, parseDoc, type DashboardDoc } from "./widgets/spec";

export interface StoredDoc {
  doc: DashboardDoc;
  version: number;
}

export type WriteResult = { ok: true; version: number } | { ok: false; current: StoredDoc };

/** The client's panel, or an empty one at version 0 when it has never saved. */
export async function readDoc(clientId: string): Promise<StoredDoc> {
  const rows = await getSql()`
    SELECT doc, version FROM dashboard_doc WHERE client_id = ${clientId}
  `;
  if (rows.length === 0) return { doc: emptyDoc(), version: 0 };
  return { doc: parseDoc(rows[0].doc), version: Number(rows[0].version) };
}

/**
 * Saves `doc` only if the stored version is still `expectedVersion`. The whole
 * decision — and the history row — lives in ONE statement, the claimSync
 * pattern: deciding in TypeScript would leave a window in which two sessions
 * both see the old version and both write. A loser gets the current doc back.
 */
export async function writeDoc(
  clientId: string,
  doc: DashboardDoc,
  expectedVersion: number,
  change: string,
  source: "ai" | "user"
): Promise<WriteResult> {
  const sql = getSql();
  const json = JSON.stringify(doc);
  const note = change.slice(0, 200);
  const rows =
    expectedVersion === 0
      ? await sql`
          WITH ins AS (
            INSERT INTO dashboard_doc (client_id, doc, version, updated_by)
            VALUES (${clientId}, ${json}::jsonb, 1, ${source})
            ON CONFLICT (client_id) DO NOTHING
            RETURNING version, doc
          )
          INSERT INTO dashboard_doc_version (client_id, version, doc, change, source)
          SELECT ${clientId}, version, doc, ${note}, ${source} FROM ins
          RETURNING version
        `
      : await sql`
          WITH upd AS (
            UPDATE dashboard_doc
               SET doc = ${json}::jsonb, version = version + 1, updated_at = now(), updated_by = ${source}
             WHERE client_id = ${clientId} AND version = ${expectedVersion}
            RETURNING version, doc
          )
          INSERT INTO dashboard_doc_version (client_id, version, doc, change, source)
          SELECT ${clientId}, version, doc, ${note}, ${source} FROM upd
          RETURNING version
        `;
  if (rows.length === 0) return { ok: false, current: await readDoc(clientId) };
  const version = Number(rows[0].version);
  // Best-effort: a failed trim must never fail a save that already happened.
  try {
    await sql`
      DELETE FROM dashboard_doc_version
       WHERE client_id = ${clientId} AND version <= ${version - DOC_LIMITS.maxVersions}
    `;
  } catch (err) {
    console.error("[dashboard-store] could not trim history:", err);
  }
  return { ok: true, version };
}

export async function listVersions(
  clientId: string
): Promise<{ version: number; change: string; source: string; createdAt: string }[]> {
  const rows = await getSql()`
    SELECT version, change, source, created_at FROM dashboard_doc_version
     WHERE client_id = ${clientId}
     ORDER BY version DESC
     LIMIT ${DOC_LIMITS.maxVersions}
  `;
  return rows.map((r) => ({
    version: Number(r.version),
    change: String(r.change),
    source: String(r.source),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/** Undo / "como estaba ayer": writes an old version's doc as a NEW version. */
export async function restoreVersion(
  clientId: string,
  version: number,
  expectedVersion: number,
  change: string
): Promise<WriteResult> {
  const rows = await getSql()`
    SELECT doc FROM dashboard_doc_version WHERE client_id = ${clientId} AND version = ${version}
  `;
  if (rows.length === 0) throw new Error(`La versión ${version} ya no está en el historial`);
  return writeDoc(clientId, parseDoc(rows[0].doc), expectedVersion, change, "user");
}

/** True when the doc fits the size cap (bytes of its UTF-8 JSON). */
export function checkDocSize(doc: DashboardDoc): boolean {
  return new TextEncoder().encode(JSON.stringify(doc)).length <= DOC_LIMITS.maxDocBytes;
}
