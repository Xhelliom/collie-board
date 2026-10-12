# 0034 — A card after a merged predecessor forks from the base, not from its branch

**Status:** Accepted — amends [0015](./0015-a-card-forks-from-the-more-complete-base.md)
**Date:** 2026-10-12

## Context

ADR 0015 leaves a predecessor's branch alone when a dependent card starts: "that branch *is* the
handoff". That held while a successor could start as soon as its predecessor was `done`, merged or
not. It no longer holds once the predecessor's PR has merged, because the board merges in **squash**:
the landed commit is a new one, and the predecessor's branch is not an ancestor of the base.

Forking from that branch puts every commit of the predecessor back into the successor's PR, and its
`changes/<slug>.md` fragment with them. The release folds that fragment a second time: PRs #59 and
#60 shipped 0.188.0 and 0.189.0 with the same CHANGELOG lines.

## Decision

When the predecessor's work **has landed**, fork the dependent card from its own base, synced with
origin exactly as ADR 0015 says for any new branch. Otherwise fork from the predecessor's branch, as
before.

"Has landed" is read from the predecessor's journal (`hasLanded` in `bridge/cards.ts`): the newest of
its `card.pr_merged`, `card.merged` and `card.worktree` events is a merge. A start after the merge (a
relaunch) is new work the base lacks, so its branch is the handoff again. `done` without a PR is not
a merge either.

## What this rules out

**"Detect the squash in git (patch-id, tree comparison)."** The journal already says whether the
board merged the PR, or whether a GitHub check saw it merged (`notePrOutcome`). Git cannot say it
cheaply and reliably for a squash.

**"Rebase the predecessor's branch onto the base before forking."** It rewrites a branch the card no
longer owns, to obtain what the base already holds.

## Consequences

- A PR merged on GitHub by hand, that no board check has seen yet, is not in the journal: its
  successor still forks from the branch. Tapping "Check" on the PR list before starting fixes it.
- The successor's diff no longer shows the predecessor's work, and the warm-start prompt still holds:
  that work is in its branch, through the base.
