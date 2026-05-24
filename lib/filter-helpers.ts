import type { Contact, Opportunity, Call, Message, Appointment } from "./types"
import type { Filters } from "@/components/dashboard/filter-bar"

export function filterOpportunities(
  opportunities: Opportunity[],
  contacts: Contact[],
  filters: Filters
): Opportunity[] {
  const needsContact = filters.tags.length > 0 || !!filters.search
  const contactById = needsContact
    ? new Map(contacts.map((c) => [c.id, c]))
    : null
  const searchQuery = filters.search ? filters.search.toLowerCase() : ""

  return opportunities.filter((opp) => {
    if (filters.pipelines.length > 0 && !filters.pipelines.includes(opp.pipelineName)) return false
    if (filters.members.length > 0 && opp.assignedTo && !filters.members.includes(opp.assignedTo)) return false

    const contact = contactById?.get(opp.contactId)

    if (filters.tags.length > 0) {
      const oppTags = opp.tags || []
      const contactTags = contact?.tags || []
      const hasTag =
        filters.tags.some((tag) => oppTags.includes(tag)) ||
        filters.tags.some((tag) => contactTags.includes(tag))
      if (!hasTag) return false
    }

    if (searchQuery) {
      const matchesOpp =
        opp.name.toLowerCase().includes(searchQuery) ||
        (opp.campaign?.toLowerCase().includes(searchQuery) ?? false)
      const matchesContact =
        contact?.name.toLowerCase().includes(searchQuery) ||
        contact?.email.toLowerCase().includes(searchQuery)
      if (!matchesOpp && !matchesContact) return false
    }
    return true
  })
}

export function filterContacts(contacts: Contact[], filters: Filters): Contact[] {
  return contacts.filter((c) => {
    if (filters.members.length > 0 && c.assignedTo && !filters.members.includes(c.assignedTo)) return false
    if (filters.tags.length > 0 && !filters.tags.some((tag) => c.tags.includes(tag))) return false
    if (filters.search) {
      const q = filters.search.toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false
    }
    return true
  })
}

export function filterCalls(calls: Call[], filters: Filters): Call[] {
  return calls.filter((c) => {
    if (filters.members.length > 0 && c.assignedTo && !filters.members.includes(c.assignedTo)) return false
    return true
  })
}

export function filterMessages(messages: Message[], filters: Filters): Message[] {
  return messages.filter((m) => {
    if (filters.members.length > 0 && m.assignedTo && !filters.members.includes(m.assignedTo)) return false
    return true
  })
}

export function filterAppointments(appointments: Appointment[], filters: Filters): Appointment[] {
  return appointments.filter((a) => {
    if (filters.members.length > 0 && a.assignedTo && !filters.members.includes(a.assignedTo)) return false
    return true
  })
}
