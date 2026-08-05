import { cn } from "@/lib/utils";
import { commandsFor } from "@/lib/agent-commands";

interface CommandSuggestionsProps {
  /** The pane's agent — picks the same catalog the Agent-commands button opens. */
  agent: string | undefined | null;
  /** The live composer draft. Suggestions only fire while it is a lone "/token". */
  value: string;
  /** Replace the draft with the picked command (trailing space when it takes an argument). */
  onPick: (text: string) => void;
}

// Keep the strip short enough that it can't push the input off a phone screen; the palette button is
// still the way to browse all of them.
const MAX = 6;

// Type-ahead for slash commands, prefix-matched against the SAME catalog (agent-commands.ts) the
// Agent-commands button opens — that button stays, with its search and its send-on-tap; this only
// completes what you started typing, it never sends. Fires only while the draft is a lone "/token":
// a slash command is one at the start of the line, and the first space means the user is writing
// arguments, not still choosing a command.
export function CommandSuggestions({ agent, value, onPick }: CommandSuggestionsProps) {
  if (!/^\/\S*$/.test(value)) return null;
  const q = value.toLowerCase();
  const list = commandsFor(agent)
    .filter((c) => c.command.startsWith(q))
    .slice(0, MAX);
  if (list.length === 0) return null;

  return (
    // A labelled GROUP of plain buttons, deliberately not a listbox/option pair: a listbox promises
    // arrow-key navigation and an active descendant, and there is none here — the rows are tapped (or
    // reached with Tab, which native buttons give us for free).
    <div
      className="mb-2 max-h-56 overflow-y-auto rounded-md border border-border/60 bg-muted/40"
      role="group"
      aria-label="Command suggestions"
    >
      {list.map((c) => (
        <button
          key={c.command}
          type="button"
          // Keeps the soft keyboard up through the tap, like the composer's attach button.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(c.takesArg ? `${c.command} ` : c.command)}
          className="flex w-full items-baseline gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent active:scale-[0.99]"
        >
          <span
            className={cn(
              "shrink-0 font-mono text-sm font-semibold",
              c.dangerous ? "text-destructive" : "text-foreground",
            )}
          >
            {c.command}
          </span>
          {c.takesArg && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.argHint}</span>
          )}
          <span className="truncate text-xs text-muted-foreground">{c.description}</span>
        </button>
      ))}
    </div>
  );
}
