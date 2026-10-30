import type Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS } from "@/lib/ai-tools";
import { ASSISTANT_SYSTEM_PROMPT, PANEL_PROMPT_SECTION } from "@/lib/ai-context";
import { PANEL_MODE_TOOLS } from "@/lib/widgets/tools";

// The body of one /api/chat turn, for both the assistant tab and the panel
// copilot. Kept out of the route so it can be compared field by field: the
// assistant's request must not change by a byte when the panel ships, or its
// cached prefix breaks.

export type ChatMode = "assistant" | "panel";

// Attach a rolling cache breakpoint to the most-recently-appended turn. In the
// agent loop the message history is append-only, so the cached prefix stays
// byte-stable and every turn reads the prior conversation from cache (~0.1x)
// instead of reprocessing the accumulated tool_use/tool_result history at full
// input price. The static system+tools prefix keeps its own breakpoint; this is
// the second of the 4 allowed per request.
function withRollingCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];

  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];

  if (blocks.length === 0) return messages;

  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: "ephemeral" },
  } as Anthropic.ContentBlockParam;

  const next = [...messages];
  next[lastIndex] = { ...last, content: blocks };
  return next;
}

export function buildChatRequest(args: {
  mode: ChatMode;
  datasetSummary: string;
  messages: Anthropic.MessageParam[];
  userTimezone: string;
  maxTokens?: number;
  /** Injectable for tests; the route uses the current time. */
  now?: Date;
}): Anthropic.MessageCreateParamsNonStreaming {
  const tz = args.userTimezone;
  const now = args.now ?? new Date();
  const today = now.toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
  const time = now.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  });
  const panel = args.mode === "panel";

  return {
    model: "claude-sonnet-5",
    // Sonnet 5 piensa por defecto: omitir `thinking` ya NO significa
    // pensamiento apagado como en 4.6. Se deja explícito para que se lea como
    // decisión y no como descuido — un asistente con ~22 herramientas se
    // beneficia de que razone antes de elegir cuál llamar, y con el
    // pensamiento apagado el modelo es notablemente menos propenso a usarlas.
    thinking: { type: "adaptive" },
    // El pensamiento sale de este mismo techo, y el tokenizador nuevo produce
    // ~30% más tokens para el mismo texto. Con los 4096 de antes, una
    // respuesta larga se cortaba y el loop la parchaba mandando "Continúa."
    // Es un tope, no un objetivo: no sube el costo típico, evita el corte.
    max_tokens: args.maxTokens ?? 16000,
    system: [
      {
        type: "text",
        // The panel's section is appended to the same first block, so each mode
        // has one stable cached prefix of its own.
        text: panel ? `${ASSISTANT_SYSTEM_PROMPT}\n\n${PANEL_PROMPT_SECTION}` : ASSISTANT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: args.datasetSummary,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `Fecha y hora actuales: ${today}, ${time} (zona horaria ${tz}). Usa esto para resolver referencias relativas como "hoy", "ayer", "esta semana", "esta mañana" o "ahora".`,
      },
    ],
    tools: panel ? PANEL_MODE_TOOLS : (TOOL_DEFINITIONS as unknown as Anthropic.Tool[]),
    messages: withRollingCacheBreakpoint(args.messages),
  };
}
