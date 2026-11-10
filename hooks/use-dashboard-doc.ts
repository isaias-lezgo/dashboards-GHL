"use client";

// The AI-managed panel document in the browser: load, optimistic commits, undo.
//
// Every change — from the AI copilot or from a manual click — goes through
// commit(), which applies it at once, saves it conditionally on the version the
// browser last saw, and rolls back on failure. Commits run through a promise
// queue: the agent loop executes parallel tool calls with Promise.all, and two
// writes racing for the same expectedVersion would make one of them a conflict
// with ourselves.
import { useCallback, useEffect, useRef, useState } from "react";
import { docProblem, emptyDoc, parseDoc, type DashboardDoc } from "@/lib/widgets/spec";
import { DocOpError } from "@/lib/widgets/doc-ops";

export type CommitResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "invalid" | "network" | "disabled"; message: string };

export interface DashboardDocApi {
  enabled: boolean | null;
  doc: DashboardDoc | null;
  version: number;
  loading: boolean;
  error: string | null;
  commit(mutate: (d: DashboardDoc) => DashboardDoc, change: string, source: "ai" | "user"): Promise<CommitResult>;
  undo(): Promise<CommitResult>;
  canUndo: boolean;
  reload(): Promise<void>;
}

const CONFLICT_MESSAGE = "El panel cambió en otra sesión; ya se recargó.";
const NETWORK_MESSAGE = "No se pudo guardar: sin conexión con el servidor.";
const DISABLED_MESSAGE = "El panel no está activado para esta cuenta.";

/**
 * Whether the panel's GET has answered — or failed. Whatever waits on knowing if
 * the panel is on (the large-account date auto-scope) must also stop waiting on
 * a failure: a DB hiccup must not change the classic dashboard of a client who
 * does not even have the panel.
 */
export function panelSettled(api: { enabled: boolean | null; error: string | null }): boolean {
  return api.enabled !== null || api.error !== null;
}

/** Runs `fn` up to `attempts` times, `delayMs` apart; rethrows the last error. */
export async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

const LOAD_ATTEMPTS = 2;
const LOAD_RETRY_MS = 1500;

interface Snapshot {
  enabled: boolean | null;
  doc: DashboardDoc | null;
  version: number;
}

export function useDashboardDoc(): DashboardDocApi {
  const [snap, setSnap] = useState<Snapshot>({ enabled: null, doc: null, version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Versions to go back to, newest last: the version each successful change of
  // this session started from. Undo restores the top one, so repeated undos keep
  // walking back instead of bouncing between the last two states.
  const [undoStack, setUndoStack] = useState<number[]>([]);

  const current = useRef<Snapshot>(snap);
  const stack = useRef<number[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const apply = useCallback((next: Snapshot) => {
    current.current = next;
    setSnap(next);
  }, []);
  const setStack = useCallback((next: number[]) => {
    stack.current = next;
    setUndoStack(next);
  }, []);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const fetchDoc = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/dashboards", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { enabled: boolean; doc: unknown; version: number };
    apply({ enabled: body.enabled, doc: parseDoc(body.doc), version: body.version });
  }, [apply]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await withRetry(fetchDoc, LOAD_ATTEMPTS, LOAD_RETRY_MS);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el panel");
    } finally {
      setLoading(false);
    }
  }, [fetchDoc]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // PUT with the version this browser holds. Records the starting version on the
  // undo stack only for forward changes (not for undo's own writes).
  const save = useCallback(
    async (prev: Snapshot, next: DashboardDoc, change: string, source: "ai" | "user", recordUndo: boolean): Promise<CommitResult> => {
      apply({ ...prev, doc: next });
      try {
        const res = await fetch("/api/dashboards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc: next, expectedVersion: prev.version, change, source }),
        });
        if (res.status === 409) {
          const body = (await res.json()) as { doc: unknown; version: number };
          apply({ ...prev, doc: parseDoc(body.doc), version: body.version });
          return { ok: false, reason: "conflict", message: CONFLICT_MESSAGE };
        }
        if (!res.ok) {
          apply(prev);
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, reason: res.status === 403 ? "disabled" : "invalid", message: body.error ?? `No se pudo guardar (HTTP ${res.status}).` };
        }
        const { version } = (await res.json()) as { version: number };
        apply({ ...prev, doc: next, version });
        if (recordUndo) setStack([...stack.current, prev.version]);
        return { ok: true, version };
      } catch {
        apply(prev);
        return { ok: false, reason: "network", message: NETWORK_MESSAGE };
      }
    },
    [apply, setStack]
  );

  const commit = useCallback(
    (mutate: (d: DashboardDoc) => DashboardDoc, change: string, source: "ai" | "user") =>
      enqueue(async (): Promise<CommitResult> => {
        const prev = current.current;
        if (prev.enabled !== true || !prev.doc) return { ok: false, reason: "disabled", message: DISABLED_MESSAGE };
        let next: DashboardDoc;
        try {
          next = mutate(prev.doc);
        } catch (err) {
          if (err instanceof DocOpError) return { ok: false, reason: "invalid", message: err.message };
          throw err;
        }
        const problem = docProblem(next);
        if (problem) return { ok: false, reason: "invalid", message: problem };
        return save(prev, next, change, source, true);
      }),
    [enqueue, save]
  );

  const undo = useCallback(
    () =>
      enqueue(async (): Promise<CommitResult> => {
        const prev = current.current;
        const target = stack.current[stack.current.length - 1];
        if (prev.enabled !== true || !prev.doc || target === undefined) {
          return { ok: false, reason: "invalid", message: "No hay nada que deshacer." };
        }
        let result: CommitResult;
        if (target === 0) {
          // Before the first save the panel was empty: there is no version 0 row.
          result = await save(prev, emptyDoc(), "Deshacer", "user", false);
        } else {
          try {
            const res = await fetch("/api/dashboards/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version: target, expectedVersion: prev.version }),
            });
            if (res.status === 409) {
              const body = (await res.json()) as { doc: unknown; version: number };
              apply({ ...prev, doc: parseDoc(body.doc), version: body.version });
              return { ok: false, reason: "conflict", message: CONFLICT_MESSAGE };
            }
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              return { ok: false, reason: "invalid", message: body.error ?? `No se pudo deshacer (HTTP ${res.status}).` };
            }
            const { version } = (await res.json()) as { version: number };
            await fetchDoc();
            result = { ok: true, version };
          } catch {
            return { ok: false, reason: "network", message: NETWORK_MESSAGE };
          }
        }
        if (result.ok) setStack(stack.current.slice(0, -1));
        return result;
      }),
    [apply, enqueue, fetchDoc, save, setStack]
  );

  return {
    enabled: snap.enabled,
    doc: snap.doc,
    version: snap.version,
    loading,
    error,
    commit,
    undo,
    canUndo: undoStack.length > 0,
    reload,
  };
}
