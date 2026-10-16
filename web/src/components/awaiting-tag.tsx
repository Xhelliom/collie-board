import { useNavigate } from "react-router";
import { MessagesSquare } from "lucide-react";

import { useT } from "@/i18n";
import { orchestratorPath, type Awaiting } from "@/lib/board";
import { cn } from "@/lib/utils";

// "The orchestrator awaits your decision" on a card it asked about (an open roadmap decision with
// its cardId). Tapping it opens that project's orchestrator conversation. It goes by itself once the
// decision is leaning or decided — the bridge stops sending `awaiting` (ADR 0011).

export function AwaitingTag({ awaiting, repo, nested = false, className }: {
  awaiting: Awaiting;
  repo: string;
  /** Inside a tile's or a step's own button: a span (no button in a button), the tap not reaching the row. */
  nested?: boolean;
  className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const cls = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-foreground",
    className,
  );
  const body = (
    <>
      <MessagesSquare className="size-3.5" aria-hidden="true" />
      {t("awaiting.tag")}
    </>
  );
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(orchestratorPath(repo));
  };
  // ponytail: nested, it is a pointer shortcut only — the row's own button still opens the card,
  // where the same tag is a real button.
  return nested ? (
    <span className={cls} title={awaiting.text} onClick={open}>
      {body}
    </span>
  ) : (
    <button type="button" className={cls} title={awaiting.text} onClick={open}>
      {body}
    </button>
  );
}
