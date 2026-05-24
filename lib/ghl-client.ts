// GoHighLevel API Client
// Uses Private Integration Token authentication
// API Docs: https://marketplace.gohighlevel.com/docs

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GHLRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
  useSnakeCaseLocationId?: boolean;
  version?: string;
  noQueryLocationId?: boolean;
}

async function ghlFetch<T>(
  endpoint: string,
  options: GHLRequestOptions = {}
): Promise<T> {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token) {
    throw new Error("GHL_API_TOKEN environment variable is not set");
  }
  if (!locationId) {
    throw new Error("GHL_LOCATION_ID environment variable is not set");
  }

  // Replace :locationId placeholder in endpoint
  const resolvedEndpoint = endpoint.replace(":locationId", locationId);
  const url = new URL(`${GHL_BASE_URL}${resolvedEndpoint}`);

  // Add query params
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    }
  }

  // Add locationId to query params for endpoints that need it
  const locationKey = options.useSnakeCaseLocationId ? "location_id" : "locationId";
  if (!options.noQueryLocationId && !resolvedEndpoint.includes(locationId) && !url.searchParams.has("locationId") && !url.searchParams.has("location_id")) {
    url.searchParams.append(locationKey, locationId);
  }

  // For POST requests, also include locationId in body
  let body = options.body;
  if (options.method === "POST" && body && !body.locationId) {
    body = { ...body, locationId };
  }

  const requestInit: RequestInit = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: options.version ?? GHL_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  // Retry up to 4 times on 429 with exponential backoff (1s, 2s, 4s, 8s)
  for (let attempt = 0; attempt <= 4; attempt++) {
    const response = await fetch(url.toString(), requestInit);

    if (response.status === 429) {
      if (attempt === 4) {
        throw new Error("GHL API Error: 429 - Too Many Requests (retries exhausted)");
      }
      const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
      console.warn(`[GHL] Rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/4)`);
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL API Error] ${response.status}: ${errorText}`);
      throw new Error(`GHL API Error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  throw new Error("GHL API Error: unexpected retry loop exit");
}

// ============ TAGS ============

export interface GHLTag {
  id: string;
  name: string;
  locationId: string;
}

export interface GHLTagsResponse {
  tags: GHLTag[];
}

export async function getTags(): Promise<GHLTagsResponse> {
  return ghlFetch<GHLTagsResponse>("/locations/:locationId/tags");
}

// ============ CONTACTS ============

export interface GHLContact {
  id: string;
  locationId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  dateAdded: string;
  dateUpdated?: string;
  tags?: string[];
  source?: string;
  assignedTo?: string;
  customFields?: Array<{ id: string; value: string }>;
  // List endpoint returns attributions array; single-contact endpoint returns attributionSource
  attributions?: Array<{
    isFirst?: boolean;
    isLast?: boolean;
    utmCampaign?: string;
    utmContent?: string;
    utmMedium?: string;
    utmSource?: string;
    utmSessionSource?: string;
    adSource?: string;
    medium?: string;
    mediumId?: string;
    utmAdId?: string;
    utmCampaignId?: string;
    [key: string]: unknown;
  }>;
  attributionSource?: {
    campaign?: string;
    utmCampaign?: string;
    content?: string;
    utmContent?: string;
    medium?: string;
    utmMedium?: string;
    source?: string;
    utmSource?: string;
    sessionSource?: string;
    [key: string]: string | undefined;
  };
}

export interface GHLContactsResponse {
  contacts: GHLContact[];
  meta?: {
    total?: number;
    currentPage?: number;
    nextPage?: number;
    prevPage?: number;
    startAfterId?: string;
    startAfter?: number;
  };
}

// Simple contacts list with cursor pagination.
// GHL needs BOTH startAfterId and startAfter (a dateAdded epoch ms) together —
// passing only the id makes the cursor non-unique and returns overlapping pages.
export async function getContacts(params?: {
  limit?: number;
  startAfterId?: string;
  startAfter?: number;
  query?: string;
}): Promise<GHLContactsResponse> {
  return ghlFetch<GHLContactsResponse>("/contacts/", {
    params: {
      limit: params?.limit || 100,
      startAfterId: params?.startAfterId,
      startAfter: params?.startAfter,
      query: params?.query,
    },
  });
}

// ============ OPPORTUNITIES ============

export interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineId: string;
  pipelineStageId: string;
  status: "open" | "won" | "lost" | "abandoned";
  source?: string;
  contact: {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
  };
  assignedTo?: string;
  dateAdded: string;
  dateUpdated?: string;
  lastStatusChangeAt?: string;
  lostReasonId?: string;
  customFields?: Array<{ id: string; key?: string; value?: string; fieldValueString?: string; type?: string }>;
  attributions?: Array<{
    isFirst?: boolean;
    isLast?: boolean;
    utmCampaign?: string;
    utmContent?: string;
    utmMedium?: string;
    utmSource?: string;
    utmSessionSource?: string;
    adSource?: string;
    medium?: string;
    [key: string]: unknown;
  }>;
}

export interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta: {
    total: number;
    currentPage: number;
    nextPage?: number | null;
    prevPage?: number | null;
  };
}

export interface GHLOpportunityDetail extends GHLOpportunity {
  calendarEvents: GHLCalendarEvent[];
}

export interface GHLOpportunityDetailResponse {
  opportunity: GHLOpportunityDetail;
}

export async function getOpportunityById(id: string): Promise<GHLOpportunityDetail> {
  const resp = await ghlFetch<GHLOpportunityDetailResponse>(
    `/opportunities/${id}`,
    { noQueryLocationId: true }
  );
  return resp.opportunity;
}

export async function getOpportunities(params?: {
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  assignedTo?: string;
  limit?: number;
  page?: number;
}): Promise<GHLOpportunitiesResponse> {
  // Opportunities search endpoint uses location_id (snake_case)
  return ghlFetch<GHLOpportunitiesResponse>("/opportunities/search", {
    useSnakeCaseLocationId: true,
    params: {
      pipelineId: params?.pipelineId,
      pipelineStageId: params?.pipelineStageId,
      status: params?.status,
      assigned_to: params?.assignedTo,
      limit: params?.limit || 100,
      page: params?.page || 1,
    },
  });
}

// ============ PIPELINES ============

export interface GHLPipelineStage {
  id: string;
  name: string;
  position: number;
}

export interface GHLPipeline {
  id: string;
  name: string;
  stages: GHLPipelineStage[];
  locationId: string;
}

export interface GHLPipelinesResponse {
  pipelines: GHLPipeline[];
}

export async function getPipelines(): Promise<GHLPipelinesResponse> {
  return ghlFetch<GHLPipelinesResponse>("/opportunities/pipelines");
}

// ============ CONVERSATIONS / MESSAGES ============

export interface GHLConversation {
  id: string;
  contactId: string;
  locationId: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  lastMessageType?: string;
  type: string;
  unreadCount: number;
  dateAdded: string;
  dateUpdated?: string;
  assignedTo?: string;
}

export interface GHLConversationsResponse {
  conversations: GHLConversation[];
  total?: number;
}

export async function getConversations(params?: {
  limit?: number;
  type?: string;
  assignedTo?: string;
  contactId?: string;
}): Promise<GHLConversationsResponse> {
  return ghlFetch<GHLConversationsResponse>("/conversations/search", {
    params: {
      limit: params?.limit || 100,
      type: params?.type,
      assignedTo: params?.assignedTo,
      contactId: params?.contactId,
    },
  });
}

export interface GHLMessage {
  id: string;
  conversationId: string;
  contactId: string;
  locationId: string;
  body?: string;
  // Numeric type — opaque, prefer messageType for routing
  type: number;
  // String enum: TYPE_SMS, TYPE_EMAIL, TYPE_WHATSAPP, TYPE_FACEBOOK,
  // TYPE_INSTAGRAM, TYPE_ACTIVITY_OPPORTUNITY, … — see GHL-API-Schemas.md
  messageType?: string;
  direction: "inbound" | "outbound";
  status: string;
  dateAdded: string;
  attachments?: string[];
  source?: string;
}

export interface GHLMessagesResponse {
  messages: {
    messages: GHLMessage[];
    lastMessageId?: string;
    nextPage?: boolean;
  };
}

export async function getMessages(conversationId: string, params?: {
  limit?: number;
  lastMessageId?: string;
}): Promise<GHLMessagesResponse> {
  return ghlFetch<GHLMessagesResponse>(`/conversations/${conversationId}/messages`, {
    params: {
      limit: params?.limit || 50,
      lastMessageId: params?.lastMessageId,
    },
  });
}

// ============ USERS / TEAM MEMBERS ============

export interface GHLUser {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  role: string;
}

export interface GHLUsersResponse {
  users: GHLUser[];
}

export async function getUsers(): Promise<GHLUsersResponse> {
  return ghlFetch<GHLUsersResponse>("/users/");
}

// ============ CALENDARS / APPOINTMENTS ============

export interface GHLCalendarEvent {
  id: string;
  title?: string;
  calendarId: string;
  contactId: string;
  status: string;
  startTime: string;
  endTime: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  notes?: string;
  dateAdded: string;
}

export interface GHLCalendarEventsResponse {
  events: GHLCalendarEvent[];
}

export async function getCalendarEvents(params?: {
  calendarId?: string;
  userId?: string;
  startTime?: string;
  endTime?: string;
}): Promise<GHLCalendarEventsResponse> {
  return ghlFetch<GHLCalendarEventsResponse>("/calendars/events", {
    params: {
      calendarId: params?.calendarId,
      userId: params?.userId,
      startTime: params?.startTime,
      endTime: params?.endTime,
    },
  });
}

export interface GHLCalendar {
  id: string;
  locationId: string;
  name: string;
  isActive?: boolean;
}

export interface GHLCalendarsResponse {
  calendars: GHLCalendar[];
}

export async function getCalendars(): Promise<GHLCalendarsResponse> {
  return ghlFetch<GHLCalendarsResponse>("/calendars/");
}

// ============ TASKS ============

export interface GHLTask {
  id: string;
  title: string;
  body?: string;
  contactId: string;
  assignedTo?: string;
  dueDate?: string;
  status: "pending" | "completed";
  dateAdded: string;
}

export interface GHLTasksResponse {
  tasks: GHLTask[];
}

export async function getContactTasks(contactId: string): Promise<GHLTasksResponse> {
  return ghlFetch<GHLTasksResponse>(`/contacts/${contactId}/tasks`);
}

// ============ CUSTOM VALUES / LOST REASONS ============

export interface GHLCustomValue {
  id: string;
  name: string;
  fieldKey: string;
}

export async function getLostReasons(): Promise<{ customValues: GHLCustomValue[] }> {
  return ghlFetch<{ customValues: GHLCustomValue[] }>("/locations/:locationId/customValues");
}

// ============ CUSTOM OBJECTS ============

export interface GHLCustomObjectField {
  id: string;
  fieldKey: string;
  name: string;
  dataType: string;
}

export interface GHLCustomObjectSchema {
  id: string;
  key: string;
  labels: { singular: string; plural: string };
  fields?: GHLCustomObjectField[];
}

export interface GHLCustomObjectsResponse {
  objects: GHLCustomObjectSchema[];
}

export interface GHLCustomObjectRecord {
  id: string;
  properties: Record<string, string | string[] | null>;
  createdAt?: string;
  updatedAt?: string;
  associations?: Record<string, unknown>;
}

export interface GHLCustomObjectRecordsResponse {
  records: GHLCustomObjectRecord[];
  total?: number;
}

export async function getCustomObjects(): Promise<GHLCustomObjectsResponse> {
  return ghlFetch<GHLCustomObjectsResponse>("/objects/", {
    version: "2023-02-21",
  });
}

export async function getCustomObjectSchema(objectKey: string): Promise<{ object: GHLCustomObjectSchema & { fields: GHLCustomObjectField[] } }> {
  return ghlFetch(`/objects/${objectKey}`, { version: "2023-02-21" });
}

export async function getAllCustomObjectRecords(
  objectKey: string,
  onProgress?: (count: number) => void
): Promise<GHLCustomObjectRecord[]> {
  const allRecords: GHLCustomObjectRecord[] = [];
  let page = 1;
  const pageLimit = 100;

  while (true) {
    const response = await ghlFetch<GHLCustomObjectRecordsResponse>(
      `/objects/${objectKey}/records/search`,
      {
        method: "POST",
        version: "2023-02-21",
        noQueryLocationId: true,
        body: { page, pageLimit },
      }
    );

    allRecords.push(...response.records);
    onProgress?.(allRecords.length);

    if (allRecords.length >= (response.total ?? 0) || response.records.length < pageLimit) break;

    page++;
    await sleep(200);
  }

  return allRecords;
}

// ============ HELPER FUNCTIONS ============

// Helper to fetch all pages of opportunities
export async function getAllOpportunities(
  onProgress?: (count: number) => void
): Promise<GHLOpportunity[]> {
  const allOpportunities: GHLOpportunity[] = [];
  let page = 1;
  let total: number | undefined;

  while (true) {
    const response = await getOpportunities({ page, limit: 100 });
    if (total === undefined) total = response.meta.total;

    allOpportunities.push(...response.opportunities);
    onProgress?.(allOpportunities.length);

    // Stop once we have all records or the API says there's no next page
    if (allOpportunities.length >= (total ?? 0) || !response.meta.nextPage) break;

    page = response.meta.nextPage!;
    await sleep(200);
  }

  return allOpportunities;
}

// Helper to fetch all contacts with cursor pagination
export async function getAllContacts(
  onProgress?: (count: number) => void
): Promise<GHLContact[]> {
  const allContacts: GHLContact[] = [];
  const seenIds = new Set<string>();
  let startAfterId: string | undefined;
  let startAfter: number | undefined;
  let total: number | undefined;

  while (true) {
    const response = await getContacts({ limit: 100, startAfterId, startAfter });
    if (total === undefined && response.meta?.total !== undefined) total = response.meta.total;

    // Dedupe by id — GHL's cursor pagination occasionally returns overlapping
    // pages and we'd otherwise inflate the count.
    let pageNew = 0;
    for (const c of response.contacts) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      allContacts.push(c);
      pageNew++;
    }
    onProgress?.(allContacts.length);

    // Stop once we have all records or got a partial page.
    if (
      (total !== undefined && allContacts.length >= total) ||
      response.contacts.length < 100
    ) break;

    // If a whole page is duplicates, the cursor is stuck — bail out.
    if (pageNew === 0) break;

    // Advance cursor — use both fields together (startAfter is a dateAdded
    // epoch ms; without it the cursor isn't unique).
    const last = response.contacts[response.contacts.length - 1];
    startAfterId = response.meta?.startAfterId ?? last.id;
    startAfter = response.meta?.startAfter ?? new Date(last.dateAdded).getTime();
    await sleep(200);
  }

  return allContacts;
}
