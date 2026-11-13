import type { CSSProperties } from "react";

import { useT } from "@/i18n";
import type { AgentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// The one state signal of the board (Sémaphore): every agent or card state has its own SHAPE, so it
// reads without colour, from across the room — like a semaphore's arms.
//   working  a short bar a light sweeps across         (teal)
//   blocked  herdr's « needs you »: a beacon that pulses (orange)
//   stuck    a slanted stroke                           (red)
//   done     a dimmed filled square
//   idle     a hollow square
//   unknown  a hollow square, fainter
// Each carries its name as aria-label; the motion stops under prefers-reduced-motion (index.css).

export type Signal = AgentStatus | "stuck";

/** A card's column as a signal: the same reading the sidebar, the card and the project page share. */
export function cardSignal(status: string | null | undefined, held?: boolean): Signal {
  if (held) return "stuck";
  if (status === "blocked") return "blocked";
  if (status === "working" || status === "starting") return "working";
  if (status === "review" || status === "done") return "done";
  return status === "orphaned" ? "stuck" : "idle";
}

export function StatusSignal({
  status,
  className,
  style,
  label,
  decorative,
}: {
  status: Signal;
  className?: string;
  /** Geometry only (the pane tree's computed rail offset). */
  style?: CSSProperties;
  /** Overrides the spoken name when the caller has a more precise one (« 3 to test »). */
  label?: string;
  /** The text beside it already says the state: keep the signal out of the accessible name. */
  decorative?: boolean;
}) {
  const t = useT();
  const name = label ?? t(`signal.${status}`);
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={name}
      data-signal={status}
      className={cn("signal", className)}
      style={style}
    >
      <span className="signal__mark" />
    </span>
  );
}
