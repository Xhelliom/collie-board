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
 * The one ring of the app: the project's progress, the herd at work, a provider's quota. Arcs run
 * one after the other over `total`; each is drawn from the top up to its own end, the first on top,
 * so round caps never leave a gap. They grow from nothing on mount (still for reduced motion).
 */
export function Ring({ arcs, total, label, children, className }: { arcs: Arc[]; total: number; label: string; children: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(calm());
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  let end = 0;
  const ends = arcs.map((a) => (end += a.value));
  const off = (n: number) => (armed && total ? C * (1 - Math.min(n, total) / total) : C);
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className ?? "size-24 sm:size-40")} role="img" aria-label={label}>
      <svg viewBox="0 0 156 156" className="absolute inset-0 -rotate-90">
        <circle cx="78" cy="78" r={R} className="fill-none stroke-border stroke-[9]" />
        {arcs
          .map((a, i) => (
            <circle
              key={i}
              cx="78"
              cy="78"
              r={R}
              strokeDasharray={C}
              strokeDashoffset={off(ends[i]!)}
              className={cn(
                "fill-none stroke-[9] [stroke-linecap:round] transition-[stroke-dashoffset] duration-[1400ms] ease-out motion-reduce:transition-none",
                a.className,
                (!a.value || !total) && "hidden",
              )}
            />
          ))
          .reverse()}
      </svg>
      <div className="grid gap-0.5 text-center">{children}</div>
    </div>
  );
}
