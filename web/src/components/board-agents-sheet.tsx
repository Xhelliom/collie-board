// The board's own agents — the lead and the copilot — behind the Agents page's « ⋯ ». Rarely useful:
// when a note says « restart the board's lead » (a new model, a mute agent), this is where to go.
import { RotateCcw, SquareTerminal } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { agentIdentity } from "@/lib/agent-identity";
import { restartBoardAgent, type BoardAgentRole } from "@/lib/board";
import { setStatus } from "@/lib/status";
import type { AgentView } from "@/lib/types";
import { ActionRow, DestructiveActionRow } from "./action-sheet-rows";
import { useStateSaid } from "./agent-line";
import { StatusDot } from "./status-badge";
import { BottomSheet } from "./ui/sheet";

const ROLES: BoardAgentRole[] = ["lead", "copilot"];

export function BoardAgentsSheet({
  open,
  onClose,
  panes,
  herd,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  /** Each role's pane, from the snapshot (`leadPaneId`, `copilotPaneId`). */
  panes: Record<BoardAgentRole, string | null>;
  herd: AgentView[];
  onOpen: (paneId: string) => void;
}) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("boardAgents.title")}>
      <p className="px-3 pb-2 text-sm text-muted-foreground">{t("boardAgents.intro")}</p>
      <div className="flex flex-col divide-y divide-border/60">
        {ROLES.map((role) => {
          const agent = herd.find((a) => a.paneId === panes[role]) ?? null;
          return <Row key={role} role={role} agent={agent} onOpen={onOpen} />;
        })}
      </div>
    </BottomSheet>
  );
}

function Row({ role, agent, onOpen }: { role: BoardAgentRole; agent: AgentView | null; onOpen: (paneId: string) => void }) {
  const t = useT();
  const { pending, confirm } = usePendingConfirm(5000);
  const [restarting, setRestarting] = useState(false);
  const name = t(`boardAgents.${role}`);

  const restart = async () => {
    if (!confirm(role)) return;
    setRestarting(true);
    try {
      await restartBoardAgent(role);
      setStatus(t("boardAgents.restarted", { name }), "success");
    } catch (err) {
      setStatus((err as Error).message, "error");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <section aria-label={name} className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-2.5 px-3">
        {agent && <StatusDot status={agent.status} />}
        <span className="font-semibold">{name}</span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{agent ? <StateSaid agent={agent} /> : t("boardAgents.off")}</span>
      </div>
      <p className="px-3 text-[13px] text-muted-foreground">{t(`boardAgents.${role}.does`)}</p>
      {agent && (
        <div className="mt-1 flex flex-col">
          <ActionRow icon={<SquareTerminal className="size-4 shrink-0 text-muted-foreground" />} label={t("boardAgents.open")} onClick={() => onOpen(agent.paneId)} />
          <DestructiveActionRow
            icon={<RotateCcw className="size-4 shrink-0" />}
            label={t("boardAgents.restart")}
            // A working agent is mid-request: the confirmation says the request goes with it.
            confirmLabel={t(agent.status === "working" ? "boardAgents.confirmBusy" : "boardAgents.confirm")}
            closingLabel={t("boardAgents.restarting")}
            armed={pending === role}
            closing={restarting}
            onClick={restart}
          />
        </div>
      )}
    </section>
  );
}

function StateSaid({ agent }: { agent: AgentView }) {
  const t = useT();
  return <>{useStateSaid(agentIdentity(agent, t("agents.orchestrator")))}</>;
}
