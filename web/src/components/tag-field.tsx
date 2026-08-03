import { useId } from "react";

import { TagChip } from "@/components/tag-chip";
import { cn } from "@/lib/utils";
import { normalizeTag, TAG_MAX_CHARS } from "@/lib/board";

/**
 * The card's one tag, typed or tapped. Shared by the new-card sheet and the editor, because
 * "which tag" is the same question in both and a second implementation is how the two drift.
 *
 * BOTH paths, in one control, on purpose: the whole value of a tag is that two cards carrying the
 * same work carry the SAME string, and a free-text box alone gets you `bug`, `Bug` and `bugs` by
 * the end of the week. So what already exists is on screen as chips — one tap, in the tag's own
 * colour — and the box is `list=`-bound to the same inventory, which filters it as you type and
 * keeps the free-text half honest for a tag that doesn't exist yet.
 *
 * ponytail: `<datalist>` rather than a hand-rolled combobox — it IS the native "type or pick one"
 * control, it filters for free, and it costs no keyboard handling, no focus trap, no aria wiring.
 * Its ceiling is that it can't render the chips' colours; that is exactly what the tapable row
 * above it is for, so the two together cover what either alone misses.
 *
 * Case and spacing are settled by {@link normalizeTag}, on submit rather than per keystroke — the
 * field shows what you typed, and matches it against the inventory folded. So typing `Bug ` lights
 * up the existing `bug` chip instead of quietly minting a second spelling.
 */
export function TagField({
  value,
  onChange,
  tags,
}: {
  value: string;
  onChange: (value: string) => void;
  tags: string[];
}) {
  const inputId = useId();
  const listId = useId();
  const current = normalizeTag(value);

  return (
    // A `htmlFor` label rather than the wrapping `<label>` the sheet's other fields use: the chips
    // below are buttons, and a button inside a label steals its own tap to focus the input.
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        Tag (optional)
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder="bug"
        // A phone keyboard capitalises the first letter by default, which would make every
        // hand-typed tag arrive as `Bug` and lean on normalisation to undo it. Cheaper to not.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={TAG_MAX_CHARS}
        className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <datalist id={listId}>
        {tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {/* ponytail: the twelve most recent, not all of them — a year-old board would otherwise
              open this sheet on a wall of chips. The box below is how you reach an older one. */}
          {tags.slice(0, 12).map((tag) => (
            <button
              key={tag}
              type="button"
              // Tapping the tag it already carries clears it: the row is the whole gesture, so
              // "no tag after all" must not send you back to the keyboard to erase a word.
              onClick={() => onChange(tag === current ? "" : tag)}
              aria-pressed={tag === current}
              className="rounded-full active:scale-[0.97]"
            >
              <TagChip
                tag={tag}
                className={cn(
                  "px-2 py-1 text-xs",
                  tag === current ? "ring-2 ring-primary/60" : "opacity-70",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
