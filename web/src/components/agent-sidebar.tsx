import { AgentsPageView } from "@/components/agents-page";
import type { AgentView } from "@/lib/types";

interface ThreadSidebarProps {
  herd: AgentView[];
  /** The board's own panes (lead, copilot): never listed. */
  internal: ReadonlySet<string>;
  currentPaneId: string;
  onSelect: (paneId: string) => void;
}

// The pane switcher mounted in the pane-switcher bottom sheet: the Agents page's list, compact — the
// same one the desktop column renders. Switching is the ONLY action here — closing a pane lives in
// the pane pill's long-press sheet (with its own confirm), so a fat-thumbed switch can never destroy
// a pane.
export function ThreadSidebar({ herd, internal, currentPaneId, onSelect }: ThreadSidebarProps) {
  return <AgentsPageView herd={herd} internal={internal} current={currentPaneId} onOpen={onSelect} compact />;
}
