"use client";

/**
 * Reads an NDJSON stream of `{ type: "progress" | "data" | "error", ... }`
 * frames. Calls `onProgress` for progress frames and resolves with the payload
 * of the single `data` frame (its `type` field stripped).
 */
export async function fetchStream<T>(
  url: string,
  onProgress: (message: string) => void,
  signal: AbortSignal
): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: T | null = null;

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
          data = rest as T;
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
