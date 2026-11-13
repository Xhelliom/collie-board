import { Target } from "lucide-react";

import { useT } from "@/i18n";
import type { GoalStatus } from "@/lib/board";
import { cn } from "@/lib/utils";

/** The three statuses of an open objective — the only ones that change how a project looks. */
export type OpenGoalStatus = Extract<GoalStatus, "active" | "paused" | "claimed">;
export const isOpenGoal = (s: GoalStatus | null | undefined): s is OpenGoalStatus => s === "active" || s === "paused" || s === "claimed";
/** What a header or a tile needs of the open objective: its state and its words. */
export interface OpenGoal {
  status: OpenGoalStatus;
  text: string;
}

// Running = green, paused = orange, claimed reached = the brand's « your turn » (validate it).
export const GOAL_SURFACE: Record<OpenGoalStatus, string> = {
  active: "border-status-done/50 bg-status-done/10",
  paused: "border-status-working/60 bg-status-working/10",
  claimed: "border-brand/50 bg-brand/10",
};
const TONE: Record<OpenGoalStatus, string> = { active: "text-status-done", paused: "text-status-working", claimed: "text-brand" };

/** The objective's first sentence — one line is all a header has room for. Exported for the test. */
export const firstSentence = (text: string): string => text.trim().split(/(?<=[.!?…])\s+|\n/)[0] ?? "";

/** The objective itself, on one line: the target in the state's colour, its first sentence, and a word
 *  only when it is not simply running. On a project's page header and its home tile. */
export function GoalLine({ goal, onClick, className }: { goal: OpenGoal; onClick?: () => void; className?: string }) {
  const t = useT();
  const inner = (
    <>
      <Target className={cn("size-3.5 shrink-0", TONE[goal.status])} aria-hidden="true" />
      <span className="sr-only">{t("goal.title")} :</span>
      <span className="min-w-0 truncate">{firstSentence(goal.text)}</span>
      {goal.status !== "active" && (
        <span className={cn("shrink-0 font-semibold", TONE[goal.status])}>
          {t(goal.status === "claimed" ? "goal.chip.claimed" : "goal.status.paused")}
        </span>
      )}
    </>
  );
  const cls = cn("flex min-w-0 max-w-full items-center gap-1.5 text-sm text-muted-foreground", className);
  return onClick ? (
    <button type="button" data-goal={goal.status} onClick={onClick} className={cn(cls, "text-left hover:text-foreground")}>
      {inner}
    </button>
  ) : (
    <span data-goal={goal.status} className={cls}>
      {inner}
    </span>
  );
}
