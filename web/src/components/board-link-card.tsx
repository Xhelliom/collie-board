import { useEffect, useState, type ReactNode } from "react";
import { Link, useInRouterContext, useRouteLoaderData } from "react-router";

import { StatusBadge } from "@/components/status-badge";
import { CardStatusChip } from "@/components/card-status-chip";
import { fetchCard, repoName, CARD_STATUS_LABEL, type CardView } from "@/lib/board";
import type { BoardLink } from "@/lib/board-link";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { paneDisplayName } from "@/lib/types";

// What a Collie Board link in the reading view turns into: the card (or session) it names, live —
// title, column, repo — and one tap to open it. Read from the same endpoints the screens use (the
// card fetch is ETag-conditional), never on a timer. Anything it cannot resolve falls back to the
// plain link, so a deleted card never leaves a dead box. Text nodes only.

const SHELL =
  "my-1 flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left no-underline";

function Shell({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={SHELL}>
      {children}
    </Link>
  );
}

function CardLinkCard({ link, label }: { link: BoardLink; label: ReactNode }) {
  const [card, setCard] = useState<CardView | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetchCard(link.id, ctl.signal)
      .then((d) => setCard(d.card))
      .catch(() => {});
    return () => ctl.abort();
  }, [link.id]);
  if (!card) return <Link to={link.path} className="text-primary underline underline-offset-2">{label}</Link>;
  return (
    <Shell to={link.path}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{card.title}</span>
        {card.repoPath && <span className="block truncate text-xs text-muted-foreground">{repoName(card.repoPath)}</span>}
      </span>
      <CardStatusChip status={card.status}>{CARD_STATUS_LABEL[card.status]}</CardStatusChip>
    </Shell>
  );
}

function PaneLinkCard({ link, label }: { link: BoardLink; label: ReactNode }) {
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const pane = root?.agents.find((a) => a.paneId === link.id);
  if (!pane) return <Link to={link.path} className="text-primary underline underline-offset-2">{label}</Link>;
  return (
    <Shell to={link.path}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{paneDisplayName(pane)}</span>
        <span className="block truncate text-xs text-muted-foreground">{pane.workspaceLabel}</span>
      </span>
      <StatusBadge status={pane.status} />
    </Shell>
  );
}

/** Outside a router (a bare render) there is nothing to link into: the caller keeps its plain `<a>`. */
export function useCanLinkCards(): boolean {
  return useInRouterContext();
}

export function BoardLinkCard({ link, label }: { link: BoardLink; label: ReactNode }) {
  return link.kind === "card" ? <CardLinkCard link={link} label={label} /> : <PaneLinkCard link={link} label={label} />;
}
