"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { DashboardPayload } from "@/lib/types";
import { fetchStream } from "./fetch-stream";

export type StepKey =
  | "config"
  | "contacts"
  | "opportunities"
  | "pautas"
  | "appointments"
  | "tasks";

export interface StepState {
  status: "pending" | "loading" | "done";
  count?: number;
}

export type StepMap = Record<StepKey, StepState>;

const INITIAL_STEPS: StepMap = {
  config: { status: "pending" },
  contacts: { status: "pending" },
  opportunities: { status: "pending" },
  pautas: { status: "pending" },
  appointments: { status: "pending" },
  tasks: { status: "pending" },
};

// The payload shape is defined server-side in lib/types.ts and re-exported here,
// so the cache, the route and this hook can never drift apart. `syncedAt` is the
// one field the route adds on top: when the data was pulled from GHL.
export type DashboardData = DashboardPayload & { syncedAt?: string };

// A cached read answers in one frame, well under a blink. Showing the loading
// screen for that flashes it, which reads as a glitch — so it only appears once
// a load has actually been slow for this long.
const LOADING_SCREEN_DELAY_MS = 300;

export function useDashboardData(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [progress, setProgress] = useState<string>("Iniciando sincronización…");
  const [locationName, setLocationName] = useState<string>("");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepMap>(INITIAL_STEPS);
  const abortRef = useRef<AbortController | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startDate = params?.startDate;
  const endDate = params?.endDate;

  const load = useCallback(async (sd?: string, ed?: string, fresh = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const searchParams = new URLSearchParams();
    if (sd) searchParams.set("startDate", sd);
    if (ed) searchParams.set("endDate", ed);
    // Skips the cache server-side. Only the Actualizar button sets it — that is
    // the escape hatch for "I just changed something in the CRM".
    if (fresh) searchParams.set("fresh", "1");
    const qs = searchParams.toString();
    const url = `/api/dashboard${qs ? `?${qs}` : ""}`;

    setIsLoading(true);
    setIsError(false);
    setProgress("Iniciando sincronización…");
    setSteps(INITIAL_STEPS);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setShowLoading(true), LOADING_SCREEN_DELAY_MS);

    try {
      const result = await fetchStream<DashboardData>(
        url,
        setProgress,
        ctrl.signal,
        setLocationName,
        (step) =>
          setSteps((prev) => ({
            ...prev,
            [step.key]: { status: step.status, count: step.count },
          }))
      );
      // Ignore the result of a fetch that has since been superseded (e.g. the
      // mount→abort→remount cycle from React StrictMode in dev or router.refresh
      // after login). Otherwise a stale fetch can clobber the newer one's state.
      if (ctrl.signal.aborted) return;
      setData(result);
      if (result.locationName) setLocationName(result.locationName);
      setSyncedAt(result.syncedAt ?? null);
      setProgress("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsError(true);
        setProgress("");
      }
    } finally {
      // Only the current (non-aborted) fetch may flip loading off. A superseded
      // fetch's finally must not turn off the spinner while the newer fetch is
      // still in flight — that was surfacing the empty dashboard behind the
      // loading screen. The same reasoning applies to the delay timer: clearing
      // it here would cancel the timer the newer fetch just armed.
      if (!ctrl.signal.aborted) {
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
        setShowLoading(false);
        setIsLoading(false);
      }
    }
  }, []);

  // Load on mount and when date params change
  useEffect(() => {
    load(startDate, endDate);
    return () => {
      abortRef.current?.abort();
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [load, startDate, endDate]);

  // Actualizar always goes to GHL. A refresh that served the cache back would be
  // a button that visibly does nothing.
  const refresh = useCallback(() => {
    load(startDate, endDate, true);
  }, [load, startDate, endDate]);

  return {
    data,
    isLoading,
    showLoading,
    isError,
    progress,
    locationName,
    syncedAt,
    steps,
    refresh,
  };
}
