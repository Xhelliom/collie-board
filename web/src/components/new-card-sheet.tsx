import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useHoldReload } from "@/lib/reload-guard";
import type { CardInput } from "@/lib/board";

interface NewCardSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CardInput) => void;
  /** Pre-fill the repo path (the last one used) so the common case is one field, not three. */
  defaultRepoPath?: string;
}

// Create a card. The big field is deliberately a plain multi-line textarea: on Android that box IS
// the voice input (the keyboard's mic button dictates into it), which is the whole reason the brain
// dump is the primary field rather than a tidy form. Everything else is optional.
//
// The title is derived from the first line when you don't type one — dictating "add a diff view,
// scoped to the card's branch, must render --stat first" should produce a usable card with no extra
// taps. A real reformulation (title + spec + acceptance + branch name) is the copilot's job.
export function NewCardSheet({ open, onClose, onCreate, defaultRepoPath }: NewCardSheetProps) {
  const [text, setText] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [baseRef, setBaseRef] = useState("");

  // A self-update reload must not eat a half-dictated brain dump.
  useHoldReload("new-card", open);

  useEffect(() => {
    if (open) {
      setText("");
      setRepoPath(defaultRepoPath ?? "");
      setBaseRef("");
    }
  }, [open, defaultRepoPath]);

  const title = deriveTitle(text);

  function create() {
    if (!title) return;
    onCreate({
      title,
      rawInput: text.trim(),
      // Keep the dump as the spec too, so a card is usable before the copilot ever runs.
      spec: text.trim(),
      status: "backlog",
      repoPath: repoPath.trim() || null,
      baseRef: baseRef.trim() || null,
    });
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="New card">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            What needs doing (dictate away)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Add a diff view scoped to the card's branch…"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Repo path (optional)</span>
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/home/you/code/project"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Base ref (optional)</span>
          <input
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder="main"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        {title && (
          <p className="truncate text-xs text-muted-foreground">
            Title: <span className="text-foreground">{title}</span>
          </p>
        )}
        <Button onClick={create} disabled={!title} className="mt-1 h-11">
          Add to backlog
        </Button>
      </div>
    </BottomSheet>
  );
}

/**
 * A card title from a free-text dump: its first non-empty line, trimmed of list/heading markers and
 * clipped to something that fits a tile. Exported for the unit test — the interesting cases are a
 * dump that starts with a bullet, and one that is a single long paragraph with no line breaks.
 */
export function deriveTitle(text: string, max = 72): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!line) return "";
  const cleaned = line.replace(/^[-*#>\s]+/, "").trim();
  if (cleaned.length <= max) return cleaned;
  // Prefer a word boundary so a clipped title doesn't end mid-word.
  const clipped = cleaned.slice(0, max);
  const space = clipped.lastIndexOf(" ");
  return `${(space > max * 0.6 ? clipped.slice(0, space) : clipped).trimEnd()}…`;
}
