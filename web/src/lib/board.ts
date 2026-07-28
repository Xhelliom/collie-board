// The board's client surface: the card shapes the bridge serves, the REST calls, and the two path
// helpers. Everything the FORK adds to the frontend data layer lives here, so the diff against
// upstream Collie stays a handful of files rather than a scatter.
//
// The board is bound to the PRIMARY herdr session (see bridge/server.ts), so — unlike every path
// in lib/nav.ts — none of these carry `?s=`.

import { apiRequest } from "./api";
import type { AgentStatus } from "./types";

export type CardStatus =
  | "backlog"
  | "ready"
  | "starting"
  | "working"
  | "blocked"
  | "review"
  | "done"
  | "orphaned"
  | "archived";

export interface CardSession {
  id: string;
  cardId: string;
  paneId: string | null;
  agentSessionId: string | null;
  agentKind: string | null;
  ctxTokens: number | null;
  ctxPct: number | null;
  handoffMd: string | null;
  outcome: "handoff" | "done" | "abandoned" | "lost" | null;
  startedAt: number;
  endedAt: number | null;
}

export interface CardRuntime {
  paneId: string;
  agent: string;
  agentStatus: AgentStatus;
  cwd: string;
  workspaceId: string;
  workspaceLabel: string;
}

export interface Review {
  id: string;
  cardId: string;
  sessionId: string | null;
  verdict: string | null;
  notes: string | null;
  todos: string[];
  createdAt: number;
}

export interface BoardEvent {
  id: number;
  cardId: string | null;
  type: string;
  payload: unknown;
  ts: number;
}

export interface CardView {
  id: string;
  title: string;
  spec: string | null;
  rawInput: string | null;
  acceptance: string[];
  status: CardStatus;
  repoPath: string | null;
  baseRef: string | null;
  branch: string | null;
  workspaceId: string | null;
  agentKind: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  session: CardSession | null;
  runtime: CardRuntime | null;
  sessionCount: number;
}

export interface CardDetail {
  card: CardView;
  sessions: CardSession[];
  reviews: Review[];
  events: BoardEvent[];
}

/** Human column names, in board order. `archived` never renders as a column. */
export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  blocked: "Needs you",
  review: "To review",
  working: "In progress",
  starting: "Starting",
  orphaned: "Orphaned",
  ready: "Ready",
  backlog: "Backlog",
  done: "Done",
  archived: "Archived",
};

/**
 * Column order, urgency first — the same triage principle as Collie's home screen: what needs a
 * human tops the list, settled work sinks. `archived` is absent by design.
 */
export const BOARD_COLUMNS: CardStatus[] = [
  "blocked",
  "review",
  "working",
  "starting",
  "orphaned",
  "ready",
  "backlog",
  "done",
];

/** Tailwind chip classes per column, reusing the status palette the agent badges already use. */
export const CARD_STATUS_CHIP: Record<CardStatus, string> = {
  blocked: "border-status-blocked/30 bg-status-blocked/15 text-status-blocked",
  review: "border-status-done/30 bg-status-done/15 text-status-done",
  working: "border-status-working/30 bg-status-working/15 text-status-working",
  starting: "border-status-working/30 bg-status-working/10 text-status-working",
  orphaned: "border-status-unknown/30 bg-status-unknown/15 text-status-unknown",
  ready: "border-status-idle/30 bg-status-idle/10 text-status-idle",
  backlog: "border-border bg-muted text-muted-foreground",
  done: "border-status-idle/30 bg-status-idle/10 text-status-idle",
  archived: "border-border bg-muted text-muted-foreground",
};

// ── paths ────────────────────────────────────────────────────────────────────

export function boardPath(): string {
  return "/board";
}

export function cardPath(cardId: string): string {
  return `/card/${encodeURIComponent(cardId)}`;
}

// ── api ──────────────────────────────────────────────────────────────────────

export function fetchCards(signal?: AbortSignal): Promise<{ cards: CardView[] }> {
  return apiRequest<{ cards: CardView[] }>("/api/cards", { signal });
}

export function fetchCard(id: string, signal?: AbortSignal): Promise<CardDetail> {
  return apiRequest<CardDetail>(`/api/cards/${encodeURIComponent(id)}`, { signal });
}

/** Fields a create/patch accepts. The bridge validates them again — this is convenience, not a gate. */
export interface CardInput {
  title?: string;
  spec?: string | null;
  rawInput?: string | null;
  acceptance?: string[];
  status?: CardStatus;
  repoPath?: string | null;
  baseRef?: string | null;
  branch?: string | null;
  agentKind?: string | null;
  position?: number;
}

export function createCard(input: CardInput): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>("/api/cards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchCard(id: string, input: CardInput): Promise<{ ok: true; card: CardView }> {
  return apiRequest<{ ok: true; card: CardView }>(`/api/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCard(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}
