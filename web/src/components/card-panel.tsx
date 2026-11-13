import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One panel of a card's page: a title, an optional count, the panel's own actions on the right, then
// its body. Every panel on that page has this same header, so an action always sits on the panel it
// touches. Sentence case, no tracked capitals: the title is a sentence, not a label.

export function Panel({
  title,
  count,
  actions,
  tone,
  className,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  /** `bad`: why the card stopped. `good`: the bilan of a finished card. */
  tone?: "bad" | "good";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card shadow-(--shadow-2) p-4",
        tone === "bad" && "bg-destructive/8",
        tone === "good" && "bg-status-done/6",
        className,
      )}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-tight">
          {title}
          {count != null && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{count}</span>}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** The action a panel header carries (« Modifier », « Journal complet »): a secondary button, never a
 *  coloured word — an action must look clickable (actions-are-buttons.test). */
export function PanelLink({
  onClick,
  children,
  disabled,
  expanded,
  success,
}: {
  success?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={cn(buttonVariants({ variant: success ? "success" : "secondary", size: "sm" }), "text-[13px]")}
    >
      {children}
    </button>
  );
}

/** A sub-block inside a panel (« Critères de validation »): a plain heading, never tracked capitals. */
export function PanelPart({ title, count, children }: { title: ReactNode; count?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-3">
      <h3 className="text-sm font-medium">
        {title}
        {count != null && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </div>
  );
}
