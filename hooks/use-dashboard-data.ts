"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
  Pipeline,
  Pauta,
  Appointment,
} from "@/lib/types";

export interface DashboardData {
  contacts: Contact[];
  opportunities: Opportunity[];
  calls: Call[];
  tasks: Task[];
  messages: Message[];
  appointments: Appointment[];
  pipelines: Pipeline[];
  members: string[];
  tags: string[];
  campaigns: string[];
  sources: string[];
  pautas: Pauta[];
  locationId: string;
  meta: {
    totalContacts: number;
    totalOpportunities: number;
    totalMessages: number;
    fetchedAt: string;
  };
}

async function fetchStream(
  url: string,
  onProgress: (message: string) => void,
  signal: AbortSignal
): Promise<DashboardData> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: DashboardData | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "progress") {
          onProgress(msg.message);
        } else if (msg.type === "data") {
          const { type: _t, ...rest } = msg;
          data = rest as DashboardData;
        } else if (msg.type === "error") {
          throw new Error(msg.message || "Stream error");
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  if (!data) throw new Error("No data received from stream");
  return data;
}

export function useDashboardData(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [progress, setProgress] = useState<string>("Iniciando sincronización…");
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
      const result = await fetchStream(url, setProgress, ctrl.signal);
      setData(result);
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
    refresh,
  };
}
