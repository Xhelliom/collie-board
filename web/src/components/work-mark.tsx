import { useState } from "react";
import { Check, Circle, CircleDot, ListChecks, TerminalSquare } from "lucide-react";

import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import type { AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_ICON = { completed: Check, in_progress: CircleDot, pending: Circle } as const;

/** "2/5 tasks · 1 command running" — taps open the list (done / in progress / to do) and the
 *  commands still running. Renders nothing when the bridge reports neither (agent-work.ts). */
export function WorkMark({ agent, className }: { agent?: AgentView; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tasks = agent?.tasks ?? [];
  const background = agent?.background ?? [];
  if (tasks.length === 0 && background.length === 0) return null;
  const done = tasks.filter((x) => x.status === "completed").length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("flex min-w-0 items-center gap-1 text-left text-[11px] text-muted-foreground", className)}
      >
        {tasks.length > 0 && (
          <>
            <ListChecks className="size-3 shrink-0" />
            <span className="text-foreground/80">{t("pane.work.tasks", { done, count: tasks.length })}</span>
          </>
        )}
        {tasks.length > 0 && background.length > 0 && <span>·</span>}
        {background.length > 0 && (
          <>
            <TerminalSquare className="size-3 shrink-0" />
            <span className="text-foreground/80">{t("pane.work.background", { count: background.length })}</span>
          </>
        )}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("pane.work.title")}>
        <div data-vaul-no-drag className="flex flex-col gap-4 pb-2">
          {tasks.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {tasks.map((task, i) => {
                const Icon = STATUS_ICON[task.status];
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon
                      aria-label={t(`pane.work.status.${task.status}`)}
                      className={cn("mt-0.5 size-4 shrink-0", task.status === "in_progress" ? "text-primary" : "text-muted-foreground")}
                    />
                    <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>{task.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {background.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("pane.work.background", { count: background.length })}
              </h3>
              {background.map((label, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <TerminalSquare className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="break-all font-mono text-xs">{label}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
