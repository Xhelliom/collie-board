import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Counts up to `to` once on mount, then follows it; still for people who asked for less motion. */
export function useCountUp(to: number): number {
  const [v, setV] = useState(calm() ? to : 0);
  const from = useRef(v);
  useEffect(() => {
    if (calm()) return setV(to);
    const t0 = performance.now();
    const start = from.current;
    let raf = requestAnimationFrame(function tick(t) {
      const x = Math.min(1, (t - t0) / 900);
      const val = Math.round(start + (to - start) * (1 - Math.pow(1 - x, 3)));
      from.current = val;
      setV(val);
      if (x < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return v;
}

export function Kpi({ label, value, note, tone }: { label: string; value: number; note?: string; tone: string }) {
  const shown = useCountUp(value);
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card/70 p-3.5 transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/25">
      <span className={cn("absolute inset-x-0 top-0 h-px opacity-60", tone)} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <div className="mt-1.5 text-3xl font-semibold leading-none tabular-nums">{shown}</div>
      {note && <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}
