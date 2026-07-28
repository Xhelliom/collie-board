import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { ArrowLeft, GitBranch, TerminalSquare, Trash2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { MarkdownText } from "@/components/markdown-text";
import { StatusBadge } from "@/components/status-badge";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import {
  boardPath,
  CARD_STATUS_CHIP,
  CARD_STATUS_LABEL,
  deleteCard,
  patchCard,
  type CardSession,
  type CardStatus,
  type CardView,
} from "@/lib/board";
import type { CardData } from "@/lib/board-loaders";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { cn } from "@/lib/utils";

// A card's own page: the durable half (spec, acceptance, history) beside the live half (which pane
// is on it right now, and what that agent is doing). This is the screen that answers "where is this
// task, and what happened in the sessions before this one" — the question Collie's pane mirror
// structurally cannot.

/** Columns a human moves a card into by hand. The rest are driven by the herd, so they aren't offered. */
const MANUAL_STATUSES: CardStatus[] = ["backlog", "ready", "done", "archived"];

export function CardRoute() {
  const data = useLoaderData() as CardData;
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const stalled = useLoadingStalled();

  const detail = data.detail;
  const card = detail?.card;

  async function move(status: CardStatus) {
    if (!card) return;
    await patchCard(card.id, { status });
    revalidator.revalidate();
  }

  async function remove() {
    if (!card) return;
    await deleteCard(card.id);
    navigate(boardPath());
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader
        bridge={root?.bridge}
        error={root?.error ?? data.error}
        stalled={stalled}
        onHome={() => navigate(boardPath())}
      >
        <button
          type="button"
          onClick={() => navigate(boardPath())}
          className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">Board</span>
        </button>
      </AppHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-24 pt-3">
        {!card ? (
          <p className="px-1 py-12 text-center text-sm text-muted-foreground">
            {data.error ? "Can't reach the board right now." : "Card not found."}
          </p>
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-lg font-semibold leading-tight">{card.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    CARD_STATUS_CHIP[card.status],
                  )}
                >
                  {CARD_STATUS_LABEL[card.status]}
                </span>
                {card.runtime && <StatusBadge status={card.runtime.agentStatus} />}
                {card.branch && (
                  <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    <GitBranch className="size-3" />
                    {card.branch}
                  </span>
                )}
              </div>
            </header>

            <LivePane card={card} onOpen={(paneId) => navigate(panePath(paneId, root?.session))} />

            {card.spec && (
              <Section label="Spec">
                <MarkdownText text={card.spec} />
              </Section>
            )}

            {card.acceptance.length > 0 && (
              <Section label="Acceptance">
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {card.acceptance.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label="Move to">
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATUSES.filter((s) => s !== card.status).map((s) => (
                  <Button key={s} variant="outline" size="sm" className="h-9" onClick={() => move(s)}>
                    {CARD_STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
            </Section>

            {detail && detail.sessions.length > 0 && (
              <Section label={`Sessions (${detail.sessions.length})`}>
                <div className="flex flex-col gap-2">
                  {detail.sessions.map((s, i) => (
                    <SessionRow key={s.id} session={s} index={i} />
                  ))}
                </div>
              </Section>
            )}

            {detail && detail.events.length > 0 && (
              <Section label="Journal">
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {detail.events.slice(0, 30).map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <span className="w-16 shrink-0 tabular-nums">{timeAgo(e.ts)}</span>
                      <span className="font-mono">{e.type}</span>
                      <span className="min-w-0 flex-1 truncate">{summarize(e.payload)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label="Danger zone">
              <Button variant="outline" size="sm" className="h-9 gap-2 text-destructive" onClick={remove}>
                <Trash2 className="size-4" />
                Delete card
              </Button>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

/** The card's live pane, when one is backing it. Tapping through is how you unblock the agent. */
function LivePane({ card, onOpen }: { card: CardView; onOpen: (paneId: string) => void }) {
  if (!card.runtime) {
    if (card.status === "orphaned") {
      return (
        <Card className="gap-1 rounded-xl px-3.5 py-3">
          <p className="text-sm font-medium">No pane</p>
          <p className="text-xs text-muted-foreground">
            The pane that worked on this card is gone. Its worktree and its last handoff are still on
            disk — the card can be picked up again.
          </p>
        </Card>
      );
    }
    return null;
  }
  return (
    <button type="button" onClick={() => onOpen(card.runtime!.paneId)} className="text-left">
      <Card className="flex-row items-center gap-3 rounded-xl px-3.5 py-3">
        <TerminalSquare className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{card.runtime.agent}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{card.runtime.cwd}</div>
        </div>
        <StatusBadge status={card.runtime.agentStatus} />
      </Card>
    </button>
  );
}

function SessionRow({ session, index }: { session: CardSession; index: number }) {
  return (
    <Card className="gap-1 rounded-xl px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">#{index + 1}</span>
        <span className="font-mono text-xs text-muted-foreground">{session.paneId ?? "—"}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {session.endedAt ? (session.outcome ?? "ended") : "running"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        started {timeAgo(session.startedAt)}
        {session.ctxPct != null && ` · ctx ${Math.round(session.ctxPct)}%`}
      </div>
    </Card>
  );
}

/** One-line gist of a journal payload — never markup, always a text node. */
function summarize(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return String(payload);
  return Object.entries(payload as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}
