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

/**
 * Desktop's 296px pane list (redesign §5 "three panes") — the Agents page's list, compact: one group
 * per project, the open agent highlighted. This is the desktop's ENTIRE way to switch panes — below
 * `2xl` the same list renders in the pane-switcher sheet instead (agent-sidebar.tsx).
 */
export function PaneListColumn({ herd, internal, currentPaneId, onSelect }: PaneListColumnProps) {
  const t = useT();
  return (
    <nav
      aria-label={t("spaces.panes")}
      className="hidden w-[296px] flex-none flex-col overflow-y-auto border-r bg-muted dark:bg-[oklch(0.165_0.006_250)] 2xl:flex"
    >
      <AgentsPageView herd={herd} internal={internal} current={currentPaneId} onOpen={onSelect} compact title={t("nav.agents")} />
    </nav>
  );
}
