import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useHoldReload } from "@/lib/reload-guard";
import type { CardInput, CardView } from "@/lib/board";

// Rework a card by hand.
//
// The copilot writes a good first draft, but a spec is a thing you argue with — and until now the
// only way to change one was to delete the card and dictate it again, which also threw away its
// sessions and its journal. Editing is the cheap half of "rework a card"; `Reformulate` is the
// other half.
//
// Acceptance criteria are edited as a LIST, not as a blob of text with newlines: they are a list
// everywhere else in the system (the start prompt renders them as a checklist, the review judges
// against them), and asking someone to maintain a newline-separated convention on a phone is how
// you end up with one four-line criterion.
export function CardEditor({
  card,
  open,
  onClose,
  onSave,
}: {
  card: CardView;
  open: boolean;
  onClose: () => void;
  onSave: (patch: CardInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(card.title);
  const [spec, setSpec] = useState(card.spec ?? "");
  const [acceptance, setAcceptance] = useState<string[]>(card.acceptance);
  const [baseRef, setBaseRef] = useState(card.baseRef ?? "");
  const [saving, setSaving] = useState(false);

  useHoldReload("card-editor", open);

  // Re-seed from the card each time the sheet opens — the poll may have moved it underneath.
  useEffect(() => {
    if (!open) return;
    setTitle(card.title);
    setSpec(card.spec ?? "");
    setAcceptance(card.acceptance);
    setBaseRef(card.baseRef ?? "");
  }, [open, card]);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave({
        title: trimmed,
        spec: spec.trim() || null,
        acceptance: acceptance.map((a) => a.trim()).filter(Boolean),
        baseRef: baseRef.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Edit card">
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Spec (markdown)</span>
          <textarea
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            rows={8}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Acceptance criteria</span>
          {acceptance.map((a, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={a}
                onChange={(e) =>
                  setAcceptance((list) => list.map((v, j) => (j === i ? e.target.value : v)))
                }
                className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <button
                type="button"
                aria-label="Remove criterion"
                onClick={() => setAcceptance((list) => list.filter((_, j) => j !== i))}
                className="p-2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAcceptance((list) => [...list, ""])}
            className="flex items-center gap-1.5 self-start px-1 py-1 text-xs text-muted-foreground underline underline-offset-4"
          >
            <Plus className="size-3" />
            Add a criterion
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Base ref</span>
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
        {card.branch && (
          <p className="text-xs text-muted-foreground">
            Branch <span className="font-mono">{card.branch}</span> is fixed — a worktree may exist
            at it.
          </p>
        )}

        <Button onClick={save} disabled={!title.trim() || saving} className="mt-1 h-11">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </BottomSheet>
  );
}
