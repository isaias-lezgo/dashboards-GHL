import { getConversations, getMessages } from "@/lib/ghl-client"
import { ghlMessageToInternal } from "@/lib/ghl-message-mapper"
import type { Message } from "@/lib/types"

const BATCH_SIZE = 10

async function fetchThread(
  contactId: string,
  messageLimit: number
): Promise<{ contactId: string; messages: Message[] }> {
  try {
    const convResp = await getConversations({ contactId, limit: 1 })
    const conv = convResp.conversations[0]
    if (!conv) return { contactId, messages: [] }
    const msgResp = await getMessages(conv.id, { limit: messageLimit })
    const messages: Message[] = msgResp.messages.messages
      .map((m) => ghlMessageToInternal(m, contactId))
      .filter((m): m is Message => m !== null)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    return { contactId, messages }
  } catch (err) {
    console.warn(`[conversations] Failed to fetch thread for contact ${contactId}:`, err)
    return { contactId, messages: [] }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const contactIds = (searchParams.get("contactIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const rawLimit = parseInt(searchParams.get("messageLimit") ?? "100", 10)
  const messageLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100

  const locationId = process.env.GHL_LOCATION_ID ?? ""

  if (contactIds.length === 0) {
    return Response.json({ threads: [], locationId })
  }

  const threads: Array<{ contactId: string; messages: Message[] }> = []

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batch = contactIds.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map((id) => fetchThread(id, messageLimit)))
    threads.push(...results)
  }

  return Response.json({ threads, locationId })
}
