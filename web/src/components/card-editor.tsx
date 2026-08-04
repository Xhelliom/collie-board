import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Layers, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useHoldReload } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { fetchCards, normalizeTag, tagsOf, type CardInput, type CardView } from "@/lib/board";
import { TagField } from "@/components/tag-field";

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
  const [tag, setTag] = useState(card.tag ?? "");
  const [parentId, setParentId] = useState<string | null>(card.parentId);
  const [dependsOn, setDependsOn] = useState<string | null>(card.dependsOn);
  const [others, setOthers] = useState<CardView[]>([]);
  const [saving, setSaving] = useState(false);

  useHoldReload("card-editor", open);

  // Re-seed from the card each time the sheet opens — the poll may have moved it underneath.
  useEffect(() => {
    if (!open) return;
    setTitle(card.title);
    setSpec(card.spec ?? "");
    setAcceptance(card.acceptance);
    setBaseRef(card.baseRef ?? "");
    setTag(card.tag ?? "");
    setParentId(card.parentId);
    setDependsOn(card.dependsOn);
    // Fetched on OPEN, not polled: linking is a deliberate act, and the list only has to be right
    // at the moment you pick from it. Rides the ETag cache, so it is usually a 304.
    let cancelled = false;
    void fetchCards()
      .then(({ cards }) => {
        if (!cancelled) setOthers(cards.filter((c) => c.id !== card.id));
      })
      .catch(() => {
        // No list, no picker — the rest of the editor still works.
      });
    return () => {
      cancelled = true;
    };
    // card.ID, not the card: the object is new on every poll that changes anything, and re-seeding
    // then would wipe what is being typed. Opening the sheet is the moment to read the card.
  }, [open, card.id]);

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
        // null clears it — emptying the box is how a card loses its tag.
        tag: normalizeTag(tag),
        parentId,
        dependsOn,
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

        {/* The card itself leads the inventory: it is the most recently touched, and a tag only IT
            carries has to stay offered — otherwise editing anything else on the card would present
            its own tag as unknown. `others` rides the fetch the link pickers already do. */}
        <TagField value={tag} onChange={setTag} tags={tagsOf([card, ...others])} />

        <LinkPicker
          label="Part of"
          hint="Groups this under another card on the board."
          value={parentId}
          cards={others}
          onChange={setParentId}
        />
        <LinkPicker
          label="After"
          hint="Won't start until that card is done, and forks from its branch."
          value={dependsOn}
          cards={others}
          onChange={setDependsOn}
        />

        <Button onClick={save} disabled={!title.trim() || saving} className="mt-1 h-11">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </BottomSheet>
  );
}

/**
 * Pick another card to link this one to, or none.
 *
 * Collapsed to its current value until tapped — two of these plus a spec box would otherwise fill
 * the sheet with lists you rarely touch. Same inline-scrolling-list shape as the repo picker in
 * `new-card-sheet.tsx`, rather than a nested sheet, because a sheet inside a sheet on a phone is a
 * back-button trap.
 *
 * NO client-side cycle filtering. The bridge already refuses a link that would close a loop, with a
 * message that says so, and reproducing that graph walk here would put the same rule in two places
 * for a mistake that is one tap to undo. Only the card itself is excluded, by the caller.
 */
export function LinkPicker({
  label,
  hint,
  value,
  cards,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  cards: CardView[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = cards.find((c) => c.id === value);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-left"
      >
        {selected ? (
          <>
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{selected.title}</span>
          </>
        ) : (
          /* A link this card has that isn't on the board (archived) still reads as set, not as
             nothing — silently showing "Nothing" would invite clearing it by accident. */
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {value ? "A card not on the board" : "Nothing"}
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground", open && "rotate-180")} />
      </button>
      <span className="text-xs text-muted-foreground/70">{hint}</span>

      {open && (
        <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pt-1">
          <PickerRow active={value === null} onClick={() => { onChange(null); setOpen(false); }}>
            <span className="text-muted-foreground">Nothing</span>
          </PickerRow>
          {cards.map((c) => (
            <PickerRow
              key={c.id}
              active={value === c.id}
              onClick={() => { onChange(c.id); setOpen(false); }}
            >
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
            </PickerRow>
          ))}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm active:scale-[0.99]",
        active ? "border-primary bg-primary/10" : "border-border bg-background",
      )}
    >
      {children}
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}
