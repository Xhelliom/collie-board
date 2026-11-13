import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusSignal } from "@/components/status-signal";
import { type AgentStatus, STATUS_LABEL } from "@/lib/types";

const CHIP: Record<AgentStatus, string> = {
  blocked: "border-status-blocked/30 bg-status-blocked/15 text-status-blocked",
  working: "border-status-working/30 bg-status-working/15 text-status-working",
  done: "border-status-done/30 bg-status-done/15 text-status-done",
  idle: "border-status-idle/30 bg-status-idle/10 text-status-idle",
  unknown: "border-status-unknown/30 bg-status-unknown/10 text-status-unknown",
};

/** The agent's state as the board's one signal (status-signal.tsx). Kept as a name for its callers. */
export function StatusDot({ status, className, style }: { status: AgentStatus; className?: string; style?: CSSProperties }) {
  return <StatusSignal status={status} className={className} style={style} />;
}

export function StatusBadge({
  status,
  stale,
  className,
}: {
  status: AgentStatus;
  /** The badge is showing the LAST snapshot's status while the connection is not live — dim it so
   *  frozen data doesn't read as current. No animation to remove here (the badge dot never pulses),
   *  so opacity alone carries it; the transition restores it instantly on recovery. */
  stale?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 transition-opacity", CHIP[status], stale && "opacity-40", className)}
    >
      <StatusSignal status={status} decorative />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Muted "shell" tag shown in place of a StatusBadge for a bare shell pane (no agent). */
export function ShellBadge({ stale, className }: { stale?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-opacity",
        stale && "opacity-40",
        className,
      )}
    >
      shell
    </span>
  );
}
