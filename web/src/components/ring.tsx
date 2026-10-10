import { useEffect, useState, type ReactNode } from "react";

import { calm } from "@/components/kpi";
import { cn } from "@/lib/utils";

const R = 66;
const C = 2 * Math.PI * R;

export interface Arc {
  value: number;
  /** A `stroke-*` class. */
  className: string;
}

/**
 * A donut of consecutive arcs over `total`, anything left over reading as the empty track. The one
 * ring of the dashboard — the herd's three states and a provider's quota are both just arcs. The arcs
 * grow from nothing on mount (still for reduced motion), like the project view's ring.
 */
export function Ring({ arcs, total, label, children, className }: { arcs: Arc[]; total: number; label: string; children: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(calm());
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  let start = 0;
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className ?? "size-36 sm:size-40")} role="img" aria-label={label}>
      <svg viewBox="0 0 156 156" className="absolute inset-0 -rotate-90">
        <circle cx="78" cy="78" r={R} className="fill-none stroke-border stroke-[9]" />
        {arcs.map((a, i) => {
          const len = armed && total ? Math.min(C, (C * a.value) / total) : 0;
          const offset = -start;
          start += total ? (C * a.value) / total : 0;
          return len > 0 || !armed ? (
            <circle
              key={i}
              cx="78"
              cy="78"
              r={R}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={offset}
              className={cn("fill-none stroke-[9] [stroke-linecap:butt] transition-[stroke-dasharray] duration-[1200ms] ease-out motion-reduce:transition-none", a.className)}
            />
          ) : null;
        })}
      </svg>
      <div className="grid gap-0.5 text-center">{children}</div>
    </div>
  );
}
