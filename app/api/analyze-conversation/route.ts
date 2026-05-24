import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

interface ConversationMessage {
  direction: "inbound" | "outbound";
  source: string;
  content: string;
  createdAt: string;
}

interface ConversationItem {
  contact: {
    name: string;
    email?: string;
    phone?: string;
    tags?: string[];
  };
  messages: ConversationMessage[];
}

interface AnalyzeRequestBody {
  contact?: ConversationItem["contact"];
  messages?: ConversationMessage[];
  conversations?: ConversationItem[];
}

const MAX_BATCH = 20;

const SYSTEM_PROMPT = `Eres un analista de ventas experto en GoHighLevel (GHL) y CRM. Tu tarea es analizar una conversación entre un asesor de ventas y un contacto (lead) y generar un reporte conciso, accionable y en español.

Tu reporte debe seguir EXACTAMENTE este formato Markdown:

## Resumen
Una o dos oraciones describiendo el contexto y estado actual de la conversación.

## Intención del contacto
Qué busca el contacto. Sé específico — qué servicio/producto le interesa, qué dudas tiene, qué urgencia muestra.

## Calidad del lead
Clasifica como **🔥 Hot**, **☀️ Warm**, o **❄️ Cold** y justifica en una oración. Considera: intención de compra, presupuesto mencionado, urgencia, nivel de interacción.

## Temas clave
- Lista 3-5 temas importantes (en bullets cortos)
- Incluye objeciones del contacto si las hay
- Incluye compromisos hechos por cualquiera de las partes

## Próximos pasos sugeridos
1. Acción concreta #1 (qué hacer, cuándo, cómo)
2. Acción concreta #2
3. Acción concreta #3

## Señales de alerta
Solo incluye esta sección si detectas: ghosting (sin respuesta del contacto), objeciones serias sin resolver, riesgo de pérdida del lead, asesor respondiendo lento, o información incorrecta dada por el asesor. Si no hay alertas, omite esta sección completamente.

Reglas:
- Sé directo y conciso. Nada de relleno corporativo.
- Si la conversación es muy corta o vacía, dilo y sugiere cómo iniciar el contacto.
- Si detectas que el contacto está listo para cerrar, dilo claramente.
- Usa el nombre del contacto cuando hagas referencia a él.`;

const BATCH_SYSTEM_PROMPT = `Eres un analista de ventas experto en GoHighLevel (GHL) y CRM. Recibirás varias conversaciones (cada una entre un asesor y un contacto distinto) y debes producir un reporte ejecutivo agregado en español.

Tu reporte debe seguir EXACTAMENTE este formato Markdown:

## Resumen ejecutivo
2-3 oraciones describiendo el panorama general del lote: cuántas conversaciones, estado general, salud del pipeline.

## Distribución de calidad
- **🔥 Hot:** N contactos — nombres separados por coma
- **☀️ Warm:** N contactos — nombres separados por coma
- **❄️ Cold:** N contactos — nombres separados por coma

## Temas recurrentes
- 3-5 bullets sobre temas que aparecen en varias conversaciones (productos, dudas, objeciones repetidas).

## Leads prioritarios
Los 3-5 contactos más urgentes para dar seguimiento HOY. Para cada uno: nombre, una línea de por qué es prioritario, y la acción concreta a tomar.

## Patrones de objeciones
- Objeciones repetidas y cómo se están manejando (bien/mal).

## Acciones recomendadas
1. Acción agregada #1 aplicable al equipo o al pipeline
2. Acción agregada #2
3. Acción agregada #3

## Señales de alerta
Solo si detectas problemas sistémicos: muchos contactos sin respuesta del asesor, objeciones sin resolver, leads enfriándose, información incorrecta del asesor. Omite si todo está bien.

Reglas:
- Sé directo. Nada de relleno.
- Identifica patrones entre conversaciones, no las analices una por una.
- Cuando menciones a un contacto, usa su nombre.`;

function formatSingleConversation(item: ConversationItem, prefix = ""): string {
  const { contact, messages } = item;

  const header = [
    `${prefix}Contacto: ${contact.name}`,
    contact.email ? `Email: ${contact.email}` : null,
    contact.phone ? `Teléfono: ${contact.phone}` : null,
    contact.tags && contact.tags.length > 0
      ? `Tags: ${contact.tags.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (messages.length === 0) {
    return `${header}\n\n(Sin mensajes en la conversación)`;
  }

  const body = messages
    .map((m) => {
      const date = new Date(m.createdAt).toLocaleString("es-MX");
      const speaker = m.direction === "inbound" ? contact.name : "Asesor";
      return `[${date}] (${m.source}) ${speaker}: ${m.content}`;
    })
    .join("\n");

  return `${header}\n\n${body}`;
}

function formatBatch(conversations: ConversationItem[]): string {
  return conversations
    .map((c, i) => `=== Conversación ${i + 1} de ${conversations.length} ===\n${formatSingleConversation(c)}`)
    .join("\n\n");
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no está configurada en el servidor" },
      { status: 500 }
    );
  }

  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de petición inválido" },
      { status: 400 }
    );
  }

  const batch = Array.isArray(body.conversations) ? body.conversations : null;

  let systemPrompt: string;
  let conversationText: string;
  let userIntro: string;

  if (batch) {
    if (batch.length === 0) {
      return NextResponse.json(
        { error: "El arreglo 'conversations' está vacío" },
        { status: 400 }
      );
    }
    if (batch.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Máximo ${MAX_BATCH} conversaciones por análisis` },
        { status: 400 }
      );
    }
    const invalid = batch.find(
      (c) => !c?.contact?.name || !Array.isArray(c.messages)
    );
    if (invalid) {
      return NextResponse.json(
        { error: "Cada conversación necesita 'contact.name' y 'messages'" },
        { status: 400 }
      );
    }
    systemPrompt = BATCH_SYSTEM_PROMPT;
    conversationText = formatBatch(batch);
    userIntro = `Analiza el siguiente lote de ${batch.length} conversaciones de un CRM y produce el reporte agregado:`;
  } else {
    if (!body.contact?.name || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "Falta 'contact.name' o 'messages'" },
        { status: 400 }
      );
    }
    systemPrompt = SYSTEM_PROMPT;
    conversationText = formatSingleConversation({
      contact: body.contact,
      messages: body.messages,
    });
    userIntro = "Analiza la siguiente conversación de un CRM:";
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `${userIntro}\n\n${conversationText}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    return NextResponse.json({
      analysis: textBlock?.text ?? "No se pudo generar el análisis.",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "API key de Anthropic inválida" },
        { status: 500 }
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Límite de tasa alcanzado, intenta de nuevo en un momento" },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[Anthropic API error]", error.status, error.message);
      return NextResponse.json(
        { error: `Error de Anthropic API: ${error.message}` },
        { status: 502 }
      );
    }
    console.error("[Analyze conversation error]", error);
    return NextResponse.json(
      { error: "Error desconocido al generar el análisis" },
      { status: 500 }
    );
  }
}
