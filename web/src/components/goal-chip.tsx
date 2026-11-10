import { Target } from "lucide-react";

import { useT } from "@/i18n";
import type { GoalStatus } from "@/lib/board";
import { cn } from "@/lib/utils";

/** The three statuses of an open objective — the only ones that change how a project looks. */
export type OpenGoalStatus = Extract<GoalStatus, "active" | "paused" | "claimed">;
export const isOpenGoal = (s: GoalStatus | null | undefined): s is OpenGoalStatus => s === "active" || s === "paused" || s === "claimed";

// Running = green, paused = orange, claimed reached = the brand's « your turn » (validate it).
export const GOAL_SURFACE: Record<OpenGoalStatus, string> = {
  active: "border-status-done/50 bg-status-done/10",
  paused: "border-status-working/60 bg-status-working/10",
  claimed: "border-brand/50 bg-brand/10",
};
const CHIP: Record<OpenGoalStatus, string> = {
  active: "border-status-done/60 text-status-done",
  paused: "border-status-working/70 text-status-working",
  claimed: "border-brand/60 bg-brand text-brand-foreground",
};

/** « Objectif · actif » — on a project's tile and its page header, so goal mode is seen without opening it. */
export function GoalChip({ status, className }: { status: OpenGoalStatus; className?: string }) {
  const t = useT();
  return (
    <span data-goal={status} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", CHIP[status], className)}>
      <Target className="size-3" aria-hidden="true" />
      {t("goal.title")} · {t(status === "claimed" ? "goal.chip.claimed" : `goal.status.${status}`)}
    </span>
  );
}
