// Does the API still compile the panel copilot's strict tools? Run after
// touching any strict schema: pnpm check:strict-tools
//
// COSTS ~$0.05 (one request with the panel's tool list, 16 output tokens, no
// thinking). Needed because the compiled-grammar limit is undocumented: on
// 2026-10-30, 9 strict tools compiled and any 10th 400'd with "The compiled
// grammar is too large" — which fails EVERY copilot request, not one tool.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import Anthropic from "@anthropic-ai/sdk";
import { buildChatRequest } from "../lib/chat-request";

async function main(): Promise<void> {
  const body = buildChatRequest({ mode: "panel", datasetSummary: "-", messages: [{ role: "user", content: "hola" }], userTimezone: "America/Mexico_City" });
  const strict = (body.tools ?? []).filter((t) => (t as Anthropic.Tool).strict).map((t) => (t as Anthropic.Tool).name);
  try {
    await new Anthropic().messages.create({ ...body, max_tokens: 16, thinking: { type: "disabled" } });
    console.log(`✅ compila: ${strict.length} herramientas strict (${strict.join(", ")})`);
  } catch (err) {
    console.error(`❌ ${strict.length} herramientas strict: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
