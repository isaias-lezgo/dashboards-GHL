import { getConversations, getMessages } from "@/lib/ghl-client"
import type { Message } from "@/lib/types"

const MSG_TYPE_SOURCE: Record<number, Message["source"]> = {
  1: "sms",
  2: "email",
  3: "sms",
  5: "sms",
  6: "sms",
  7: "facebook",
  8: "instagram",
  9: "whatsapp",
  10: "google_chat",
  12: "email",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const contactIds = (searchParams.get("contactIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (contactIds.length === 0) {
    return Response.json({ threads: [] })
  }

  const threads: Array<{ contactId: string; messages: Message[] }> = []

  for (const contactId of contactIds) {
    try {
      const convResp = await getConversations({ contactId, limit: 20 })
      const conv = convResp.conversations[0]
      if (!conv) {
        threads.push({ contactId, messages: [] })
        continue
      }
      const msgResp = await getMessages(conv.id, { limit: 100 })
      const messages: Message[] = msgResp.messages.messages
        .filter((m) => Boolean(m.body))
        .map((m) => ({
          id: m.id,
          contactId,
          direction: m.direction,
          source: MSG_TYPE_SOURCE[m.type] ?? "sms",
          content: m.body ?? "",
          createdAt: m.dateAdded,
        }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      threads.push({ contactId, messages })
    } catch {
      threads.push({ contactId, messages: [] })
    }
  }

  return Response.json({ threads })
}
