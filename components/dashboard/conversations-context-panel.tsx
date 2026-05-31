"use client";

import { ExternalLink, Clock, ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PanelContact {
  id: string;
  name: string;
  source?: string;
  assignedTo?: string;
  tags?: string[];
  lastActivity?: string;
}

export interface SummaryGroup {
  key: string;
  count: number;
  sum?: number;
}

export interface PanelTask {
  id: string;
  title: string;
  status: "pending" | "completed";
  dueDate?: string;
}

export interface PanelNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded: string;
}

export interface PanelOpportunity {
  id: string;
  name: string;
  pipelineName: string;
  stage: string;
  status: string;
  value: number;
  currency?: string;
}

export interface PanelAppointment {
  id: string;
  title?: string;
  startTime: string;
  status: string;
}

export interface PanelLastMessage {
  direction: "inbound" | "outbound";
  source: string;
  content?: string;
  createdAt: string;
}

export type PanelState =
  | { mode: "idle" }
  | {
      mode: "summary";
      query?: string;
      contacts: PanelContact[];
      groups?: SummaryGroup[];
      total: number;
    }
  | {
      mode: "contact";
      contact: PanelContact & {
        email?: string;
        phone?: string;
        companyName?: string;
      };
      opportunities: PanelOpportunity[];
      appointments: PanelAppointment[];
      tasks: PanelTask[];
      notes: PanelNote[];
      lastMessage: PanelLastMessage | null;
      prevSummary?: Extract<PanelState, { mode: "summary" }>;
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ConversationsContextPanelProps {
  state: PanelState;
  locationId?: string;
  onContactClick?: (contact: PanelContact) => void;
  onBack?: () => void;
}

export function ConversationsContextPanel({
  state,
  locationId,
  onContactClick,
  onBack,
}: ConversationsContextPanelProps) {
  return (
    <div className="flex h-full w-[300px] flex-shrink-0 flex-col border-r border-border bg-muted/10">
      {state.mode === "idle" && <IdlePanel />}
      {state.mode === "summary" && (
        <SummaryPanel state={state} onContactClick={onContactClick} />
      )}
      {state.mode === "contact" && (
        <ContactPanel state={state} locationId={locationId} onBack={onBack} />
      )}
    </div>
  );
}

// ─── Idle ─────────────────────────────────────────────────────────────────────

function IdlePanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
        <Clock className="h-5 w-5 text-primary/60" />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        El contexto aparecerá aquí cuando la IA encuentre contactos o conversaciones.
      </p>
    </div>
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function SummaryPanel({
  state,
  onContactClick,
}: {
  state: Extract<PanelState, { mode: "summary" }>;
  onContactClick?: (c: PanelContact) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-foreground">
          Resumen · {state.total}{" "}
          {state.total === 1 ? "contacto" : "contactos"}
        </p>
        {state.query && (
          <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
            {state.query}
          </p>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {/* Aggregate groups */}
          {state.groups && state.groups.length > 0 && (
            <div className="rounded-md border border-border/50 bg-background p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Distribución
              </p>
              <div className="space-y-1.5">
                {state.groups.slice(0, 8).map((g) => (
                  <div
                    key={g.key}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs text-muted-foreground truncate max-w-[60%]">
                      {g.key}
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {g.sum !== undefined
                        ? `$${g.sum.toLocaleString("es-MX")}`
                        : g.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact list */}
          {state.contacts.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contactos
              </p>
              {state.contacts.slice(0, 10).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onContactClick?.(c)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{c.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {c.source ?? c.assignedTo ?? ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60">→</span>
                </button>
              ))}
              {state.contacts.length > 10 && (
                <p className="px-2 text-center text-[10px] text-muted-foreground">
                  + {state.contacts.length - 10} más
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Contact detail ───────────────────────────────────────────────────────────

function ContactPanel({
  state,
  locationId,
  onBack,
}: {
  state: Extract<PanelState, { mode: "contact" }>;
  locationId?: string;
  onBack?: () => void;
}) {
  const { contact, opportunities, appointments, tasks, notes, lastMessage } =
    state;
  const pendingTasks = tasks.filter((t) => t.status !== "completed");
  const ghlUrl = locationId
    ? `https://login.lezgosuite.com/v2/location/${locationId}/contacts/detail/${contact.id}`
    : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        {state.prevSummary && (
          <button
            type="button"
            onClick={onBack}
            className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver
          </button>
        )}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {initials(contact.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{contact.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {[contact.source, contact.assignedTo].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {/* Opportunity */}
          {opportunities.length > 0 && (
            <Section label="Oportunidad">
              {opportunities.slice(0, 1).map((o) => (
                <div
                  key={o.id}
                  className="rounded-md bg-background border border-border/50 p-2.5"
                >
                  <p className="text-xs font-medium text-primary truncate">
                    {o.name}
                  </p>
                  <p className="mt-0.5 text-sm font-bold">
                    ${o.value.toLocaleString("es-MX")}
                    {o.currency ? ` ${o.currency}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Chip>{o.pipelineName}</Chip>
                    <Chip>{o.stage}</Chip>
                    <Chip
                      className={cn(
                        o.status === "won" && "bg-green-100 text-green-800",
                        o.status === "lost" && "bg-red-100 text-red-800",
                        o.status === "open" && "bg-yellow-100 text-yellow-800"
                      )}
                    >
                      {o.status}
                    </Chip>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Appointments */}
          {appointments.length > 0 && (
            <Section label="Citas">
              {appointments.slice(0, 2).map((a) => (
                <div
                  key={a.id}
                  className="rounded-md bg-background border border-border/50 p-2.5"
                >
                  <p className="text-xs text-muted-foreground">
                    📅 {formatDate(a.startTime)}
                  </p>
                  {a.title && (
                    <p className="mt-0.5 text-xs font-medium truncate">
                      {a.title}
                    </p>
                  )}
                  <Chip className="mt-1">{a.status}</Chip>
                </div>
              ))}
            </Section>
          )}

          {/* Tasks */}
          {pendingTasks.length > 0 && (
            <Section
              label={`Tareas · ${pendingTasks.length} pendiente${pendingTasks.length !== 1 ? "s" : ""}`}
            >
              <div className="space-y-1.5">
                {pendingTasks.slice(0, 4).map((t) => {
                  const overdue = isOverdue(t.dueDate);
                  return (
                    <div key={t.id} className="flex items-start gap-2">
                      {t.status === "completed" ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                      ) : (
                        <Circle
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
                            overdue
                              ? "text-destructive"
                              : "text-muted-foreground"
                          )}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs leading-tight">{t.title}</p>
                        {t.dueDate && (
                          <p
                            className={cn(
                              "text-[10px]",
                              overdue
                                ? "text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {overdue ? "⚠ Vencida · " : ""}
                            {formatDate(t.dueDate)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Notes */}
          {notes.length > 0 && (
            <Section label="Notas">
              <div className="rounded-md bg-background border border-border/50 p-2.5">
                <p className="text-[10px] text-muted-foreground">
                  {formatDate(notes[0].dateAdded)}
                </p>
                <p className="mt-1 text-xs leading-relaxed line-clamp-4">
                  {notes[0].body}
                </p>
                {notes.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    + {notes.length - 1} nota{notes.length > 2 ? "s" : ""} más
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Last message */}
          {lastMessage && (
            <Section label="Último mensaje">
              <div className="rounded-md bg-background border border-border/50 p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[10px] text-muted-foreground">
                    {lastMessage.direction === "inbound"
                      ? "↙ Entrante"
                      : "↗ Saliente"}{" "}
                    · {lastMessage.source}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex-shrink-0">
                    {relativeTime(lastMessage.createdAt)}
                  </p>
                </div>
                <p className="text-xs leading-relaxed line-clamp-3">
                  {lastMessage.content ?? "(sin contenido)"}
                </p>
                {lastMessage.direction === "inbound" && (
                  <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠ Sin respuesta del asesor
                  </p>
                )}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      {/* GHL link */}
      {ghlUrl && (
        <div className="border-t border-border px-4 py-2.5">
          <a
            href={ghlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Ver en Lezgo Suite
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Shared tiny components ───────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
