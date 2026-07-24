// lib/ghl-context.ts
// Request-scoped GHL credentials.
//
// ghlFetch is the single funnel for every GHL call, but it sits several layers
// below the route handler that knows WHICH client is asking, with ~113 exported
// functions in between. AsyncLocalStorage carries the client down that call chain
// without changing a single one of those signatures. Concurrent requests for
// different clients on the same instance get independent stores.
//
// NEVER replace this with a module-level "current client" variable: one instance
// serves overlapping requests, so that would silently serve client A's dashboard
// using client B's token.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientConfig } from "./clients";

// Reported when a GHL call is about to back off and retry. It rides the same
// context as the credentials because ghlFetch sits far below the route that owns
// the NDJSON stream, and threading a callback through ~113 signatures to say
// "still working" is not worth it.
export interface RetryNotice {
  status: number;
  attempt: number; // 1-based, as shown to the user
  maxAttempts: number;
  delayMs: number;
}

interface Store {
  client: ClientConfig;
  onRetry?: (notice: RetryNotice) => void;
}

const ctx = new AsyncLocalStorage<Store>();

export function withClient<T>(
  client: ClientConfig,
  fn: () => T,
  onRetry?: (notice: RetryNotice) => void,
): T {
  return ctx.run({ client, onRetry }, fn);
}

// Diagnostics only, so it must never affect the request it is reporting on:
// no reporter is fine, and a reporter that throws is swallowed.
export function reportRetry(notice: RetryNotice): void {
  const onRetry = ctx.getStore()?.onRetry;
  if (!onRetry) return;
  try {
    onRetry(notice);
  } catch {
    // A broken progress reporter must not fail the sync.
  }
}

// Fails closed. There is deliberately no fallback to process.env or a default
// client — serving the wrong tenant's data is far worse than a 500.
export function currentClient(): ClientConfig {
  const client = ctx.getStore()?.client;
  if (!client) {
    throw new Error(
      "No GHL client context — ghlFetch() was called outside withClient(). " +
        "Wrap the route's GHL work in withClient(client, ...).",
    );
  }
  return client;
}
