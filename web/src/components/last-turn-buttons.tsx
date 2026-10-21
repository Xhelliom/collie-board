import { useEffect, useState } from "react";

import { ActionButtons, parseButtons } from "@/components/action-buttons";
import { fetchHistory } from "@/lib/api";
import { parseMarkdown } from "@/lib/markdown";
import type { TranscriptEntry } from "@/lib/types";

// The orchestrator's buttons on its pane screen in TERMINAL mode (ADR 0044). The mirror shows the
// block as raw text — the screen is anyone's output — so the buttons come from the transcript
// instead, the source reading mode renders, and only for the pane the parent derived as the
// orchestrator. No timer of its own: one pull per settled poll, like ReadingView.

/** Turns asked for per pull: enough to reach the last assistant text past its trailing tool calls. */
const TAIL = 8;

/**
 * The last ```collie-buttons block of the newest assistant message — null once a user turn (or a
 * summary, a note) follows it: the question it asked has been answered. Pure, exported for the test.
 */
export function lastTurnButtons(entries: TranscriptEntry[]): { key: string; buttons: NonNullable<ReturnType<typeof parseButtons>> } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.role !== "assistant") return null;
    const texts = e.parts.filter((p) => p.kind === "text");
    if (texts.length === 0) continue; // a tool-only step of the same turn
    const code = texts.flatMap((p) => parseMarkdown(p.text)).filter((b) => b.kind === "code" && b.lang === "collie-buttons").at(-1);
    const buttons = code?.kind === "code" ? parseButtons(code.text) : null;
    return buttons ? { key: e.uuid, buttons } : null;
  }
  return null;
}

export function LastTurnButtons({ paneId, session, poll }: { paneId: string; session?: string; poll: string }) {
  const [found, setFound] = useState<ReturnType<typeof lastTurnButtons>>(null);
  useEffect(() => {
    if (poll !== "idle") return;
    let live = true;
    fetchHistory(paneId, { limit: TAIL }, session).then(
      (res) => live && setFound(res.available ? lastTurnButtons(res.entries) : null),
      () => {}, // a failed poll keeps what is on screen
    );
    return () => { live = false; };
  }, [poll, paneId, session]);
  if (!found) return null;
  // Keyed on the turn: a new question gets fresh buttons, the same one stays spent after a tap.
  return (
    <div className="px-3 pb-2">
      <ActionButtons key={found.key} buttons={found.buttons} pane={paneId} />
    </div>
  );
}
