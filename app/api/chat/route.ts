import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { buildChatRequest, type ChatMode } from "@/lib/chat-request";

// Server-side, one Anthropic turn per request. The client runs the agent
// loop: when we return tool_use blocks, the client executes them locally
// against the dashboard data and POSTs back with tool_result blocks.

interface ChatRequestBody {
  // The dataset summary built on the client and pinned for caching. We accept
  // it instead of regenerating server-side so the cache key stays stable
  // across turns in a single session.
  datasetSummary: string;
  // Full conversation history including any tool_use / tool_result blocks.
  messages: Anthropic.MessageParam[];
  // Optional: cap output tokens.
  maxTokens?: number;
  // IANA timezone from the user's browser. Falls back to America/Mexico_City.
  userTimezone?: string;
  // "panel" = the AI panel's copilot (panel tools + its prompt section).
  mode?: ChatMode;
}

export const runtime = "nodejs";

function translateAnthropicError(error: InstanceType<typeof Anthropic.APIError>): string {
  // The SDK parses the JSON body into error.error; fall back to error.message.
  const body = error.error as { error?: { type?: string; message?: string } } | null | undefined;
  const inner = body?.error?.message ?? error.message;

  if (/credit balance/i.test(inner))
    return "Saldo de crédito insuficiente. Recarga tu cuenta en console.anthropic.com para continuar.";
  if (/overloaded/i.test(inner))
    return "El servicio de IA está sobrecargado. Espera un momento e intenta de nuevo.";
  if (/invalid api key/i.test(inner))
    return "API key de Anthropic inválida. Revisa la configuración del servidor.";
  if (/context length|too many tokens|too large/i.test(inner))
    return "La conversación es demasiado larga. Reinicia el chat para continuar.";
  if (/not found/i.test(inner) && error.status === 404)
    return "Modelo o recurso no encontrado. Revisa la configuración.";
  return `Error del servicio de IA (código ${error.status}). Intenta de nuevo.`;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no está configurada en el servidor" },
      { status: 500 }
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "Faltan messages" }, { status: 400 });
  }
  if (typeof body.datasetSummary !== "string") {
    return NextResponse.json({ error: "Falta datasetSummary" }, { status: 400 });
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create(
      buildChatRequest({
        mode: body.mode === "panel" ? "panel" : "assistant",
        datasetSummary: body.datasetSummary,
        messages: body.messages,
        userTimezone: body.userTimezone ?? "America/Mexico_City",
        maxTokens: body.maxTokens,
      })
    );

    return NextResponse.json({
      stopReason: response.stop_reason,
      content: response.content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "API key de Anthropic inválida" }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Límite de tasa alcanzado, intenta de nuevo en un momento" },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[/api/chat] Anthropic error:", error.status, error.message);
      return NextResponse.json(
        { error: translateAnthropicError(error) },
        { status: 502 }
      );
    }
    console.error("[/api/chat] Unknown error:", error);
    return NextResponse.json(
      { error: "Error desconocido en el chat" },
      { status: 500 }
    );
  }
}
