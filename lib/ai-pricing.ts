// What one /api/chat turn costs, shared by the chat's cost counter and the
// panel eval (scripts/eval-panel), which must not import the browser hook.

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// USD por millón de tokens. Debe seguir al modelo de lib/chat-request.ts
// (hoy claude-sonnet-5: $2 entrada / $10 salida); lectura de caché es 0.1x la
// entrada y escritura 1.25x. Si cambia el modelo y esto no, el contador de
// costo del chat miente sin fallar — con las tarifas de Sonnet 4.6 ($3/$15)
// sobreestimaba 50%.
export const PRICING = {
  input: 2,
  output: 10,
  cacheRead: 0.2,
  cacheWrite: 2.5,
};

export function estimateCost(u: TurnUsage): number {
  return (
    (u.inputTokens * PRICING.input +
      u.outputTokens * PRICING.output +
      u.cacheReadTokens * PRICING.cacheRead +
      u.cacheCreationTokens * PRICING.cacheWrite) /
    1_000_000
  );
}
