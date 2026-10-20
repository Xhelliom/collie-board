// « Ménage » (bridge/tidy.ts): the panes that no longer serve, and the one gesture that closes them.
import { apiRequest } from "./api";

export type TidyReason = "card-done" | "agent-done" | "idle" | "shell";
export const TIDY_REASONS: readonly TidyReason[] = ["card-done", "agent-done", "idle", "shell"];

export interface TidyCandidate {
  paneId: string;
  reason: TidyReason;
  /** Since when the reason holds (epoch ms), or null when the bridge never saw it start. */
  since: number | null;
  agent: string;
  workspaceLabel: string;
  label: string | null;
  cwd: string;
  cardId?: string;
  cardTitle?: string;
}

export interface TidyResult {
  ok: boolean;
  closed: string[];
  skipped: string[];
  failed: { paneId: string; error: string }[];
}

export const fetchTidy = (idleHours: number): Promise<{ candidates: TidyCandidate[] }> =>
  apiRequest(`/api/tidy?idleHours=${idleHours}`);

export const closeTidy = (paneIds: string[], idleHours: number): Promise<TidyResult> =>
  apiRequest("/api/tidy/close", { method: "POST", body: JSON.stringify({ paneIds, idleHours }) });

/** Checked by default: everything but a bare shell, which the operator may be using. */
export const checkedByDefault = (c: TidyCandidate): boolean => c.reason !== "shell";
