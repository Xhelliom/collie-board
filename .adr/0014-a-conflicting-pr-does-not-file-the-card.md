# 0014 — A PR that conflicts does not file its card; a filed card reopens on demand

**Status:** Accepted
**Date:** 2026-09-15

## Context

"Open a PR & done" is the one end-of-card gesture that never meets a conflict. `prForCard` pushes,
then `gh pr create` — which succeeds whether or not the branch merges cleanly, because GitHub works
out mergeability afterwards, on its own time. So the route sees a success and files the card
(`fileAsDone`); the wrapup runs; `WrapupCoordinator.autoCleanup` closes the pane, removes the worktree
and deletes the local branch — allowed since fe19fea, because the commits are on the upstream. By the
time GitHub reports *"This branch has conflicts"*, the board has already let go of everything that
could settle them: the agent, its checkout, its branch.

The merge path does not have this problem, and the reason is written at the route
(`board-routes.ts`): **integrate first, file second, and only on success.** `git merge` fails on the
spot, the card stays open with its agent, and *Let the agent resolve it* hands the conflict to the
agent that wrote the code. It is well used: 57 `card.merge_failed`, 44 `card.resolve_requested` on
this repository's cards alone, in the board's journal on 2026-09-15. The PR path is used on other repositories (tablee 11 PRs,
CrewDesign 8, boarding-pass 5) and its journal holds **no conflict at all** — not because there were
none, but because nothing could see them.

A conflict on a PR arrives in one of two moments, and they do not have the same answer:

1. **Already there when the PR is opened** — the base had moved when the operator tapped. This is the
   case the note reports. It can be known before anything is pushed.
2. **Appears later** — the PR was clean, then other work landed on the base. Nothing at filing time
   could have predicted it.

Measured for (1): `git merge-tree --write-tree --name-only <base> <branch>` (git ≥ 2.38; 2.55 here)
performs the merge in memory, touches neither index nor checkout, exits `1` on conflict and names the
files. It is the same answer GitHub will give, available synchronously, on the machine.

Measured for (2): `gh pr view --json mergeable` exposes `MERGEABLE | CONFLICTING | UNKNOWN`. `UNKNOWN`
is what GitHub says while it has not computed it yet — including in the seconds after a PR is created.

## Decision

**A PR that conflicts is not a successful integration, so it does not file the card.** Before pushing,
the PR gesture fetches the base and runs `merge-tree` against `origin/<base>`. On conflict nothing is
pushed, the card stays open with its agent and worktree, and the existing resolve flow hands it to the
agent — against `origin/<base>`, since that is what the PR is compared with. The operator's next tap
pushes and opens the PR.

**A card whose PR is clean when opened still closes completely**, exactly as fe19fea made it.

**A conflict that appears later reopens the card on demand.** The card screen reads `mergeable` with
the PR state it already reads on open, and says so. A tap restores the branch from `origin`, reopens
the worktree, starts an agent on the resolve prompt; the push that updates the PR is the operator's
tap again, through the same PR gesture — `gh pr create` already treats "already exists" as success.

## What this rules out

**"Keep the card half-open while its PR is open."** It is the obvious answer and it was the note's
first idea. It costs a new status the whole board must learn (reconcile, columns, filters), an agent
and a worktree held for the life of every PR — days, sometimes — and, worse, a way to know when to let
go: that is a periodic read of GitHub, which the PR reading was built never to be (fa21c74) and which
the fork's rules refuse ("No new poll loop"). It also buys little: the conflict that matters most,
case (1), is caught before filing, and everything case (2) needs to resume — the branch on `origin`,
the PR, the closing report in the journal — survives the cleanup. Anyone who wants to keep a checkout
anyway already has `keepWorktree`.

**"Read `mergeable` right after `gh pr create`, and don't file if it conflicts."** It answers `UNKNOWN`
for the very seconds the tap is waiting in, so it would need a wait-and-retry inside a request — and
the PR is opened in conflict before we find out. `merge-tree` answers first and locally.

**"Notify when a PR becomes conflicting."** [ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md)
would allow it — the retraction predicate is readable — but learning it means polling GitHub, for
the same reason as above. Revisit only if GitHub's answer ever reaches the bridge without a poll.

**"Let the bridge resolve it"** (`-X ours`, regenerating a CHANGELOG…). A conflict is two decisions
that disagree; the board never picks the content. The agent does, in its own checkout.

**GitHub's web conflict editor as *the* answer.** Linked from the card for a trivial conflict, but
it is a text editor on a phone, with no build and no tests.

## Consequences

- The PR gesture costs one `git fetch` more per tap — it was about to push anyway.
- A reopened card leaves `done` (starting → working) and comes back through the ordinary "& done".
  No new status. The agent it gets is a new one: it has the closing report, not the conversation.
- The resolve prompt keeps "Do NOT push". The agent never touches the remote; every push stays a tap.
- **Out of scope, and worth its own decision:** on this repository, every one of the last 10 resolve
  merges conflicted on `CHANGELOG.md`, and four of them on the three version files — the release gate
  cuts a version on each branch. Fixing that removes conflicts instead of settling them, but it is a
  change to the versioning rule in `CLAUDE.md`, not to the board.
- **What would justify revisiting:** PRs left open long enough that reopening a card costs more than
  keeping it — measurable from the journal once reopenings are recorded.
