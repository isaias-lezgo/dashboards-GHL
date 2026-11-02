// The conversation index: one row per conversation with activity inside a window,
// plus — per contact — the date of OUR last outbound message. Pure and
// client-safe: the route (app/api/conversation-index) builds the rows, the
// browser hook loads them on demand, the panel engine reads them.
//
// Ported from DASHBOARDS_VAEO/app/api/conversation-activity, where the rule was
// measured on a real sub-account: GHL has no "last outbound" date, but when a
// conversation ENDS outbound its lastMessageDate already is that date (~93% of
// conversations). Only threads ending inbound inside the window are opened.
//
// Conversations are deliberately NOT in the sync cache: they change all the
// time, and the cache is already large (spec 2026-11-02 §3.8).
import { isActivityMessage } from "./ghl-message-mapper";

export interface ConversationRow {
  id: string;
  contactId: string;
  /** Channel of the last message, in Spanish ("WhatsApp", "Correo"…). */
  channel: string;
  /** Advisor name, or null when unassigned. */
  assignedTo: string | null;
  lastMessageAt: string | null;
  lastDirection: "inbound" | "outbound" | null;
  unreadCount: number;
  createdAt: string | null;
  /** Our last outbound message in this conversation, when the window lets us know it. */
  lastOutboundAt: string | null;
  /** The last message is the contact's: the conversation waits for us. */
  waitingReply: boolean;
}

export interface ContactMessageDates {
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
}

/** What the browser holds: nothing yet, loading, ready, or failed — never a partial set read as complete. */
export type ConversationState =
  | { status: "idle" }
  | { status: "loading"; days: number; scanned: number; threads: number }
  | { status: "ready"; days: number; rows: ConversationRow[]; byContact: Map<string, ContactMessageDates>; truncated: boolean; threadErrors: number }
  | { status: "error"; days: number; message: string };

/**
 * GHL dates as ISO. The search endpoint returns lastMessageDate as epoch
 * MILLISECONDS (a number) while messages carry ISO strings, and the API types
 * call both strings. A numeric STRING read with `new Date()` is Invalid Date,
 * which downstream reads as "no message" and would accuse every contact of
 * being abandoned — so it is normalized here, at the border.
 */
export function toIso(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d{9,13}$/.test(v) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const CHANNELS: Record<string, string> = {
  TYPE_WHATSAPP: "WhatsApp",
  TYPE_SMS: "SMS",
  TYPE_EMAIL: "Correo",
  TYPE_FACEBOOK: "Facebook",
  TYPE_INSTAGRAM: "Instagram",
  TYPE_CALL: "Llamada",
  TYPE_PHONE: "Llamada",
  TYPE_GMB: "Google",
  TYPE_LIVE_CHAT: "Chat web",
  TYPE_WEBCHAT: "Chat web",
};

export function channelLabel(lastMessageType: string | undefined): string {
  return (lastMessageType && CHANNELS[lastMessageType]) || "Otro";
}

/** Open the thread only when it ends inbound (or direction is unknown) and its last message is inside the window. */
export function needsThread(lastDirection: string | null, lastMessageAt: string | null, cutoffMs: number): boolean {
  if (lastDirection === "outbound") return false;
  const t = lastMessageAt ? new Date(lastMessageAt).getTime() : NaN;
  return Number.isFinite(t) && t >= cutoffMs;
}

/** Our last outbound message in a thread. System events are not messages; automated ones are ours (VAEO's rule). */
export function lastOutboundFrom(messages: { direction: string; dateAdded: string; messageType?: string }[]): string | null {
  let best: string | null = null;
  for (const m of messages) {
    if (m.direction !== "outbound" || isActivityMessage(m)) continue;
    const iso = toIso(m.dateAdded);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

/** Per contact, the latest of each date across its conversations. */
export function contactMessageDates(rows: ConversationRow[]): Map<string, ContactMessageDates> {
  const out = new Map<string, ContactMessageDates>();
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const r of rows) {
    if (!r.contactId) continue;
    const prev = out.get(r.contactId) ?? { lastOutboundAt: null, lastMessageAt: null };
    out.set(r.contactId, {
      lastOutboundAt: later(prev.lastOutboundAt, r.lastOutboundAt),
      lastMessageAt: later(prev.lastMessageAt, r.lastMessageAt),
    });
  }
  return out;
}
