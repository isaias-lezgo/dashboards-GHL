import { getConversations, getMessages } from "@/lib/ghl-client"
import { ghlMessageToInternal } from "@/lib/ghl-message-mapper"
import type { Message } from "@/lib/types"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const contactIds = (searchParams.get("contactIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const locationId = process.env.GHL_LOCATION_ID ?? ""

  if (contactIds.length === 0) {
    return Response.json({ threads: [], locationId })
  }

  const threads: Array<{ contactId: string; messages: Message[] }> = []

  for (const contactId of contactIds) {
    try {
      const convResp = await getConversations({ contactId, limit: 1 })
      const conv = convResp.conversations[0]
      if (!conv) {
        threads.push({ contactId, messages: [] })
        continue
      }
      const msgResp = await getMessages(conv.id, { limit: 100 })
      const messages: Message[] = msgResp.messages.messages
        .map((m) => ghlMessageToInternal(m, contactId))
        .filter((m): m is Message => m !== null)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      threads.push({ contactId, messages })
    } catch (err) {
      console.warn(`[conversations] Failed to fetch threads for contact ${contactId}:`, err)
      threads.push({ contactId, messages: [] })
    }
  }

  return Response.json({ threads, locationId })
}
