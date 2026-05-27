// Internal types — full GHL API shape + computed/resolved additions.
// Fields marked "computed" are added by the dashboard API route (not from GHL directly).

export interface Contact {
  // Always present (normalized by transform)
  id: string
  name: string
  email: string
  phone: string
  tags: string[]
  dateAdded: string
  createdAt: string   // computed: alias for dateAdded

  // GHL Contact fields
  locationId?: string
  firstName?: string
  lastName?: string
  emailLowerCase?: string
  timezone?: string
  companyName?: string
  dnd?: boolean
  dndSettings?: Record<string, unknown>
  type?: string
  address1?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
  website?: string
  dateOfBirth?: string
  dateUpdated?: string
  lastActivity?: string
  customFields?: Array<{ id: string; value: string }>
  customFieldsResolved?: Record<string, string>  // computed: id→name resolved custom fields
  businessId?: string
  visitorId?: string
  keyword?: string
  firstNameLowerCase?: string
  fullNameLowerCase?: string
  lastNameLowerCase?: string
  attachments?: unknown[]
  ssn?: string
  assignedTo?: string   // GHL field; resolved to user name by transform
  attributionSource?: { [key: string]: string | undefined }
  lastAttributionSource?: { [key: string]: string | undefined }
  attributions?: Array<{ [key: string]: unknown }>

  // Computed attribution (derived from attributions array)
  source?: string
  campaign?: string
  adType?: string
  adId?: string
  attributionUrl?: string
}

export interface Opportunity {
  // Always present
  id: string
  name: string
  pipelineId: string
  pipelineStageId: string
  status: "open" | "won" | "lost" | "abandoned"
  createdAt: string

  // Computed/resolved (always set by transform)
  contactId: string     // computed: from embedded contact.id or direct contactId
  value: number         // computed: monetaryValue ?? 0
  stage: string         // computed: resolved from pipelineStageId via pipeline lookup
  pipelineName: string  // computed: resolved from pipelineId via pipeline lookup

  // GHL Opportunity fields
  locationId?: string
  userId?: string
  assignedTo?: string   // GHL field; resolved to user name by transform
  statusId?: string
  monetaryValue?: number
  currency?: string
  probability?: number
  closedAt?: string
  updatedAt?: string
  source?: string
  campaignId?: string
  funnelId?: string
  workflowId?: string
  tags?: string[]       // opportunity's own tags (not from contact)
  priority?: string
  notes?: string
  archived?: boolean
  origin?: string
  lastActivity?: string
  lostReasonId?: string
  lostReason?: string   // computed: resolved from lostReasonId via custom values lookup
  customFields?: Array<{ id: string; key?: string; value?: string; fieldValue?: string; fieldValueString?: string; type?: string }>
  customFieldsResolved?: Record<string, string>  // computed: id→name resolved custom fields
  attributions?: Array<{ [key: string]: unknown }>

  // Embedded contact object from search endpoint
  contact?: { id: string; name?: string; email?: string; phone?: string; tags?: string[] }

  // Computed attribution (derived from attributions array)
  campaign?: string
  adType?: string
  adId?: string
  attributionUrl?: string
}

export interface Call {
  id: string
  contactId: string
  assignedTo?: string
  direction: "inbound" | "outbound"
  status: "completed" | "missed" | "no-answer"
  durationSeconds: number
  createdAt: string
}

export interface Task {
  id: string
  title: string
  body?: string
  type: "call" | "email" | "followup" | "other"
  status: "pending" | "completed"
  dueDate?: string
  contactId: string
  opportunityId?: string
  assignedTo?: string
}

export interface Appointment {
  id: string
  contactId: string
  assignedTo?: string
  title?: string
  startTime: string
  endTime: string
  status: string
  notes?: string
}

// Channels we can render with an icon/label in the thread.
// Anything else collapses to "other".
export type MessageChannel =
  | "sms"
  | "email"
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "google_chat"
  | "call"
  | "webchat"
  | "live_chat"
  | "tiktok"
  | "review"
  | "form_submission"
  | "internal_comment"
  | "other"

// System / activity event kinds — rendered as a centered timeline chip,
// not a chat bubble.
export type ActivityKind =
  | "opportunity"
  | "appointment"
  | "invoice"
  | "payment"
  | "contact"
  | "employee_action"
  | "other"

export interface Message {
  id: string
  contactId: string
  conversationId?: string
  assignedTo?: string
  direction: "inbound" | "outbound"
  // Omitted = real message. "activity" = system event (rendered as a chip).
  kind?: "message" | "activity"
  // For messages: the channel. For activities: "system".
  source: MessageChannel | "system"
  // Only set on activities — drives the chip label.
  activityKind?: ActivityKind
  content?: string
  createdAt: string
}

export interface Pipeline {
  id: string
  name: string
  stages: string[]
}


export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
  contactId?: string
  properties?: Record<string, string>
}
