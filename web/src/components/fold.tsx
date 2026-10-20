import { useState, type ReactNode } from "react";

import { ChevronRight } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Folds a long list to its first `limit` entries; the returned `toggle` is the « Voir les n autres »
 * button (null when everything fits). The text counterpart is `CollapsibleText`.
 */
export function useFold<T>(items: T[], limit: number) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, limit);
  const toggle =
    items.length > limit ? (
      <FoldToggle open={open} onClick={() => setOpen((o) => !o)} label={t("fold.more", { count: items.length - limit })} lessLabel={t("fold.less")} />
    ) : null;
  return { shown, toggle };
}

export function FoldToggle({
  open,
  label,
  lessLabel,
  onClick,
}: {
  open: boolean;
  label: string;
  lessLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="flex min-h-11 items-center self-start px-2 text-sm text-primary underline-offset-2 hover:underline"
    >
      {open ? lessLabel : label}
    </button>
  );
}

const FOLD_KEY = "collie-fold:";

/** A section's open state, remembered on this device (localStorage); `initial` until the operator chose. */
export function useStoredFold(id: string, initial = true) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(FOLD_KEY + id);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = (on: boolean) => {
    setOpen(on);
    try {
      localStorage.setItem(FOLD_KEY + id, on ? "1" : "0");
    } catch {
      /* private window: the fold just isn't remembered */
    }
  };
  return [open, set] as const;
}

/** A page section folded under its title — the title is the toggle; the state is `useStoredFold`'s. */
export function Fold({ title, state: [open, set], children }: { title: string; state: readonly [boolean, (on: boolean) => void]; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => set(!open)}
        className="flex min-h-11 items-center gap-2 text-left text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
        <span className="min-w-0 truncate">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-foreground/25 to-transparent" />
      </button>
      {open && children}
    </div>
  );
}
