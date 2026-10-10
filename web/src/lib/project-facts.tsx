import type { ReactNode } from "react";

import { getLocale, t } from "@/i18n";
import { apiRequest } from "@/lib/api";
import type { CardView } from "@/lib/board";

// What the project view shows on a step beyond the card itself — read off the journal by the bridge
// (bridge/project-facts.ts), one request per repo. Optional everywhere: a step with no facts is just a card.

export interface CardFacts {
  cardId: string;
  gate: { ok: boolean; command: string; ts: number } | null;
  lead: { decision: "finished" | "prompt"; reason: string; ts: number } | null;
  triage: { accept: boolean; verdict: string | null; reason: string } | null;
  review: string | null;
  pr: { url: string | null; state: "open" | "merged" | "closed"; autoMerge?: "armed" | "refused" } | null;
  sentBack: number;
  operatorSaid: number;
  startedAt: number | null;
  endedAt: number | null;
}

export const fetchFacts = (repo: string, signal?: AbortSignal): Promise<{ facts: CardFacts[] }> =>
  apiRequest(`/api/project/facts?repo=${encodeURIComponent(repo)}`, { signal });

/**
 * "5 min ago" / "il y a 5 min" in the current language — the platform's own formatter, so no table to
 * keep. Coarse like {@link duration}. (lib/format's timeAgo is upstream's and English-only.)
 */
export function ago(ts: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto", style: "narrow" });
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return rtf.format(0, "second");
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 60 * 24) return rtf.format(-Math.floor(min / 60), "hour");
  return rtf.format(-Math.floor(min / 1440), "day");
}

export type Tone = "good" | "bad" | "warn" | "plain";
export interface FactChip {
  label: string;
  tone: Tone;
}

/** "12 min", "2 h 05" — coarse on purpose; a step is not a stopwatch. */
export function duration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** The one-glance chips of a step: the journal's headline facts, most telling first. Pure. */
export function factChips(card: Pick<CardView, "session">, f: CardFacts | undefined, now = Date.now()): FactChip[] {
  const chips: FactChip[] = [];
  if (f?.gate) chips.push({ label: t(f.gate.ok ? "facts.gateOk" : "facts.gateKo"), tone: f.gate.ok ? "good" : "bad" });
  if (f?.pr) {
    const merged = f.pr.state === "merged";
    chips.push({ label: t(`facts.pr.${f.pr.state}`), tone: merged ? "good" : f.pr.state === "closed" ? "bad" : "plain" });
    if (f.pr.state === "open" && f.pr.autoMerge === "refused") chips.push({ label: t("facts.mergeYourself"), tone: "warn" });
  }
  if (f?.review) chips.push({ label: t("facts.review", { verdict: f.review }), tone: f.review === "complete" ? "good" : "warn" });
  if (f && f.sentBack > 0) chips.push({ label: t("facts.sentBack", { count: f.sentBack }), tone: "warn" });
  if (f && f.operatorSaid > 0) chips.push({ label: t("facts.spoke", { count: f.operatorSaid }), tone: "plain" });
  if (f?.startedAt != null) chips.push({ label: duration((f.endedAt ?? now) - f.startedAt), tone: "plain" });
  const ctx = card.session?.ctxPct;
  if (typeof ctx === "number") chips.push({ label: `ctx ${Math.round(ctx)}%`, tone: ctx >= 80 ? "warn" : "plain" });
  return chips;
}

/** The first line of a spec, without markdown marks — the subtitle of a collapsed step. Pure. */
export function specLine(spec: string | null): string | null {
  const line = (spec ?? "").split("\n").map((l) => l.replace(/^[#>*\-\s`]+/, "").trim()).find(Boolean);
  return line ? line.slice(0, 160) : null;
}

/** `**bold**` in a message → bold nodes. The messages are trusted catalog text, never user input. */
export function rich(text: string): ReactNode[] {
  return text.split("**").map((part, i) => (i % 2 ? <b key={i} className="font-semibold text-foreground">{part}</b> : part));
}
