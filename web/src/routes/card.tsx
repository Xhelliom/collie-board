import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Layers,
  Lock,
  Pencil,
  Play,
  Send,
  Shuffle,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { MarkdownText } from "@/components/markdown-text";
import { StatusBadge } from "@/components/status-badge";
import { StatusArea } from "@/components/status-area";
import { CardDiff } from "@/components/card-diff";
import { CardEditor } from "@/components/card-editor";
import { CardJournal, editedByHandSince } from "@/components/card-journal";
import { CardStatusChip } from "@/components/card-status-chip";
import { ContextGauge } from "@/components/context-gauge";
import { Switch } from "@/components/ui/switch";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import {
  boardPath,
  cardPath,
  CARD_STATUS_LABEL,
  boardErrorMessage,
  deleteCard,
  explainError,
  fetchIntegration,
  handoffCard,
  integrateCard,
  patchCard,
  promptCard,
  reformulateCard,
  revertCard,
  startCard,
  type CardInput,
  type BoardEvent,
  type CardLink,
  type CardSession,
  type CardStatus,
  type CardView,
  type Integration,
} from "@/lib/board";
import { dependencyMet, integrationHistory } from "@/lib/board-groups";
import type { CardData } from "@/lib/board-loaders";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";
import type { AgentStatus } from "@/lib/types";

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
  const [editing, setEditing] = useState(false);
  const [confirmRework, setConfirmRework] = useState(false);
  // Lifted out of <IntegrationSection> for one reason: "Done" must not be offered on its own while
  // the branch still holds commits. Filing first is the order everybody reaches for and it is the
  // broken one — it ends the session, so the agent that could settle a merge conflict is gone.
  const [integration, setIntegration] = useState<Integration | null | undefined>(undefined);

  const detail = data.detail;
  const card = detail?.card;

  // One <CardRoute /> serves every /card/:cardId, so this component is NOT remounted when you move
  // from one card to another — an armed confirmation would follow you to the next card and fire on
  // its first tap, which is the exact opposite of a guard.
  useEffect(() => setConfirmRework(false), [card?.id]);

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

  // Rethrows so the editor keeps the sheet open on failure — linking two cards can now fail for a
  // reason the user can act on ("that would make a loop"), where before a patch only failed if the
  // bridge was unreachable. Silence would look like a save that worked.
  async function save(patch: CardInput) {
    if (!card) return;
    try {
      await patchCard(card.id, patch);
    } catch (e) {
      setStatus((e as Error).message, "error", null);
      throw e;
    } finally {
      revalidator.revalidate();
    }
  }

  // Hand the card back to the copilot. Background, like on create — the card rewrites itself on a
  // later poll rather than holding the request open for an agent turn.
  async function reformulate() {
    if (!card) return;
    try {
      await reformulateCard(card.id);
      setStatus("Sent to the copilot — the card rewrites itself in a minute.", "info");
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
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
              {/* Where this card came from. A sub-task's spec is an extract of a dictation that
                  lives on its container — without a way back, that context is unreachable. */}
              {detail?.parent && (
                <button
                  type="button"
                  onClick={() => navigate(cardPath(detail.parent!.id))}
                  className="flex min-w-0 items-center gap-1 self-start text-xs text-muted-foreground"
                >
                  <Layers className="size-3 shrink-0" />
                  <span className="truncate">{detail.parent.title}</span>
                </button>
              )}
              <h1 className="text-lg font-semibold leading-tight">{card.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <CardStatusChip status={card.status}>
                  {CARD_STATUS_LABEL[card.status]}
                </CardStatusChip>
                {card.runtime && <StatusBadge status={card.runtime.agentStatus} />}
                {/* A container never gets checked out, so a branch name on it is a promise nothing
                    keeps. The copilot withholds one when IT splits a card, but a card that became a
                    container by hand-linking children afterwards keeps whatever it already had —
                    and clearing that is not safe, since it may name a real worktree from before. */}
                {card.branch && !detail?.children.length && (
                  <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    <GitBranch className="size-3" />
                    {card.branch}
                  </span>
                )}
              </div>
            </header>

            <LivePane card={card} onOpen={(paneId) => navigate(panePath(paneId, root?.session))} />

            <ContextGauge pct={card.session?.ctxPct} tokens={card.session?.ctxTokens} />

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
              <StartButton
                card={card}
                pending={starting}
                onStart={start}
                predecessor={detail?.predecessor}
                childCount={detail?.children.length}
              />
            )}

            {detail && detail.children.length > 0 && (
              <Section label="Sub-tasks">
                <div className="flex flex-col gap-1">
                  {detail.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => navigate(cardPath(child.id))}
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left active:scale-[0.99]"
                    >
                      <CardStatusChip status={child.status} className="px-1.5" />
                      <span className="min-w-0 flex-1 truncate text-sm">{child.title}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Right under the title, because it is a question about THIS card's right to exist,
                and it has to be answerable before anyone reads the spec below it. */}
            {detail?.duplicate && (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  The copilot thinks this repeats a card you already have:
                </p>
                <button
                  type="button"
                  onClick={() => navigate(cardPath(detail.duplicate!.id))}
                  className="flex min-w-0 items-center gap-1 text-left text-sm underline underline-offset-4"
                >
                  <Copy className="size-3.5 shrink-0" />
                  <span className="truncate">{detail.duplicate.title}</span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-fit"
                  onClick={() => void save({ duplicateOf: null })}
                >
                  Not a duplicate
                </Button>
              </div>
            )}

            {/* Above the spec on purpose: this is usually the answer to "why is this card still a
                bare title", and that question is asked while looking at the empty space below. */}
            {card.copilotBusy && (
              <div className="flex animate-pulse items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 shrink-0" />
                <span>The copilot has this card — it rewrites itself in a minute.</span>
              </div>
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

            <Section label="Rework">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={() => {
                    // Reformulate re-reads the original dictation, so it discards a hand edit. Ask
                    // once when that is what would happen — a second tap, not a browser dialog,
                    // which on a PWA is both ugly and easy to dismiss by reflex.
                    if (!confirmRework && editedByHandSince(detail?.events ?? [])) {
                      setConfirmRework(true);
                      return;
                    }
                    setConfirmRework(false);
                    void reformulate();
                  }}
                >
                  <Sparkles className="size-4" />
                  {confirmRework ? "Replace my edits?" : "Reformulate"}
                </Button>
                {confirmRework && (
                  <Button variant="ghost" size="sm" className="h-9" onClick={() => setConfirmRework(false)}>
                    Cancel
                  </Button>
                )}
              </div>
              {confirmRework && (
                <p className="pt-2 text-xs text-muted-foreground">
                  It works from what you originally dictated, not from your edit. The current text
                  goes to the journal, so you can put it back.
                </p>
              )}
            </Section>

            <Section label="Move to">
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATUSES.filter((s) => s !== card.status)
                  .filter((s) => s !== "done" || !(integration && integration.ahead > 0))
                  .map((s) => (
                    <Button key={s} variant="outline" size="sm" className="h-9" onClick={() => move(s)}>
                      {CARD_STATUS_LABEL[s]}
                    </Button>
                  ))}
              </div>
              {integration && integration.ahead > 0 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Done sits below, with the merge — filing this card would send its agent away, and
                  that agent is who settles a merge conflict.
                </p>
              )}
            </Section>

            {card.branch && (
              <IntegrationSection
                card={card}
                events={detail?.events ?? []}
                onState={setIntegration}
                onDone={() => revalidator.revalidate()}
              />
            )}

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
                        <div className="flex flex-col gap-1">
                          {r.todos.map((todo, i) =>
                            todo.card ? (
                              <button
                                key={todo.card.id}
                                type="button"
                                onClick={() => navigate(cardPath(todo.card!.id))}
                                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left active:scale-[0.99]"
                              >
                                <CardStatusChip status={todo.card.status} className="px-1.5" />
                                <span className="min-w-0 flex-1 truncate text-sm">{todo.card.title}</span>
                                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                              </button>
                            ) : (
                              // Deleted since — the title is what's left to show.
                              <div
                                key={i}
                                className="truncate rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground line-through"
                              >
                                {todo.title}
                              </div>
                            ),
                          )}
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
                <CardJournal
                  events={detail.events}
                  onRestore={async (eventId) => {
                    try {
                      await revertCard(card.id, eventId);
                      setStatus("Restored", "success");
                    } catch (e) {
                      setStatus((e as Error).message, "error", null);
                    }
                    revalidator.revalidate();
                  }}
                />
              </Section>
            )}

            <DangerZone cardId={card.id} onDelete={remove} />
          </>
        )}
      </div>

      {card && (
        <CardEditor card={card} open={editing} onClose={() => setEditing(false)} onSave={save} />
      )}

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
  predecessor,
  childCount,
}: {
  card: CardView;
  pending: boolean;
  onStart: () => void;
  /** The card this one follows, from the detail response — finished or not. */
  predecessor?: CardLink | null;
  /** How many sub-tasks this card holds — non-zero makes it a container. */
  childCount?: number;
}) {
  if (card.status === "done" || card.status === "archived") return null;
  const relaunch = card.sessionCount > 0;

  // The two refusals the bridge would answer with (`container`, `blocked-by`), said here instead.
  // Both are knowable before the tap, and on a phone a 409 you could have foreseen is a round trip
  // for nothing. The wording is the server's reasoning, not a generic "not allowed".
  if (childCount) {
    return (
      <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
        This card holds {childCount} sub-task{childCount === 1 ? "" : "s"} — the work is in those.
        Start one of them.
      </p>
    );
  }
  if (predecessor && !dependencyMet(predecessor)) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0" />
        <span>
          Waiting on <span className="text-foreground">“{predecessor.title}”</span> to finish. It
          starts on that branch, so it needs the work first.
        </span>
      </p>
    );
  }
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
/**
 * One tick of the "resolve" watch: given whether we're still waiting on the agent, whether we've
 * already seen it take a turn, and its current status, decide what to remember and whether this is
 * the edge — working/blocked, THEN not — that means the turn is over and it's time to re-read the
 * integration state.
 *
 * Pure so the edge detection is reviewable and testable without rendering the component: getting it
 * wrong either fires on the wrong tick (reads a half-finished commit) or never fires at all (the
 * operator is back to remembering to check by hand, the exact friction this exists to remove).
 */
export function resolveWatchStep(
  awaitingResolve: boolean,
  sawAgentTurn: boolean,
  status: AgentStatus | undefined,
): { sawAgentTurn: boolean; refresh: boolean } {
  if (!awaitingResolve) return { sawAgentTurn: false, refresh: false };
  if (status === "working" || status === "blocked") return { sawAgentTurn: true, refresh: false };
  return { sawAgentTurn: false, refresh: sawAgentTurn };
}

/**
 * What happens to the branch once the work is done: merge it, open a PR, hand a conflict back to the
 * agent, or clean the whole thing up.
 *
 * Loaded ON DEMAND, never with the polled card loader: every field here costs git subprocesses, and
 * the card screen re-reads itself every 1.5 s. Re-read after each action instead — the actions are
 * the only thing that changes any of it, apart from the agent committing, which is what the manual
 * refresh is for.
 */
function IntegrationSection({
  card,
  events,
  onDone,
  onState,
}: {
  card: CardView;
  events: readonly BoardEvent[];
  onDone: () => void;
  onState: (state: Integration | null | undefined) => void;
}) {
  const [state, setState] = useState<Integration | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [awaitingResolve, setAwaitingResolve] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [unexplained, setUnexplained] = useState<{ action: string; error: string } | null>(null);
  const { confirm, pending } = usePendingConfirm();

  // What the journal remembers, which outlives the branch. A merged-and-cleaned-up card has nothing
  // left for git to answer about, and "done" alone never said whether the code actually landed.
  const past = integrationHistory(events);
  const history =
    past.merged || past.pr || past.cleanedUp || past.discarded ? (
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {past.merged && (
          <span>
            Merged into {past.merged.base} · {timeAgo(past.merged.ts)}
          </span>
        )}
        {past.pr && (
          <span>
            PR opened {timeAgo(past.pr.ts)}
            {past.pr.url && (
              <>
                {" — "}
                <a href={past.pr.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  view on GitHub
                </a>
              </>
            )}
          </span>
        )}
        {/* Second-hand evidence, and worth saying so: cleanup is refused unless nothing was left to
            integrate, so it landed even when the merge itself happened outside the board. */}
        {past.cleanedUp && !past.merged && (
          <span>Worktree cleaned up {timeAgo(past.cleanedUp)} — the branch was fully integrated.</span>
        )}
        {past.cleanedUp && past.merged && <span>Worktree cleaned up · {timeAgo(past.cleanedUp)}</span>}
        {past.discarded && (
          <span>
            Discarded {timeAgo(past.discarded.ts)} — {past.discarded.commits} commit
            {past.discarded.commits === 1 ? "" : "s"} thrown away.
          </span>
        )}
      </div>
    ) : null;

  const load = useCallback(async () => {
    let next: Integration | null = null;
    try {
      next = (await fetchIntegration(card.id)).integration;
    } catch {
      // A card whose repo has moved under us still has to render; the section simply says nothing.
    }
    setState(next);
    onState(next);
  }, [card.id, onState]);

  useEffect(() => {
    void load();
  }, [load]);

  // Once "resolve" is sent, the actual merge commit lands seconds or minutes later, in the agent's
  // own time — nothing here waits for it. Rather than leave the operator to remember to come back and
  // recheck, this watches the SAME live `agentStatus` the polling loop already refreshes: the turn
  // that follows a resolve request ends when the agent stops working, so that edge is the honest
  // signal to re-read the integration state. No new poll, no timer — riding the one the page already
  // has.
  const sawAgentTurn = useRef(false);
  useEffect(() => {
    const step = resolveWatchStep(awaitingResolve, sawAgentTurn.current, card.runtime?.agentStatus);
    sawAgentTurn.current = step.sawAgentTurn;
    if (step.refresh) {
      setAwaitingResolve(false);
      void load();
    }
  }, [card.runtime?.agentStatus, awaitingResolve, load]);

  async function run(
    action: "merge" | "pr" | "resolve" | "cleanup" | "discard",
    label: string,
    andDone = false,
  ) {
    setBusy(action);
    try {
      const res = await integrateCard(card.id, action, andDone);
      setConflict(false);
      if (action === "resolve") setAwaitingResolve(true);
      setStatus(
        action === "pr" && res.url
          ? `PR opened — ${res.url}`
          : action === "resolve"
            ? "Sent to the agent — this section refreshes on its own once it's done."
            : `${label} done.`,
        "success",
      );
      onDone();
    } catch (e) {
      // A conflict is the one failure with a next step, so the button for it appears here.
      const message = boardErrorMessage(e);
      setConflict(/conflict/i.test(message));
      // Raw git/herdr text is the only kind worth an agent turn: our own refusals are already
      // sentences aimed at a person. `boardErrorMessage` keeps the body, so the kind is in it.
      const raw = e instanceof Error && /"kind":"(git|herdr)"/.test(e.message);
      setUnexplained(raw ? { action, error: message } : null);
      setStatus(message, "error", null);
    } finally {
      setBusy(null);
      void load();
    }
  }

  // Off by default: once the card's wrapup settles, `WrapupCoordinator` cleans up the worktree on its
  // own — same refusals as the manual tap, just without waiting for it. Set here rather than only
  // shown next to the button below: the operator needs to flip it BEFORE that happens, which can be
  // any time after the card is filed, not only while looking at a branch that is already merged.
  async function toggleKeepWorktree(keep: boolean) {
    try {
      await patchCard(card.id, { keepWorktree: keep });
      onDone();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  if (state === undefined) return null;
  if (state === null) {
    return (
      <Section label="Integration">
        {history ?? <p className="text-xs text-muted-foreground">No branch to integrate.</p>}
      </Section>
    );
  }

  const merged = state.ahead === 0;
  // Only what genuinely stops a merge. `baseDirty` deliberately isn't here: git merges over
  // uncommitted changes it doesn't touch, and refuses by itself when it would — see refusalFor.
  const mergeBlocker = !state.baseCheckedOut ? `the repository is not on ${state.base}` : null;
  // A card that is not filed yet gets the combined gesture. Once it IS done, the same buttons stay
  // for the case this exists to make rare: filed first, integrated afterwards.
  const filing = card.status !== "done" && card.status !== "archived";
  return (
    <Section label="Integration">
      <div className="flex flex-col gap-3">
        {history}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{state.branch}</span>
          <span>→</span>
          <span className="font-mono">{state.base}</span>
          <span>
            ·{" "}
            {merged
              ? `already in ${state.base}`
              : `${state.ahead} commit${state.ahead === 1 ? "" : "s"} not in ${state.base}`}
          </span>
          {state.behind > 0 && <span>· {state.behind} behind</span>}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Keep this worktree</div>
            <p className="text-xs text-muted-foreground">
              Off by default — once this card is done, the worktree and branch are removed
              automatically as soon as the closing report is collected.
            </p>
          </div>
          <Switch
            checked={card.keepWorktree}
            disabled={busy !== null}
            onCheckedChange={(checked) => void toggleKeepWorktree(checked)}
            aria-label="Keep this worktree"
          />
        </div>

        {/* Loudest thing here when true: the card's diff shows this work, but no merge will take it. */}
        {state.branchDirty && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Uncommitted work in the card's checkout — commit it from the agent's pane, or it will not
            be integrated.
          </p>
        )}

        {/* Both of these are refusals the client can see coming. Saying them here rather than
            letting the button fail is the difference between "not yet, because X" and an error. */}
        {!merged && !state.branchDirty && mergeBlocker && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {mergeBlocker} — a PR still works.
          </p>
        )}

        {/* A warning, not a blocker: it only matters if the merge touches the same files, and git
            is the one that knows. Said here so a refusal afterwards is not a surprise. Gated on
            baseCheckedOut — `baseDirty` reads the checkout AS IT STANDS, not a checkout of
            `state.base` specifically, so when the two disagree this would name the wrong branch
            (mergeBlocker already explains that case). */}
        {!merged && state.baseCheckedOut && state.baseDirty && (
          <p className="text-xs text-muted-foreground">
            {state.base} has uncommitted changes. The merge goes through unless it touches the same
            files — git checks before changing anything.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            disabled={busy !== null || merged || state.branchDirty || mergeBlocker !== null}
            onClick={() => void run("merge", `Merged into ${state.base}`, filing)}
          >
            <GitMerge className="size-4" />
            {busy === "merge" ? "Merging…" : filing ? `Merge into ${state.base} & done` : `Merge into ${state.base}`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            disabled={busy !== null || merged || state.branchDirty}
            onClick={() => void run("pr", "Pull request opened", filing)}
          >
            <GitPullRequest className="size-4" />
            {busy === "pr" ? "Opening…" : filing ? "Open a PR & done" : "Open a PR"}
          </Button>
        </div>

        {/* Shown only for text we relayed verbatim from git or herdr. Off when the copilot is,
            because it costs an agent turn of the user's own quota. */}
        {unexplained && card.copilotBusy === false && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-fit gap-2"
            onClick={() => {
              const asked = unexplained;
              setUnexplained(null);
              explainError(card.id, asked)
                .then(() => setStatus("Asked the copilot — the answer lands in the journal.", "info"))
                .catch((e) => setStatus(boardErrorMessage(e), "error", null));
            }}
          >
            <Sparkles className="size-4" />
            What does this mean?
          </Button>
        )}

        {/* Shown from the moment "resolve" is sent until the agent's turn ends — see the effect above.
            No button here: the point is exactly that there is nothing left to tap yet. */}
        {awaitingResolve && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            The agent is resolving the conflict — this refreshes on its own once it's done. Come back
            and tap merge again.
          </p>
        )}

        {conflict && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Nothing was changed in {state.base}. The agent can settle this on its own branch, then
              the merge goes through.
            </p>
            {/* A filed card has no agent any more — its session ended when it was filed. Offering
                "let the agent resolve it" there is offering a button that answers 409, so the honest
                one is the button that brings an agent back. It spends quota, so it stays a tap. */}
            {card.session?.paneId ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-fit gap-2"
                disabled={busy !== null}
                onClick={() => void run("resolve", "Sent to the agent")}
              >
                <Sparkles className="size-4" />
                {busy === "resolve" ? "Sending…" : "Let the agent resolve it"}
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  This card has no running agent — start it again and it will pick the task up from
                  its handoff, conflict included.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-fit gap-2"
                  disabled={busy !== null || restarting}
                  onClick={() => {
                    setRestarting(true);
                    startCard(card.id)
                      .then(() => setStatus("Agent started — hand it the conflict once it is up.", "success"))
                      .catch((e) => setStatus(boardErrorMessage(e), "error", null))
                      .finally(() => {
                        setRestarting(false);
                        onDone();
                      });
                  }}
                >
                  <Play className="size-4" />
                  {restarting ? "Starting…" : "Start the agent again"}
                </Button>
              </>
            )}
          </div>
        )}

        {merged ? (
          <div className="flex flex-col gap-2">
            {/* The backend refuses this too (`wrapupGate`), but saying so BEFORE the tap beats a
                surprise error: `session` is already null on a filed card, so without this the screen
                has nothing else to show that a note is still being written into the checkout this
                button is about to delete. */}
            {card.wrapupPending && (
              <p className="text-xs text-muted-foreground">
                The agent is still writing its closing report — cleaning up now would lose it. Wait
                for it to finish.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-fit gap-2 text-destructive"
              disabled={busy !== null || card.wrapupPending}
              onClick={() => {
                if (!confirm("cleanup")) return;
                void run("cleanup", "Worktree removed");
              }}
            >
              <Trash2 className="size-4" />
              {pending === "cleanup" ? "Remove the worktree and branch?" : "Clean up worktree"}
            </Button>
          </div>
        ) : (
          /* The one gesture here that destroys work. It says exactly what it is about to lose —
             a count you can check against the diff above — and takes a second tap to mean it. */
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-fit gap-2 text-destructive"
            disabled={busy !== null}
            onClick={() => {
              if (!confirm("discard")) return;
              void run("discard", "Discarded");
            }}
          >
            <Trash2 className="size-4" />
            {pending === "discard"
              ? `Throw away ${state.ahead} commit${state.ahead === 1 ? "" : "s"}${state.branchDirty ? " and uncommitted work" : ""}?`
              : "Discard this work"}
          </Button>
        )}
      </div>
    </Section>
  );
}

/**
 * Delete. The card's one irreversible gesture — the journal goes with it — so it asks the same two
 * taps as every lesser destructive action here (Kill, /clear, worktree cleanup), through the same
 * hook, and disarms itself after 3 s.
 *
 * Armed under the card's own id: this page is not remounted from one card to the next, and an armed
 * confirm carried over would fire on the next card's first tap — the opposite of a guard.
 */
export function DangerZone({ cardId, onDelete }: { cardId: string; onDelete: () => void }) {
  const { confirm, pending } = usePendingConfirm();
  return (
    <Section label="Danger zone">
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2 text-destructive"
        onClick={() => {
          if (!confirm(cardId)) return;
          onDelete();
        }}
      >
        <Trash2 className="size-4" />
        {pending === cardId ? "Delete for good — no undo?" : "Delete card"}
      </Button>
    </Section>
  );
}

/** The disclosure label for a session's note. Pure, so the wording is pinned by a test. */
export function noteLabel(open: boolean, closing: boolean): string {
  const what = closing ? "closing report" : "handoff note";
  return open ? `Hide ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

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
        {session.handoffRequestedAt != null &&
          (session.endedAt === null ? " · handoff pending" : " · closing report pending")}
      </div>
      {session.handoffMd && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="self-start text-xs underline underline-offset-4"
          >
            {/* Same column, two different documents: a note written FOR the next agent, and the
                report an agent writes when the operator files the card. */}
            {noteLabel(open, session.outcome === "done")}
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

