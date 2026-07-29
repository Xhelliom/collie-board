// Integration — what happens to a card's branch once the work on it is done.
//
// Until now the board opened a worktree and never closed the loop: a card could be filed as done
// while its branch sat outside `main` with nobody to say so. Three gestures end that, and all three
// are TAPS — nothing here ever runs on a poll tick, on a status change, or on the copilot's word.
// That is the same rule the dependency gate follows (`cards.ts`): the board makes a thing possible,
// the operator decides it happens.
//
//   merge    — `git merge --no-ff` into the base, in the main checkout. Nothing is pushed.
//   pr       — push the branch, then `gh pr create`. The base is never touched.
//   cleanup  — close the pane, remove the worktree, delete the branch. Refused unless integrated.
//
// EVERY ONE REFUSES BEFORE IT ACTS. The gate is `refusalFor` in git.ts, and it is shared so the
// button, the request and the subprocess cannot disagree about what is allowed. The refusals matter
// more than the actions: the operator is on a phone and cannot fix a half-merged repository, so
// "no, and here is why" is the only acceptable outcome of a doubtful tap.

import { promptAndConfirm } from "./cards.ts";
import type { BoardDb, Card } from "./db.ts";
import {
  createPr,
  deleteBranch,
  integrationOf,
  mergeIntoBase,
  pushBranch,
  refusalFor,
  refusalMessage,
  type Integration,
} from "./git.ts";
import type { HerdrClient } from "./herdr-client.ts";

export type IntegrateError =
  | { kind: "refused"; message: string }
  | { kind: "git"; message: string }
  | { kind: "herdr"; message: string }
  /** A merge conflict — the one failure with a remedy, so it gets its own kind for the UI. */
  | { kind: "conflict"; message: string };

/**
 * What the card's agent is asked to do about a conflict.
 *
 * IT MERGES THE BASE INTO ITS OWN BRANCH, never the other way round. That is the whole safety
 * argument: the conflict is resolved in a throwaway checkout by the agent that wrote the code, and
 * the main repository never enters a conflicted state at all. Once the branch contains the base,
 * merging it back is trivial by construction.
 *
 * Pure + exported so the wording is reviewable — this prompt drives a real terminal.
 */
export function resolvePrompt(base: string, branch: string): string {
  return [
    `Merging this branch (${branch}) into ${base} hit a conflict, so ${base} has moved on since you`,
    "branched. Bring it in here and settle it, in THIS checkout:",
    "",
    `1. git merge ${base}`,
    "2. Resolve every conflict. Keep both intentions where they are compatible; where they are not,",
    "   the change on this branch is the newer decision — but read the other side before dropping it.",
    "3. Make sure the project still builds and its tests still pass.",
    "4. Commit the merge.",
    "",
    `Do NOT push, do NOT check out ${base}, and do not touch any other checkout of this repository.`,
    "Stop when the merge commit exists here.",
  ].join("\n");
}

type Result<T> = { ok: true; value: T } | { ok: false; error: IntegrateError };

/** The card's branch state, or null when it has no repo/branch to speak of. */
export async function integrationFor(card: Card): Promise<Integration | null> {
  if (!card.repoPath || !card.branch) return null;
  return await integrationOf(card.repoPath, card.branch, card.baseRef);
}

/** Read the state and apply the shared gate. Every action below starts here. */
async function gate(
  card: Card,
  action: "merge" | "pr" | "cleanup",
): Promise<{ ok: true; state: Integration } | { ok: false; error: IntegrateError }> {
  const state = await integrationFor(card);
  const refusal = refusalFor(state, action);
  if (refusal) return { ok: false, error: { kind: "refused", message: refusalMessage(refusal, state) } };
  return { ok: true, state: state! };
}

/** Merge the card's branch into its base. Local only — the push stays the operator's call. */
export async function mergeCard(db: BoardDb, card: Card): Promise<Result<{ base: string; ahead: number }>> {
  const checked = await gate(card, "merge");
  if (!checked.ok) return checked;
  const { state } = checked;

  const merged = await mergeIntoBase(card.repoPath!, state.branch);
  if (!merged.ok) {
    db.recordEvent(card.id, "card.merge_failed", {
      branch: state.branch,
      base: state.base,
      conflict: merged.conflict,
      error: merged.error,
    });
    // The repository is already back where it was — `mergeIntoBase` aborts before returning. What
    // this reports is which of the two situations it is, because only one of them has a next step.
    if (merged.conflict) {
      return {
        ok: false,
        error: {
          kind: "conflict",
          message: `${state.base} has moved on and the merge conflicts. Nothing was changed here — hand it to the agent to settle on its own branch.`,
        },
      };
    }
    return { ok: false, error: { kind: "git", message: merged.error } };
  }
  db.recordEvent(card.id, "card.merged", { branch: state.branch, base: state.base, ahead: state.ahead });
  return { ok: true, value: { base: state.base, ahead: state.ahead } };
}

/**
 * Push the branch and open a pull request.
 *
 * The body is the card: its spec and acceptance criteria are what the PR is FOR, and re-deriving
 * them from the diff is exactly the work the board exists to avoid.
 */
export async function prForCard(db: BoardDb, card: Card): Promise<Result<{ url: string | null }>> {
  const checked = await gate(card, "pr");
  if (!checked.ok) return checked;
  const { state } = checked;

  const pushed = await pushBranch(card.repoPath!, state.branch);
  if (!pushed.ok) {
    db.recordEvent(card.id, "card.pr_failed", { stage: "push", error: pushed.error });
    return { ok: false, error: { kind: "git", message: pushed.error } };
  }

  const body = [
    card.spec?.trim() || card.title.trim(),
    ...(card.acceptance.length ? ["", "## Acceptance criteria", ...card.acceptance.map((a) => `- [ ] ${a}`)] : []),
  ].join("\n");

  const pr = await createPr(card.repoPath!, {
    branch: state.branch,
    base: state.base,
    title: card.title,
    body,
  });
  if (!pr.ok) {
    db.recordEvent(card.id, "card.pr_failed", { stage: "create", error: pr.error });
    return { ok: false, error: { kind: "git", message: pr.error } };
  }
  db.recordEvent(card.id, "card.pr_opened", { branch: state.branch, base: state.base, url: pr.url });
  return { ok: true, value: { url: pr.url } };
}

/**
 * Hand a conflict to the card's own agent, to settle in its own checkout.
 *
 * Deliberately fire-and-forget, with no marker and no coordinator: unlike a handoff or a wrapup,
 * there is nothing for the board to collect afterwards. The result is a commit, and the commit shows
 * up in `behind` on the next read of the integration state — so the card screen answers "is it done
 * yet" from git itself rather than from a flag we would have to keep true.
 *
 * Requires a LIVE agent. A card whose pane is gone is told to relaunch rather than having one
 * started under it: launching an agent spends the operator's quota, and that is always a tap.
 */
export async function resolveConflict(
  db: BoardDb,
  herdr: HerdrClient,
  card: Card,
): Promise<Result<{ paneId: string }>> {
  const state = await integrationFor(card);
  if (!state) return { ok: false, error: { kind: "refused", message: "this card has no branch to integrate" } };
  if (state.branchDirty) {
    return {
      ok: false,
      error: {
        kind: "refused",
        message: "the card's checkout already has uncommitted work — deal with that first, or the merge will bury it",
      },
    };
  }

  const session = db.openSessionFor(card.id);
  if (!session?.paneId) {
    return {
      ok: false,
      error: { kind: "refused", message: "this card has no running agent — start it again to resolve the conflict" },
    };
  }

  try {
    await promptAndConfirm(herdr, session.paneId, resolvePrompt(state.base, state.branch));
  } catch (err) {
    return { ok: false, error: { kind: "herdr", message: (err as Error).message } };
  }
  db.recordEvent(card.id, "card.resolve_requested", { branch: state.branch, base: state.base, paneId: session.paneId });
  return { ok: true, value: { paneId: session.paneId } };
}

/**
 * Close the card's pane, remove its worktree, delete its branch.
 *
 * Ordered so that a failure never leaves a worse state than it found: the pane goes first (a closed
 * pane is recoverable — the worktree is still there), then the checkout, then the branch. The branch
 * delete uses `git branch -d`, so git itself refuses one that isn't merged even if our own gate ever
 * stopped doing so.
 */
export async function cleanupCard(
  db: BoardDb,
  herdr: HerdrClient,
  card: Card,
): Promise<Result<{ branch: string }>> {
  const checked = await gate(card, "cleanup");
  if (!checked.ok) return checked;
  const { state } = checked;

  const session = db.openSessionFor(card.id);
  if (session?.paneId) {
    try {
      await herdr.closePane(session.paneId);
    } catch {
      // Already gone is the outcome we wanted. Anything else surfaces on the next step anyway.
    }
    db.closeSession(session.id, "done");
  }

  if (card.workspaceId) {
    try {
      await herdr.removeWorktree({ workspaceId: card.workspaceId });
    } catch (err) {
      db.recordEvent(card.id, "card.cleanup_failed", { stage: "worktree", error: (err as Error).message });
      return { ok: false, error: { kind: "herdr", message: (err as Error).message } };
    }
  }

  const deleted = await deleteBranch(card.repoPath!, state.branch);
  if (!deleted.ok) {
    // The checkout is already gone, so say what actually happened rather than claiming a clean run.
    db.recordEvent(card.id, "card.cleanup_failed", { stage: "branch", error: deleted.error });
    return { ok: false, error: { kind: "git", message: `worktree removed, but the branch is still there: ${deleted.error}` } };
  }

  db.recordEvent(card.id, "card.cleaned_up", { branch: state.branch });
  return { ok: true, value: { branch: state.branch } };
}
