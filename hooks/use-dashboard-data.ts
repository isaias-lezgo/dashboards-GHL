"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Pipeline,
  Pauta,
  Appointment,
} from "@/lib/types";
import { fetchStream } from "./fetch-stream";

export interface DashboardData {
  contacts: Contact[];
  opportunities: Opportunity[];
  calls: Call[];
  tasks: Task[];
  appointments: Appointment[];
  pipelines: Pipeline[];
  members: string[];
  tags: string[];
  campaigns: string[];
  sources: string[];
  pautas: Pauta[];
  locationId: string;
  locationName: string;
  meta: {
    totalContacts: number;
    totalOpportunities: number;
    fetchedAt: string;
  };
}

export function useDashboardData(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [progress, setProgress] = useState<string>("Iniciando sincronización…");
  const [locationName, setLocationName] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const startDate = params?.startDate;
  const endDate = params?.endDate;

  const load = useCallback(async (sd?: string, ed?: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const searchParams = new URLSearchParams();
    if (sd) searchParams.set("startDate", sd);
    if (ed) searchParams.set("endDate", ed);
    const qs = searchParams.toString();
    const url = `/api/dashboard${qs ? `?${qs}` : ""}`;

    setIsLoading(true);
    setIsError(false);
    setProgress("Iniciando sincronización…");

    try {
      const result = await fetchStream<DashboardData>(url, setProgress, ctrl.signal, setLocationName);
      setData(result);
      if (result.locationName) setLocationName(result.locationName);
      setProgress("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsError(true);
        setProgress("");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount and when date params change
  useEffect(() => {
    load(startDate, endDate);
    return () => {
      abortRef.current?.abort();
    };
  }, [load, startDate, endDate]);

  const refresh = useCallback(() => {
    load(startDate, endDate);
  }, [load, startDate, endDate]);

  return {
    data,
    isLoading,
    isError,
    progress,
    locationName,
    refresh,
  };
}
