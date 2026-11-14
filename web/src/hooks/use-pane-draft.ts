import { useEffect, useState } from "react";
import type { PasteChip } from "@/lib/paste-chips";

// Per-pane draft persistence for the two message fields (Composer, OrchestratorPanel): both remount
// on navigation (Composer is `key={paneId}`, the panel leaves with the Project page), and without this
// whatever was typed is silently dropped. A module-scoped Map survives that remount the same way
// loaders.ts's lastPaneText does; bounded so switching through many panes over a long session can't
// grow it forever. Each key has one reader at a time, so a plain Map is enough — no
// useSyncExternalStore pub/sub.
const DRAFT_MAX = 20;
// A draft keeps its paste chips with it — a marker without its chip would be sent literally.
interface Draft {
  input: string;
  pastes: PasteChip[];
}
const drafts = new Map<string, Draft>();

function saveDraft(key: string, value: Draft): void {
  if (value.input === "") {
    drafts.delete(key);
    return;
  }
  drafts.delete(key); // re-insert at the end — Map iteration order is insertion order
  drafts.set(key, value);
  if (drafts.size > DRAFT_MAX) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
}

/** Test-only: module state outlives a single test's render tree — every test that mounts a field
 *  using this hook must start from an empty map. Mirrors __resetReloadGuard. */
export function __resetDrafts(): void {
  drafts.clear();
}

/**
 * The field's text and paste chips, seeded from the saved draft for `key` (or `seed` when one is
 * given — a question brought in wins over an old draft) and written through on every change, so the
 * next mount under the same key picks up where this one left off. Clearing the text clears the draft.
 */
export function usePaneDraft(key: string, seed = "") {
  const [input, setInput] = useState(() => seed || (drafts.get(key)?.input ?? ""));
  const [pastes, setPastes] = useState<PasteChip[]>(() => (seed ? [] : (drafts.get(key)?.pastes ?? [])));
  // The key can change under a mounted field (the Project page switching repo): reseed from the new one.
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setInput(drafts.get(key)?.input ?? "");
    setPastes(drafts.get(key)?.pastes ?? []);
  }
  useEffect(() => {
    if (seenKey === key) saveDraft(key, { input, pastes });
  }, [key, seenKey, input, pastes]);
  return { input, setInput, pastes, setPastes };
}
