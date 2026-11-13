import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { AgentsPageView } from "@/components/agents-page";
import type { AgentView } from "@/lib/types";
import { useT } from "@/i18n";

interface PaneListColumnProps {
  herd: AgentView[];
  /** The board's own panes (lead, copilot): never listed. */
  internal: ReadonlySet<string>;
  currentPaneId: string;
  onSelect: (paneId: string) => void;
}

// Folded or not, remembered on this device: it's about the width of the screen in your hand.
const FOLDED_KEY = "collie:pane-column-folded";
const readFolded = () => {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
};

const iconButton = "flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60";

/**
 * Desktop's 296px pane list (redesign §5 "three panes") — the Agents page's list, compact: one group
 * per project, the open agent highlighted. This is the desktop's ENTIRE way to switch panes — below
 * `2xl` the same list renders in the pane-switcher sheet instead (agent-sidebar.tsx). Folds to a
 * thin strip that only holds the button to unfold it, giving the width to the conversation.
 */
export function PaneListColumn({ herd, internal, currentPaneId, onSelect }: PaneListColumnProps) {
  const t = useT();
  const [folded, setFoldedState] = useState(readFolded);
  const setFolded = (v: boolean) => {
    setFoldedState(v);
    try {
      localStorage.setItem(FOLDED_KEY, v ? "1" : "0");
    } catch {
      /* private window: the choice lasts for this visit only */
    }
  };
  if (folded) {
    return (
      <div className="hidden w-12 flex-none flex-col items-center border-r bg-muted pt-2.5 dark:bg-[oklch(0.165_0.006_250)] 2xl:flex">
        <button type="button" onClick={() => setFolded(false)} aria-label={t("pane.column.expand")} title={t("pane.column.expand")} className={iconButton}>
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <nav
      aria-label={t("spaces.panes")}
      className="hidden w-[296px] flex-none flex-col overflow-y-auto border-r bg-muted dark:bg-[oklch(0.165_0.006_250)] 2xl:flex"
    >
      <AgentsPageView
        herd={herd}
        internal={internal}
        current={currentPaneId}
        onOpen={onSelect}
        compact
        title={t("nav.agents")}
        titleAction={
          <button type="button" onClick={() => setFolded(true)} aria-label={t("pane.column.collapse")} title={t("pane.column.collapse")} className={iconButton}>
            <PanelLeftClose className="size-4" />
          </button>
        }
      />
    </nav>
  );
}
