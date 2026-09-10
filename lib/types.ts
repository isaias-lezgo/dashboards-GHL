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
  // computed: name→value resolved custom fields. Multi-option/checkbox fields
  // keep their array shape; single-value fields are stored as a plain string.
  customFieldsResolved?: Record<string, string | string[]>
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
  campaignName?: string // computed: utmCampaign alone (the ad campaign / "pauta" identity)
  adType?: string
  adId?: string
  attributionUrl?: string
  attributionMedium?: string
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
  lostReason?: string   // computed (resolveLostReason): native lostReasonId → the location's lost-reason catalog, else a "Motivo/Razón de Perdido" custom field
  customFields?: Array<{ id: string; key?: string; value?: string; fieldValue?: string; fieldValueString?: string; type?: string }>
  // computed: name→value resolved custom fields. Multi-option/checkbox fields
  // keep their array shape; single-value fields are stored as a plain string.
  customFieldsResolved?: Record<string, string | string[]>
  attributions?: Array<{ [key: string]: unknown }>

  // Embedded contact object from search endpoint
  contact?: { id: string; name?: string; email?: string; phone?: string; tags?: string[] }

  // Computed attribution (derived from attributions array)
  campaign?: string
  campaignName?: string // computed: utmCampaign alone (the ad campaign / "pauta" identity)
  adType?: string
  adId?: string
  attributionUrl?: string
  attributionMedium?: string  // computed: GHL-internal medium (whatsapp, instagram, calendar, manual, …) or utmSessionSource fallback
  originPlatform?: string     // computed: linked contact's "Origen de Lead" custom field (Instagram/Facebook/TikTok/…); fallback signal for platformLabel
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
  status: "pending" | "completed"
  dueDate?: string
  contactId: string
  contactName?: string
  opportunityId?: string
  assignedTo?: string
  assignedToName?: string
  createdAt?: string
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
  location?: string
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

// ---------------------------------------------------------------------------
// Meta (Facebook/Instagram) ad spend — GHL Ad Manager's /ad-publishing reporting
// ---------------------------------------------------------------------------
//
// The CRM half of the dashboard knows how many leads arrived; this is the only
// place that knows what they cost. Joining the two is the whole point: without
// `spend` there is no CPL, no cost per cita, no cost per venta.
//
// Availability is per sub-account and mostly OUT of our hands — it needs the
// client to have linked their Meta ad account inside GHL. So `status` is a
// first-class field, not an error: "not connected" is a normal, expected state
// that the UI explains rather than a failure that blanks the dashboard.

export type AdsStatus =
  // Ad account linked and reporting returned.
  | "connected"
  // No Facebook integration, or one with no ad account attached. The client
  // has to link it in GHL — nothing we can fix from here.
  | "disconnected"
  // Integration record exists but GHL could not get a Meta access token
  // (revoked or expired). The client has to re-authorize.
  | "expired"
  // The token lacks the adPublishing.readonly scope. Fixable by us: edit the
  // Private Integration in GHL and tick the scope.
  | "unauthorized"
  // Anything else — a GHL/Meta outage, a shape we didn't expect.
  | "error"

/** One day of account-wide Meta insights. Amounts are in the ad account's currency. */
export interface AdDay {
  /** YYYY-MM-DD, the day Meta attributes the numbers to. */
  date: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  /**
   * Meta's own lead count for the day (its `conversions`, falling back to
   * `results.lead`). Kept as a CROSS-CHECK only — the headline CPL is computed
   * against the CRM's own leads, because Meta's action types overlap and which
   * one means "lead" depends on the campaign objective (a WhatsApp campaign's
   * real lead is a conversation started, not a `lead` action).
   */
  metaLeads: number
  /** `onsiteConversion.messagingConversationStarted_7d` — WhatsApp/DM campaigns. */
  conversations: number
}

/**
 * One Meta AD over a window. The ad — not the campaign — is the grain that
 * matters, because it is the only level where Meta's ids meet the CRM's: the
 * Pauta custom object stores the ad id in `id_de_pauta`, and an opportunity's
 * `adId` is the same `utmAdId`. Campaign rows are rolled up from these.
 */
export interface AdStat {
  /** Meta ad id. Joins to Pauta.id_de_pauta and Opportunity.adId. */
  adId: string
  /** Ad (creative) name as Meta holds it. NOT the same as Pauta.nombrePauta. */
  adName: string
  campaignId: string
  campaignName: string
  /** ACTIVE / PAUSED / … as Meta reports it, inherited from the campaign. */
  campaignStatus: string
  spend: number
  impressions: number
  clicks: number
}

/**
 * One campaign's metrics over a window, rolled up from its ads.
 *
 * `leads` is OUR OWN join (Pauta records matched to the campaign's ads by ad id),
 * not GHL's CDP attribution. The CDP fields this type used to carry — sales,
 * revenue, its own lead count — were 0 on every campaign of every account we
 * checked, matching GHL's own Meta Ads report, so they were removed rather than
 * left as a row of zeros inviting someone to render them again.
 */
export interface AdCampaignStat {
  /** Meta campaign id. */
  id: string
  name: string
  /** ACTIVE / PAUSED / … as Meta reports it. */
  status: string
  spend: number
  impressions: number
  clicks: number
  /** Pautas whose ad belongs to this campaign. Partial by nature — see AdJoin. */
  leads: number
}

/**
 * The account-level daily series, shipped with the main dashboard payload.
 *
 * Daily rows rather than a pre-aggregated total, deliberately: the dashboard
 * filters everything client-side by date, so spend has to be re-summable over
 * whatever window the user picks. A single total for a fixed window could not
 * be, and would silently disagree with every other number on the page.
 */
export interface AdsReport {
  status: AdsStatus
  /** Spanish, user-facing, shown in the banner when status !== "connected". */
  message?: string
  adAccountId?: string
  /** Meta ad account name, for the "which account is this" line. */
  adAccountName?: string
  /**
   * ISO 4217 code of the ad account. Every amount below is in THIS currency —
   * Meta reports in the account's own, and an ad account in MXN next to a
   * dashboard that assumes USD is off by a factor of ~18. Undefined when the
   * lookup failed; the UI then shows amounts without a currency symbol rather
   * than guessing one.
   */
  currency?: string
  /** Inclusive bounds of `daily` (YYYY-MM-DD). Absent when nothing was fetched. */
  from?: string
  to?: string
  daily: AdDay[]
}

// The whole dashboard payload, exactly as app/api/dashboard/route.ts ships it to
// the browser and as lib/sync-store.ts caches it. Canonical here rather than in
// the hook because the server now owns it: lib/sync.ts builds it, the cache
// round-trips it, and hooks/use-dashboard-data.ts re-exports this same shape so
// the two can never drift.
export interface DashboardPayload {
  locationName: string
  contacts: Contact[]
  opportunities: Opportunity[]
  calls: Call[]
  tasks: Task[]
  appointments: Appointment[]
  pipelines: Pipeline[]
  members: string[]
  tags: string[]
  campaigns: string[]
  sources: string[]
  pautas: Pauta[]
  locationId: string
  /**
   * Optional so an old cached payload written before this field existed still
   * deserializes — the cache is disposable but not versioned, and a `readSync`
   * hit must never crash the page.
   */
  ads?: AdsReport
  meta: {
    totalContacts: number
    totalOpportunities: number
    fetchedAt: string
  }
}
