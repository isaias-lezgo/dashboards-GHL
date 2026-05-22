export interface Contact {
  id: string
  name: string
  email: string
  phone: string
  tags: string[]
  source?: string
  campaign?: string
  adType?: string
  assignedTo?: string
  createdAt: string
}

export interface Opportunity {
  id: string
  name: string
  pipelineId: string
  pipelineName: string
  stage: string
  status: "open" | "won" | "lost" | "abandoned"
  lostReason?: string
  value: number
  createdAt: string
  updatedAt: string
  contactId: string
  source?: string
  campaign?: string
  adType?: string
  assignedTo?: string
  tags?: string[]
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

// Default values for mock data / fallbacks
export const DEFAULT_LEAD_SOURCES = ["META", "GOOGLE", "MANUAL", "REFERRAL", "TIKTOK", "EMAIL"] as const
export const DEFAULT_AD_TYPES = ["Form", "DM", "Manual"] as const
export const DEFAULT_MESSAGE_SOURCES = ["sms", "email", "facebook", "instagram", "whatsapp", "google_chat"] as const
export const DEFAULT_CAMPAIGNS = [
  "Spring Launch 2026",
  "Retargeting Q1",
  "Brand Awareness",
  "Product Demo Ads",
  "Referral Program",
] as const
export const DEFAULT_PIPELINES = ["Sales Pipeline", "Enterprise Pipeline"] as const
export const DEFAULT_MEMBERS = ["Rep A", "Rep B", "Rep C"] as const
export const DEFAULT_TAGS = ["Hot Lead", "Warm Lead", "Cold Lead", "Enterprise", "Mid-Market", "SMB", "Decision Maker", "Referral"] as const
export const DEFAULT_LOST_REASONS = ["Price too high", "Went with competitor", "No budget", "Unresponsive", "Bad timing"] as const

export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
}
