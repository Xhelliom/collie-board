import { useEffect, useState } from "react";
import { CornerDownLeft, Pencil, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/sheet";
import { AgentIcon } from "@/components/agent-icon";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { commandsFor, type AgentCommand } from "@/lib/agent-commands";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  agent: string | undefined | null;
  /** Insert "/cmd " into the composer for the user to complete (arg-taking commands). */
  onInsert: (text: string) => void;
  /** Send "/cmd" immediately and submit (no-arg commands). */
  onSubmit: (text: string) => void;
}

// OUT OF SCOPE of the desktop pass, deliberately: on a wide screen this rides BottomSheet's
// right-hand variant like every other sheet, which is serviceable but not the desktop idiom for a
// command list — that is a centred ⌘K palette, and it is its own card if we ever want it. Nothing
// here presumes one.
export function CommandPalette({ open, onClose, agent, onInsert, onSubmit }: CommandPaletteProps) {
  const all = commandsFor(agent);
  const [query, setQuery] = useState("");
  const { pending, confirm, reset } = usePendingConfirm();

  // Reset transient state whenever the sheet (re)opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      reset();
    }
  }, [open, reset]);

  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter(
        (c) =>
          c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
      )
    : all.filter((c) => c.common);

  function pick(c: AgentCommand) {
    if (c.takesArg) {
      onInsert(`${c.command} `);
      onClose();
      return;
    }
    if (c.dangerous && !confirm(c.command)) return; // first tap arms the confirm
    reset();
    onSubmit(c.command);
    onClose();
  }

  return (
    // No max-height override here: the sheet's own 82dvh is within a hair of the 85 this asked for,
    // and the override clipped the right-hand variant, whose height comes from inset-y-0.
    <BottomSheet open={open} onClose={onClose} title="Agent commands">
      {agent && (
        <div className="mb-3 flex items-center gap-2">
          <AgentIcon agent={agent} className="size-6" />
          <span className="text-sm font-medium">{agent}</span>
        </div>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${all.length} commands…`}
          className="h-11 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      {!q && (
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Common · type to search all {all.length}
        </p>
      )}

      <div className="flex flex-col gap-1">
        {list.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No commands match “{query}”.</p>
        )}
        {list.map((c) => {
          const isPending = pending === c.command;
          return (
            <button
              key={c.command}
              type="button"
              onClick={() => pick(c)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors active:scale-[0.99]",
                isPending ? "bg-destructive/10" : "hover:bg-accent",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      c.dangerous ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {c.command}
                  </span>
                  {c.takesArg && (
                    <span className="font-mono text-xs text-muted-foreground">{c.argHint}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.description}</p>
              </div>
              {isPending ? (
                <span className="shrink-0 text-xs font-medium text-destructive">Confirm?</span>
              ) : c.takesArg ? (
                <Pencil className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
