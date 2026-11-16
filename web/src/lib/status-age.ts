// How long a card or an agent has been in its state, and when that wait turns loud. Read at render
// time: the existing polling re-renders the rows, so the age moves with it — no timer of its own.
import type { Signal } from "@/components/status-signal";

/** A wait (orange) or a stuck state (red) older than this is drawn solid. */
export const LOUD_AFTER_MS = 60 * 60_000;

export type AgeTone = "wait" | "stuck" | null;

/** "wait" / "stuck" once the state has lasted past LOUD_AFTER_MS; null for anything else (grey). */
export function ageTone(signal: Signal, since: number | null | undefined, now = Date.now()): AgeTone {
  if (since == null || now - since <= LOUD_AFTER_MS) return null;
  return signal === "blocked" ? "wait" : signal === "stuck" ? "stuck" : null;
}

/** The solid pill a loud age wears; text-background reads on both themes' signal colours. */
export const AGE_TONE_CLASS = {
  wait: "rounded-sm bg-status-blocked px-1.5 font-medium text-background",
  stuck: "rounded-sm bg-signal-stuck px-1.5 font-medium text-background",
} as const;
