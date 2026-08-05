import { useState } from "react";
import { ChevronsUpDown, TerminalSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";
import { paneDisplayName } from "@/lib/types";
import type { AgentView } from "@/lib/types";

interface PaneMenuProps {
  /** The panes of the CURRENT space (agents + shells), in snapshot order. */
  panes: AgentView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
}

// The breadcrumb's pane segment: a `pN` chip that drops down the panes of the space you're already
// in. Deliberately NOT the "Switch pane" sheet the handle above the composer opens — that one lists
// the whole herd, which reads as a detour when all you wanted was the pane next door. Same split as
// the space/tab segments beside it: a breadcrumb segment switches WITHIN its level.
//
// Hand-rolled rather than a dropdown library: the repo has no popover primitive and this needs none
// — an absolutely-positioned list plus a transparent full-screen layer for click-outside. Escape
// closes it too (the layer can't catch keys). The trigger's ancestor must not be `truncate`
// (overflow:hidden would clip the list) — see the desktop toolbar in agent-chat.tsx.
export function PaneMenu({ panes, currentPaneId, onSelect }: PaneMenuProps) {
  const [open, setOpen] = useState(false);

  // Nothing to switch between — render the chip as plain text rather than a dead affordance.
  const only = panes.length <= 1;

  function pick(paneId: string): void {
    setOpen(false);
    if (paneId !== currentPaneId) onSelect(paneId);
  }

  const label = currentPaneId.split(":").pop();

  if (only) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-[7px] py-0.5 font-semibold text-foreground">
        {label}
      </span>
    );
  }

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Pane ${label}. Switch pane in this space`}
        className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-[7px] py-0.5 font-semibold text-foreground transition-colors hover:bg-muted/70"
      >
        {label}
        <ChevronsUpDown className="size-2.5" />
      </button>

      {open && (
        <>
          {/* Click-outside layer. Below the list, above everything else. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <ul
            role="menu"
            className="absolute left-0 top-full z-50 mt-1.5 min-w-[15rem] max-w-[20rem] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
          >
            {panes.map((p) => {
              const active = p.paneId === currentPaneId;
              return (
                <li key={p.paneId} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pick(p.paneId)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    {p.kind === "shell" ? (
                      <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <AgentIcon agent={p.agent} className="size-4 shrink-0" />
                    )}
                    <span className="shrink-0 font-mono text-[11px] font-semibold">
                      {p.paneId.split(":").pop()}
                    </span>
                    <span className="truncate text-xs font-medium">{paneDisplayName(p)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </span>
  );
}
