# 0015 — A card forks from the more complete of the local base and origin's

**Status:** Accepted
**Date:** 2026-09-15

## Context

`startCard` hands `worktree.create` the card's base, which is a **local** branch (`main`). When all
the work goes through cards, nothing moves that branch: PRs merge on the remote. So every card
started behind the last one that landed, and conflicted with it at integration. ADR 0014 catches
that conflict when the PR is opened; this decision removes its cause at start.

The local base is not simply stale, though. The merge gesture integrates into it and pushes
nothing, and a commit made by hand on `main` stays there until someone pushes it. Both are commits
`origin` lacks.

## Decision

Before cutting a **new** branch, fetch `origin/<base>` and compare. A relaunch is left alone (its
base was chosen long ago), and so is a predecessor's branch (that branch *is* the handoff).

- **Only origin has commits of its own** → fast-forward the local base, then fork from it. The
  fast-forward is `merge --ff-only` in the checkout that holds the branch, or `update-ref` against
  the measured old value when no checkout holds it.
- **Only local has commits of its own, or neither does** → fork from local, as before.
- **Both have commits of their own** → refuse the start (`stale-base`, 409) and name both counts.
- **Origin cannot be asked** (offline, no `origin`, no such branch there) → fork from local, as
  before, and say so in `card.worktree`.

`syncBaseWithOrigin` in `bridge/git.ts`.

## What this rules out

**"Always fork from `origin/<base>`."** It drops every integration the merge gesture has not
pushed, so the card starts behind again, this time on the other side.

**"Fork from `origin/<base>` and leave the local base where it is."** A card's diff and its
integration state are measured against its `baseRef` (`resolveBase`, `integrationOf`). With
`baseRef` = `main` still stale, other people's merged PRs show up in the card's diff as if the card
had written them. With `baseRef` = `origin/main`, the merge gesture refuses (`base-not-checked-out`)
and the PR gesture's fetch fails. Moving the local base keeps the fork point and the measuring point
the same commit.

**"On divergence, merge origin into the local base."** That puts a merge commit on the operator's
`main` that no tap asked for, and if it conflicts there, no agent is placed to settle it.

**"On divergence, pick a side and warn."** The warning lands in the journal and the conflict lands on
the card. A refusal says what to do (pull, then push) before there is anything to undo.

## Consequences

- One `git fetch` per new card, on a start that already takes tens of seconds.
- Starting a card can now write to the local base, but only as a fast-forward. If that would
  overwrite uncommitted work, git refuses before touching a file, and the start is refused with
  git's reason.
- Two starts in the same instant can race on the fast-forward (`index.lock`). The loser gets git's
  message, and tapping start again works.
- **What would justify revisiting:** frequent divergence refusals in the journal
  (`card.start_failed`, stage `base`). That would argue for the merge gesture pushing what it merges.
