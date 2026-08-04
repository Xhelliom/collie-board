import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLoaderData, useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownRight,
  EllipsisVertical,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GripVertical,
  Layers,
  Link2,
  Lock,
  Pencil,
  Play,
  Plus,
  Send,
  Shuffle,
  Sparkles,
  TerminalSquare,
  Trash2,
  Unlink,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BottomSheet } from "@/components/ui/sheet";
import { SectionLabel } from "@/components/ui/section-label";
import { MarkdownText } from "@/components/markdown-text";
import { StatusBadge } from "@/components/status-badge";
import { StatusArea } from "@/components/status-area";
import { CardDiff } from "@/components/card-diff";
import { CardEditor, LinkPicker } from "@/components/card-editor";
import { NonNominalPanel } from "@/components/non-nominal-panel";
import { CardJournal, editedByHandSince } from "@/components/card-journal";
import { CardStatusChip } from "@/components/card-status-chip";
import { ContextGauge } from "@/components/context-gauge";
import { CtxBar } from "@/components/ctx-bar";
import { TagChip } from "@/components/tag-chip";
import { Switch } from "@/components/ui/switch";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import {
  boardPath,
  cardPath,
  CARD_STATUS_LABEL,
  boardErrorMessage,
  createCard,
  deleteCard,
  explainError,
  fetchCards,
  fetchIntegration,
  handoffCard,
  integrateCard,
  MANUAL_STATUSES,
  patchCard,
  positionFor,
  promptCard,
  reformulateCard,
  repoName,
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
import { dependencyInfo, dependencyMet, integrationHistory } from "@/lib/board-groups";
import { ActionRow, DestructiveActionRow } from "@/components/action-sheet-rows";
import type { CardData } from "@/lib/board-loaders";
import { timeAgo } from "@/lib/format";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";
import { paneDisplayName, type AgentStatus } from "@/lib/types";

// A card's own page: the durable half (spec, acceptance, history) beside the live half (which pane
// is on it right now, and what that agent is doing). This is the screen that answers "where is this
// task, and what happened in the sessions before this one" — the question Collie's pane mirror
// structurally cannot.

export function CardRoute() {
  const data = useLoaderData() as CardData;
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRework, setConfirmRework] = useState(false);
  // Lifted out of <IntegrationSection> for one reason: "Done" must not be offered on its own while
  // the branch still holds commits. Filing first is the order everybody reaches for and it is the
  // broken one — it ends the session, so the agent that could settle a merge conflict is gone.
  const [integration, setIntegration] = useState<Integration | null | undefined>(undefined);

  const detail = data.detail;
  const card = detail?.card;

  // Full CardView objects for a container's sub-tasks — `detail.children` is only `CardLink[]` (id,
  // title, status), too thin for the dense row (tag, dependency, branch, ctx, drag position) the
  // redesign wants. Same fetch CardEditor's LinkPicker already does (`fetchCards()`, ETag-cached),
  // but here it rides the page's OWN poll: keyed on `data` (a new object every loader run), it
  // refetches each tick, because unlike a link picker's one-off choice this list IS the screen.
  const [boardCards, setBoardCards] = useState<CardView[]>([]);
  useEffect(() => {
    if (!card || !detail || detail.children.length === 0) return;
    let cancelled = false;
    void fetchCards()
      .then(({ cards }) => {
        if (!cancelled) setBoardCards(cards);
      })
      .catch(() => {
        // A failed refresh just leaves the list one tick stale — the next poll tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [data, card, detail]);
  const byId = new Map(boardCards.map((c) => [c.id, c]));
  const childCards = card
    ? boardCards
        .filter((c) => c.parentId === card.id)
        .sort((a, b) => a.position - b.position)
    : [];

  // One <CardRoute /> serves every /card/:cardId, so this component is NOT remounted when you move
  // from one card to another — an armed confirmation would follow you to the next card and fire on
  // its first tap, which is the exact opposite of a guard. Same reasoning for the "⋯" menu: it must
  // not carry over open.
  useEffect(() => {
    setConfirmRework(false);
    setMenuOpen(false);
  }, [card?.id]);

  async function move(status: CardStatus) {
    if (!card) return;
    await patchCard(card.id, { status });
    revalidator.revalidate();
  }

  // Sub-task management (redesign §4). New sub-task is a POST with the container's own repoPath/
  // baseRef pre-filled — title is the only field the operator supplies. "Lier" instead PATCHes an
  // EXISTING card's parentId; the bridge already refuses a link that would close a loop, so there is
  // no client-side graph walk here either (same rule LinkPicker's own doc comment states).
  async function newSubtask(title: string) {
    if (!card) return;
    try {
      await createCard({ title, parentId: card.id, repoPath: card.repoPath, baseRef: card.baseRef });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  async function linkExisting(childId: string) {
    if (!card) return;
    try {
      await patchCard(childId, { parentId: card.id });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  async function detach(childId: string) {
    try {
      await patchCard(childId, { parentId: null });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  // Reorder: the SAME fractional-rank trick board.tsx's drag uses, one dimension simpler — a
  // sub-task list has no `status` axis to cross, only a position within one list.
  async function reorderSubtask(childId: string, index: number) {
    const neighbours = childCards
      .filter((c) => c.id !== childId)
      .map((c) => c.position);
    try {
      await patchCard(childId, { position: positionFor(neighbours, index) });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  async function setSubtaskDependsOn(childId: string, dependsOn: string | null) {
    try {
      await patchCard(childId, { dependsOn });
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    }
    revalidator.revalidate();
  }

  // Unlike deleting the container itself (which leaves the board), deleting one of its sub-tasks
  // stays on this page — the container is still here, just with one fewer child.
  async function deleteSubtask(childId: string) {
    await deleteCard(childId);
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
    // This one KEEPS its ceiling while the board and the dashboard lost theirs, and that is the
    // whole point of not having a single "desktop width": the board is a spatial surface and wants
    // every pixel, this page is a document — spec, acceptance, journal — and a 2000px line of prose
    // is unreadable no matter how big the display is.
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm lg:max-w-6xl flex-1 flex-col">
      {/* An entered screen (reached from the board), so it gets the back chevron rather than the nav
          treatment. The breadcrumb (children) carries "Board › title"; Éditer + the "⋯" menu (which
          holds Danger zone — see the sheet below) are the toolbar's own controls. */}
      <AppHeader
        onBack={() => navigate(boardPath())}
        rightTrail={
          card && (
            <>
              <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Éditer
              </Button>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="More"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60"
              >
                <EllipsisVertical className="size-5" />
              </button>
            </>
          )
        }
      >
        <button
          type="button"
          onClick={() => navigate(boardPath())}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className="shrink-0 text-sm text-muted-foreground">Board</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {card?.title ?? ""}
          </span>
        </button>
      </AppHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-24 pt-3 lg:px-6 lg:pt-6">
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
              <div className="flex flex-wrap items-center gap-2">
                <CardStatusChip status={card.status}>
                  {CARD_STATUS_LABEL[card.status]}
                </CardStatusChip>
                {card.tag && <TagChip tag={card.tag} />}
                {card.runtime && <StatusBadge status={card.runtime.agentStatus} />}
              </div>
              {/* <repo> · <branch> — a container never gets checked out, so a branch name on it is a
                  promise nothing keeps. The copilot withholds one when IT splits a card, but a card
                  that became a container by hand-linking children afterwards keeps whatever it
                  already had — and clearing that is not safe, since it may name a real worktree from
                  before. */}
              {(card.repoPath || (card.branch && !detail?.children.length)) && (
                <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  {card.repoPath && <span className="truncate">{repoName(card.repoPath)}</span>}
                  {card.repoPath && card.branch && !detail?.children.length && <span>·</span>}
                  {card.branch && !detail?.children.length && (
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      <GitBranch className="size-3 shrink-0" />
                      {card.branch}
                    </span>
                  )}
                </div>
              )}
              <h1 className="max-w-[30ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">
                {card.title}
              </h1>
              {/* Same question the tile answers at a glance: "can I start this" without opening the
                  editor's "After" picker. Shown whether or not it's still blocking — met gets a quiet
                  green check rather than vanishing, so a satisfied dependency stays visible. */}
              {detail?.predecessor && (
                <button
                  type="button"
                  onClick={() => navigate(cardPath(detail.predecessor!.id))}
                  className={cn(
                    "flex min-w-0 items-center gap-1 self-start text-xs",
                    dependencyMet(detail.predecessor) ? "text-status-done" : "text-status-blocked",
                  )}
                >
                  {dependencyMet(detail.predecessor) ? (
                    <Check className="size-3 shrink-0" />
                  ) : (
                    <CornerDownRight className="size-3 shrink-0" />
                  )}
                  <span className="truncate">after “{detail.predecessor.title}”</span>
                </button>
              )}
            </header>

            {/* The card's two halves: what the card IS (spec, acceptance, what happened to it) and
                what is happening to it RIGHT NOW (its pane, its context budget, the box that talks
                to it). Document first, live state second — on a phone that is top-to-bottom, on
                `lg` it is the grid's two columns — the SAME `order` on both, not a `lg:`-only one:
                simpler than making mobile and desktop disagree about which half reads first. */}
            <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-7">
              {/* `empty:hidden` + an `auto` track, not a fixed one: a filed card has no pane, no
                  context gauge and no Start button, so this half renders NOTHING — and a reserved
                  340px of blank column next to the spec is worse than no column at all. */}
              <div className="flex min-w-0 flex-col gap-3.5 empty:hidden order-2 lg:w-[340px]">
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
              </div>

              <div className="flex min-w-0 flex-col gap-[22px] order-1">
                {detail && detail.children.length > 0 && (
                  <Section label="Sub-tasks">
                    <SubtaskList
                      container={card}
                      childCards={childCards}
                      byId={byId}
                      session={root?.session}
                      onOpen={(id) => navigate(cardPath(id))}
                      onReorder={reorderSubtask}
                      onNewSubtask={newSubtask}
                      onLinkExisting={linkExisting}
                      onDetach={detach}
                      onDependsOn={setSubtaskDependsOn}
                      onDelete={deleteSubtask}
                      linkable={boardCards.filter(
                        (c) => c.id !== card.id && c.parentId !== card.id && !c.parentId,
                      )}
                      dependsOnCandidates={boardCards.filter((c) => c.id !== card.id)}
                    />
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
                    <MarkdownText text={card.spec} className="max-w-[70ch] text-sm leading-[1.6]" />
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
                  {/* The container's own dictée d'origine — collapsed, because Spec/Acceptance above
                      it already show what the copilot DERIVED from it; this is the source, kept
                      reachable for the one question that matters here: what will Reformuler read
                      from. Only a container has this framing (a leaf card's spec IS its dictation). */}
                  {detail.children.length > 0 && card.rawInput && (
                    <details className="mb-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">
                        Dictée d'origine
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap">{card.rawInput}</p>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
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
                      {detail.children.length > 0
                        ? "It works from the original dictation, not from the current sub-tasks — reformulating can reshuffle or replace them."
                        : "It works from what you originally dictated, not from your edit. The current text goes to the journal, so you can put it back."}
                    </p>
                  )}
                </Section>

                <Section label="Classer">
                  <div className="flex flex-wrap gap-2">
                    {MANUAL_STATUSES.filter((s) => s !== card.status)
                      .filter((s) => s !== "done" || !(integration && integration.ahead > 0))
                      .map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-full"
                          onClick={() => move(s)}
                        >
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
                  <Section label="Chaîne de sessions">
                    <div className="flex flex-col">
                      {detail.sessions.map((s, i) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          index={i}
                          last={i === detail.sessions.length - 1}
                        />
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
              </div>
            </div>
          </>
        )}
      </div>

      {/* The toolbar's "⋯" — one destructive action doesn't need its own always-visible section
          taking up the bottom of the document; a menu is where a rare, dangerous action belongs. */}
      {card && (
        <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Card">
          <DangerZone cardId={card.id} onDelete={remove} />
        </BottomSheet>
      )}

      {card && (
        <CardEditor card={card} open={editing} onClose={() => setEditing(false)} onSave={save} />
      )}

      {/* The app's one status surface — start/prompt failures land here rather than in a dialog. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm lg:max-w-6xl px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)]">
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
        <NonNominalPanel tone="unknown" title="Carte orpheline">
          Le pane a disparu. La worktree et le dernier handoff sont toujours là — la carte peut être
          reprise.
        </NonNominalPanel>
      );
    }
    return null;
  }
  // The same medium-card language the dashboard uses (agent-card.tsx's WorkingCard) — a live pane
  // is a live pane, wherever it's shown. cwd is dropped, as everywhere else now: the workspace says
  // where well enough.
  return (
    <button
      type="button"
      onClick={() => onOpen(card.runtime!.paneId)}
      className="text-left transition-transform active:scale-[0.99]"
    >
      <Card className="flex-row items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-muted/40">
        <AgentIcon agent={card.runtime.agent} className="size-[26px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{paneDisplayName(card.runtime)}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {card.runtime.workspaceLabel}
          </div>
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
      <Section label="Intégration">
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
    <Section label="Intégration">
      <div className="flex flex-col gap-3">
        {history}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <span>{state.branch}</span>
            <span>→</span>
            <span>{state.base}</span>
          </div>
          <div className="text-[13px] text-muted-foreground">
            {merged ? (
              `already in ${state.base}`
            ) : (
              <>
                <span className="font-semibold tabular-nums">{state.ahead}</span> commit
                {state.ahead === 1 ? "" : "s"} not in {state.base}
              </>
            )}
            {state.behind > 0 && ` · ${state.behind} behind`}
          </div>
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

        {/* Loudest thing here when true: the card's diff shows this work, but no merge will take it.
            Every foreseeable refusal is stated BEFORE the button, in the same dashed tinted note, and
            the button it blocks renders faded (see the merge/PR buttons below). */}
        {state.branchDirty && (
          <p className="rounded-lg border border-dashed border-status-working/45 bg-status-working/10 px-3 py-2 text-xs text-status-working">
            Uncommitted work in the card's checkout — commit it from the agent's pane, or it will not
            be integrated.
          </p>
        )}

        {/* Both of these are refusals the client can see coming. Saying them here rather than
            letting the button fail is the difference between "not yet, because X" and an error. */}
        {!merged && !state.branchDirty && mergeBlocker && (
          <p className="rounded-lg border border-dashed border-status-working/45 bg-status-working/10 px-3 py-2 text-xs text-status-working">
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

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="h-[38px] w-full gap-2 rounded-[10px] disabled:opacity-45"
            disabled={busy !== null || merged || state.branchDirty || mergeBlocker !== null}
            onClick={() => void run("merge", `Merged into ${state.base}`, filing)}
          >
            <GitMerge className="size-4" />
            {busy === "merge" ? "Merging…" : filing ? `Merge into ${state.base} & done` : `Merge into ${state.base}`}
          </Button>
          <Button
            variant="outline"
            className="h-[38px] w-full gap-2 rounded-[10px] disabled:opacity-45"
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
              className="h-[38px] w-full gap-2 rounded-[10px] border-destructive/40 text-destructive"
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
            className="h-[38px] w-full gap-2 rounded-[10px] border-destructive/40 text-destructive"
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

/**
 * One link in the chain, on the vertical timeline: a 26px gutter carries the session's own agent
 * icon with a connecting line down to the next link, the details sit to its right. The handoff note
 * — what a session knew that the diff can't show, the whole reason the chain exists — renders ALWAYS
 * visible now, not behind a disclosure: it used to take a tap to even see whether there was one.
 */
function SessionRow({
  session,
  index,
  last,
}: {
  session: CardSession;
  index: number;
  /** The most recent session — its line stops here instead of running into empty space below. */
  last: boolean;
}) {
  const running = session.endedAt === null;
  const outcome = running ? "running" : (session.outcome ?? "ended");
  return (
    <div className="flex gap-3">
      <div className="flex w-[26px] shrink-0 flex-col items-center">
        {session.agentKind ? (
          <AgentIcon agent={session.agentKind} className="size-[22px] shrink-0" />
        ) : (
          <div className="size-[22px] shrink-0 rounded-full border bg-muted" />
        )}
        {!last && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold">Session {index + 1}</span>
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.06em]",
              running ? "text-status-working" : "text-muted-foreground",
            )}
          >
            {outcome}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {session.ctxPct != null && (
            <span className="flex items-center gap-1.5">
              <CtxBar pct={session.ctxPct} />
              ctx {Math.round(session.ctxPct)}%
            </span>
          )}
          <span>{timeAgo(session.startedAt)}</span>
          {session.handoffRequestedAt != null && (
            <span>{session.endedAt === null ? "handoff pending" : "closing report pending"}</span>
          )}
        </div>
        {session.handoffMd && (
          <div className="mt-2 rounded-xl border-l-2 border-border/70 bg-card/70 px-2.5 py-2 text-xs leading-[1.55]">
            {/* Same column, two different documents: a note written FOR the next agent, and the
                report an agent writes when the operator files the card. */}
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {noteLabel(false, session.outcome === "done")}
            </div>
            <MarkdownText text={session.handoffMd} />
          </div>
        )}
      </div>
    </div>
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

// ── Sub-task management (redesign §4) ───────────────────────────────────────────────────────────
//
// A container is a card with children; `startCard` refuses it, so everything actionable is per
// child — this whole section is that: a progress bar the parent owns, a dense reorderable row list,
// and the add/link/detach/depends-on/delete actions each row's "⋯" carries.

/** The dot colour for EVERY status (not just loud/named — a dense row needs one for ready/backlog/
 *  done too), matching the tones CardTile and CARD_STATUS_CHIP already use. */
const CARD_DOT: Record<CardStatus, string> = {
  blocked: "bg-status-blocked",
  orphaned: "bg-status-unknown",
  working: "bg-status-working",
  starting: "bg-status-working",
  review: "bg-status-done",
  ready: "bg-status-idle",
  backlog: "bg-muted-foreground/50",
  done: "bg-status-idle",
  archived: "bg-muted-foreground/50",
};

/** Segments in flow order; `ready`/`backlog` render dim so the bar reads as PROGRESS, not a census. */
const PROGRESS_STATUSES: readonly CardStatus[] = [
  "done",
  "review",
  "blocked",
  "working",
  "starting",
  "orphaned",
  "ready",
  "backlog",
];
const PROGRESS_TONE: Record<CardStatus, string> = {
  done: "bg-status-idle",
  review: "bg-status-done",
  blocked: "bg-status-blocked",
  working: "bg-status-working",
  starting: "bg-status-working",
  orphaned: "bg-status-unknown",
  ready: "bg-muted-foreground/25",
  backlog: "bg-muted-foreground/25",
  archived: "bg-muted-foreground/25",
};

/** `<done> / <total> terminées`, then the flow-ordered progress bar, then — only when at least one
 *  child is blocked — a right-aligned "1 attend une réponse" (the copy is the whole point: a bar
 *  alone doesn't say WHO needs you, it says how much is left). */
export function SubtaskProgress({ cards }: { cards: CardView[] }) {
  const total = cards.length;
  if (total === 0) return null;
  const done = cards.filter((c) => c.status === "done").length;
  const blocked = cards.filter((c) => c.status === "blocked").length;
  const counts = new Map<CardStatus, number>();
  for (const c of cards) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold tabular-nums text-foreground">{done}</span> / {total} terminées
        </span>
        {blocked > 0 && (
          <span className="font-semibold text-status-blocked">
            {blocked} attend{blocked === 1 ? "" : "ent"} une réponse
          </span>
        )}
      </div>
      <div className="flex h-1.5 gap-0.5">
        {PROGRESS_STATUSES.filter((s) => counts.has(s)).map((s) => (
          <div
            key={s}
            className={cn("h-full rounded-full", PROGRESS_TONE[s])}
            style={{ width: `${((counts.get(s) ?? 0) / total) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

interface SubtaskListProps {
  container: CardView;
  childCards: CardView[];
  byId: Map<string, CardView>;
  session: string | undefined;
  onOpen: (childId: string) => void;
  onReorder: (childId: string, index: number) => void;
  onNewSubtask: (title: string) => Promise<void>;
  onLinkExisting: (childId: string) => Promise<void>;
  onDetach: (childId: string) => Promise<void>;
  onDependsOn: (childId: string, dependsOn: string | null) => Promise<void>;
  onDelete: (childId: string) => Promise<void>;
  /** Cards offered by "Lier une carte existante" — unparented cards only (linking one already inside
   *  another container would need a detach first, which this flow doesn't attempt). */
  linkable: CardView[];
  /** Cards offered by a row's "Dépend de…" — any other card, same rule LinkPicker itself follows. */
  dependsOnCandidates: CardView[];
}

function SubtaskList({
  container,
  childCards,
  byId,
  session,
  onOpen,
  onReorder,
  onNewSubtask,
  onLinkExisting,
  onDetach,
  onDependsOn,
  onDelete,
  linkable,
  dependsOnCandidates,
}: SubtaskListProps) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [linking, setLinking] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  async function submitNew() {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setAdding(false);
    await onNewSubtask(t);
  }

  const menuChild = childCards.find((c) => c.id === menuFor) ?? null;

  return (
    <>
      <SubtaskProgress cards={childCards} />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {childCards.map((child, i) => {
          const dep = dependencyInfo(child, byId);
          const loud = child.status === "blocked" || child.status === "orphaned";
          const ctxPct = child.session?.ctxPct;
          return (
            <div
              key={child.id}
              draggable
              onDragStart={() => setHeld(child.id)}
              onDragEnd={() => setHeld(null)}
              onDragOver={(e) => {
                if (!held || held === child.id) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (held && held !== child.id) onReorder(held, i);
                setHeld(null);
              }}
              className={cn(
                "flex items-start gap-2 py-[11px] pl-1.5 pr-2.5 lg:items-center",
                i > 0 && "border-t border-border/60",
                held === child.id && "opacity-40",
              )}
            >
              <GripVertical className="mt-[9px] size-[14px] shrink-0 cursor-grab text-muted-foreground/55 lg:mt-0" />
              <span
                aria-hidden
                className={cn("mt-[7px] size-2 shrink-0 rounded-full lg:mt-0", CARD_DOT[child.status])}
              />
              <button
                type="button"
                onClick={() => onOpen(child.id)}
                className="min-w-0 flex-1 text-left lg:flex lg:items-center lg:gap-3"
              >
                <span
                  className={cn(
                    "block min-w-0 flex-1 truncate text-sm font-medium leading-[1.35]",
                    child.status === "done" && "text-muted-foreground",
                  )}
                >
                  {child.title}
                  {child.tag && (
                    <TagChip tag={child.tag} className="ml-1.5 px-[7px] py-px text-[10px]" />
                  )}
                </span>
                {loud && (
                  <span
                    className={cn(
                      "mt-1 inline-block shrink-0 rounded-full px-2 py-[3px] text-[length:var(--label-size)] font-bold uppercase tracking-[var(--label-tracking)] text-status-chip-foreground lg:mt-0",
                      CARD_DOT[child.status],
                    )}
                  >
                    {CARD_STATUS_LABEL[child.status]}
                  </span>
                )}
                {dep && (
                  <div
                    className={cn(
                      "mt-1 flex min-w-0 shrink-0 items-center gap-1 text-[11px] lg:mt-0",
                      dep.met ? "text-status-done" : "text-status-blocked",
                    )}
                  >
                    <Lock className="size-[11px] shrink-0" />
                    <span className="truncate">après « {dep.title} »</span>
                  </div>
                )}
                {(child.runtime || child.branch) && (
                  <div className="mt-1 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground lg:mt-0 lg:w-[150px]">
                    {child.runtime && (
                      <AgentIcon agent={child.runtime.agent} className="size-[14px] shrink-0" />
                    )}
                    {child.branch && <span className="min-w-0 truncate font-mono">{child.branch}</span>}
                    {ctxPct != null && (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <CtxBar pct={ctxPct} />
                        {Math.round(ctxPct)}%
                      </span>
                    )}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => setMenuFor(child.id)}
                aria-label="More"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60"
              >
                <EllipsisVertical className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {adding ? (
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNew();
            }}
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titre de la sous-tâche"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button type="submit" size="sm" className="h-10" disabled={!title.trim()}>
              Ajouter
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={() => {
                setAdding(false);
                setTitle("");
              }}
            >
              Annuler
            </Button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-brand/16 px-3.5 text-sm font-semibold text-brand"
            >
              <Plus className="size-4" />
              Nouvelle sous-tâche
            </button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5"
              onClick={() => setLinking(true)}
            >
              <Link2 className="size-4" />
              Lier une carte existante
            </Button>
          </>
        )}
      </div>

      <BottomSheet open={linking} onClose={() => setLinking(false)} title="Lier une carte existante">
        <LinkPicker
          label="Carte à lier"
          hint="La carte rejoint ce conteneur comme sous-tâche."
          value={null}
          cards={linkable}
          onChange={(id) => {
            setLinking(false);
            if (id) void onLinkExisting(id);
          }}
        />
      </BottomSheet>

      <SubtaskActionsSheet
        child={menuChild}
        parentTitle={container.title}
        onClose={() => setMenuFor(null)}
        onOpenPane={(paneId) => navigate(panePath(paneId, session))}
        onDependsOn={onDependsOn}
        onDetach={onDetach}
        onDelete={onDelete}
        candidates={dependsOnCandidates}
      />
    </>
  );
}

interface SubtaskActionsSheetProps {
  child: CardView | null;
  parentTitle: string;
  onClose: () => void;
  onOpenPane: (paneId: string) => void;
  onDependsOn: (childId: string, dependsOn: string | null) => Promise<void>;
  onDetach: (childId: string) => Promise<void>;
  onDelete: (childId: string) => Promise<void>;
  candidates: CardView[];
}

/** A sub-task row's "⋯": open its pane, hand it off, set what it depends on, detach it from the
 *  container (it stays on the board, alone — nothing is deleted), or delete it outright. Mirrors
 *  PaneActionsSheet's action-list/sub-view shape (action-sheet-rows.tsx) — a Back row into the
 *  "depends on" picker instead of a whole second sheet, same reasoning: a sheet inside a sheet is a
 *  back-button trap on a phone. */
function SubtaskActionsSheet({
  child,
  parentTitle,
  onClose,
  onOpenPane,
  onDependsOn,
  onDetach,
  onDelete,
  candidates,
}: SubtaskActionsSheetProps) {
  const [mode, setMode] = useState<"actions" | "depends">("actions");
  const [handingOff, setHandingOff] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { pending, confirm, reset } = usePendingConfirm();

  useEffect(() => {
    setMode("actions");
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open, not on every reset identity change
  }, [child?.id]);

  async function handoff() {
    if (!child) return;
    setHandingOff(true);
    try {
      await handoffCard(child.id);
      setStatus("Handoff asked for — the card swaps sessions when the note lands.", "info");
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    } finally {
      setHandingOff(false);
      onClose();
    }
  }

  const confirming = !!child && pending === child.id;

  return (
    <BottomSheet open={child !== null} onClose={onClose} title={child?.title ?? "Sub-task"}>
      {!child ? null : mode === "depends" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setMode("actions")}
            className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
            Retour
          </button>
          <LinkPicker
            label="Dépend de"
            hint="La carte ne démarre pas tant que celle-ci n'est pas terminée."
            value={child.dependsOn}
            cards={candidates}
            onChange={(id) => {
              void onDependsOn(child.id, id);
              onClose();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {child.runtime && (
            <ActionRow
              icon={<TerminalSquare className="size-4 shrink-0 text-muted-foreground" />}
              label="Ouvrir le pane"
              onClick={() => {
                onOpenPane(child.runtime!.paneId);
                onClose();
              }}
            />
          )}
          {child.runtime && (
            <ActionRow
              icon={<Shuffle className="size-4 shrink-0 text-muted-foreground" />}
              label={
                handingOff
                  ? "Envoi…"
                  : `Handoff${child.session?.ctxPct != null ? ` · ctx ${Math.round(child.session.ctxPct)}%` : ""}`
              }
              onClick={() => void handoff()}
            />
          )}
          <ActionRow
            icon={<Link2 className="size-4 shrink-0 text-muted-foreground" />}
            label="Dépend de…"
            onClick={() => setMode("depends")}
          />
          <div className="flex flex-col">
            <ActionRow
              icon={<Unlink className="size-4 shrink-0 text-muted-foreground" />}
              label="Détacher du conteneur"
              onClick={() => {
                void onDetach(child.id);
                onClose();
              }}
            />
            <p className="px-3 pb-1 text-xs text-muted-foreground">
              La carte reste sur le board, seule — « {parentTitle} » ne la tient plus. Rien n'est supprimé.
            </p>
          </div>
          <DestructiveActionRow
            icon={<Trash2 className="size-4 shrink-0" />}
            label="Supprimer la carte"
            confirmLabel="Confirmer la suppression ?"
            closingLabel="Suppression…"
            armed={confirming}
            closing={deleting}
            onClick={() => {
              if (!confirm(child.id)) return;
              setDeleting(true);
              void onDelete(child.id).finally(() => {
                setDeleting(false);
                onClose();
              });
            }}
          />
        </div>
      )}
    </BottomSheet>
  );
}

