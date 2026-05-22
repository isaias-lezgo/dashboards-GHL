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

export interface Message {
  id: string
  contactId: string
  assignedTo?: string
  direction: "inbound" | "outbound"
  source: "sms" | "email" | "facebook" | "instagram" | "whatsapp" | "google_chat"
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
