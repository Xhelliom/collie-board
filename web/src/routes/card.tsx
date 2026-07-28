import { useState, type ReactNode } from "react";
import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { ArrowLeft, GitBranch, Play, Send, Shuffle, TerminalSquare, Trash2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { MarkdownText } from "@/components/markdown-text";
import { StatusBadge } from "@/components/status-badge";
import { StatusArea } from "@/components/status-area";
import { CardDiff } from "@/components/card-diff";
import { ContextGauge } from "@/components/context-gauge";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import {
  boardPath,
  CARD_STATUS_CHIP,
  CARD_STATUS_LABEL,
  deleteCard,
  handoffCard,
  patchCard,
  promptCard,
  startCard,
  type CardSession,
  type CardStatus,
  type CardView,
} from "@/lib/board";
import type { CardData } from "@/lib/board-loaders";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";
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
  const [starting, setStarting] = useState(false);

  const detail = data.detail;
  const card = detail?.card;

  async function move(status: CardStatus) {
    if (!card) return;
    await patchCard(card.id, { status });
    revalidator.revalidate();
  }

  // Start is the one action with real latency: herdr creates a worktree, launches the agent and
  // waits for its TUI to be interactively ready before the request returns (tens of seconds is
  // normal). So it holds a local pending state rather than relying on the poll to notice.
  async function start() {
    if (!card || starting) return;
    setStarting(true);
    setStatus("Creating the worktree and starting the agent…", "info", null);
    try {
      await startCard(card.id);
      setStatus("Agent started", "success");
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    } finally {
      setStarting(false);
      revalidator.revalidate();
    }
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

            <ContextGauge session={card.session} />

            {card.runtime ? (
              <>
                <PromptBox
                  onSend={async (text) => {
                    await promptCard(card.id, text);
                    setStatus("Sent", "success");
                    revalidator.revalidate();
                  }}
                />
                <HandoffButton
                  card={card}
                  onHandoff={async () => {
                    try {
                      await handoffCard(card.id);
                      setStatus("Handoff asked for — the card swaps sessions when the note lands.", "info");
                    } catch (e) {
                      setStatus((e as Error).message, "error", null);
                    }
                    revalidator.revalidate();
                  }}
                />
              </>
            ) : (
              <StartButton card={card} pending={starting} onStart={start} />
            )}

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

            <CardDiff cardId={card.id} statusKey={card.status} />

            <Section label="Move to">
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATUSES.filter((s) => s !== card.status).map((s) => (
                  <Button key={s} variant="outline" size="sm" className="h-9" onClick={() => move(s)}>
                    {CARD_STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
            </Section>

            {detail && detail.reviews.length > 0 && (
              <Section label="Review">
                <div className="flex flex-col gap-2">
                  {detail.reviews.map((r) => (
                    <Card key={r.id} className="gap-2 rounded-xl px-3.5 py-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium capitalize">{r.verdict ?? "reviewed"}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                      </div>
                      {r.notes && <MarkdownText text={r.notes} />}
                      {r.todos.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {r.todos.length} follow-up{r.todos.length === 1 ? "" : "s"} added to the backlog
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </Section>
            )}

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

      {/* The app's one status surface — start/prompt failures land here rather than in a dialog. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)]">
        <StatusArea />
      </div>
    </div>
  );
}

/**
 * Start / relaunch. One tap creates the worktree, opens the workspace, launches the agent and sends
 * the spec — the whole point of Phase 2 is that this needs no keyboard.
 *
 * A card with no repo path can't be started (the bridge would refuse anyway), so say so here rather
 * than letting the tap fail: on a phone, an error you could have prevented is a wasted round trip.
 */
function StartButton({
  card,
  pending,
  onStart,
}: {
  card: CardView;
  pending: boolean;
  onStart: () => void;
}) {
  if (card.status === "done" || card.status === "archived") return null;
  const relaunch = card.sessionCount > 0;
  if (!card.repoPath) {
    return (
      <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
        Set a repo path on this card to start an agent on it.
      </p>
    );
  }
  return (
    <Button onClick={onStart} disabled={pending} className="h-12 w-full gap-2">
      <Play className="size-4" />
      {pending ? "Starting…" : relaunch ? "Relaunch on this branch" : "Start agent"}
    </Button>
  );
}

/**
 * A follow-up instruction for the card's running agent. A plain textarea on purpose: that box IS
 * the phone's voice input, and Send is explicit so dictated text is reviewable before it goes —
 * the same reasoning as Collie's composer (ARCHITECTURE §4).
 */
function PromptBox({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setText("");
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Extra instruction for this agent…"
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button onClick={send} disabled={!text.trim() || sending} className="h-11 gap-2 self-end px-5">
        <Send className="size-4" />
        {sending ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
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

/**
 * One link in the handoff chain. The note is the point of the whole feature — it is what a session
 * knew that the diff can't show — so it is readable in place, collapsed by default so a three-session
 * card still fits on a phone screen.
 */
function SessionRow({ session, index }: { session: CardSession; index: number }) {
  const [open, setOpen] = useState(false);
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
        {session.handoffRequestedAt != null && session.endedAt === null && " · handoff pending"}
      </div>
      {session.handoffMd && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="self-start text-xs underline underline-offset-4"
          >
            {open ? "Hide handoff note" : "Handoff note"}
          </button>
          {open && (
            <div className="mt-1 rounded-lg border bg-background p-2">
              <MarkdownText text={session.handoffMd} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Hand this session off to a fresh one. Semi-automatic by design: the gauge can nudge (the button
 * goes prominent past the threshold) but a handoff fired mid-refactor costs more than it saves, so
 * the decision is always this tap.
 */
function HandoffButton({ card, onHandoff }: { card: CardView; onHandoff: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const requested = card.session?.handoffRequestedAt != null;
  const worthIt = (card.session?.ctxPct ?? 0) >= 70;

  if (requested) {
    return (
      <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
        Handoff asked for. The card swaps to a fresh session once the agent has written its note.
      </p>
    );
  }
  return (
    <Button
      variant={worthIt ? "default" : "outline"}
      onClick={async () => {
        setPending(true);
        try {
          await onHandoff();
        } finally {
          setPending(false);
        }
      }}
      disabled={pending}
      className="h-11 w-full gap-2"
    >
      <Shuffle className="size-4" />
      {pending ? "Asking…" : "Hand off to a fresh session"}
    </Button>
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
