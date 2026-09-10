"use client";

import { useState, useEffect, useRef } from "react";
import type { AdStat, AdsStatus } from "@/lib/types";

interface AdBreakdownResponse {
  status: AdsStatus;
  message?: string;
  ads: AdStat[];
}

/**
 * Per-AD Meta spend for one window, from /api/ads-campaigns.
 *
 * Ad-level because the ad id is the only key that joins to the CRM (Pauta's
 * `id_de_pauta`); the caller rolls these up to campaigns.
 *
 * Separate from the main sync because the route is N+1 in the number of
 * campaigns — see the comment there. `enabled` keeps it from firing at all when
 * the account has no ad data, so a disconnected client never pays for a request
 * whose answer is already known.
 *
 * Refetches whenever the window moves, which is the point: the numbers have to
 * describe the same period as the date filter above them.
 */
export function useAdCampaigns(params: {
  from?: string;
  to?: string;
  enabled: boolean;
}) {
  const { from, to, enabled } = params;
  const [ads, setAds] = useState<AdStat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !from || !to) {
      setAds([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    // The window can change several times while the user tries date presets;
    // without this, a slow early request can land after a fast later one and
    // overwrite the current window's numbers with a stale window's.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetch(`/api/ads-campaigns?from=${from}&to=${to}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as AdBreakdownResponse;
        if (controller.signal.aborted) return;
        if (!res.ok || data.status !== "connected") {
          setAds([]);
          setError(data.message ?? "No se pudo leer el reporte por campaña.");
          return;
        }
        setAds(data.ads ?? []);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[useAdCampaigns]", err);
        setError("No se pudo leer el reporte por campaña.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [from, to, enabled]);

  return { ads, isLoading, error };
}
