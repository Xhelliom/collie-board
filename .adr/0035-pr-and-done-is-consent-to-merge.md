# 0035 — « PR et terminé » est le consentement à fusionner

**Status:** Accepted
**Date:** 2026-10-12
**Amends:** [0027](./0027-the-board-merges-the-pr-when-github-will-not.md) (not edited: this is its successor)

## Context

ADR 0027 (and 0029) let the board merge a PR only inside a launched lot. The card screen's « PR et
terminé » opened the PR, then filed the card at once: PR #63 sat green and mergeable, never merged,
its card `done`, and the project's « à fusionner à la main » list wrong.

## Decision

**« Terminé » means landed.** On a PR, the tap is the operator's consent to merge it, given once:

- the route opens the PR and journals `card.pr_follow` — it does **not** file the card;
- `pr-follow.ts`, on `engine.onUpdate` (every 30 s per card, no timer), runs the repo's gate once in
  the card's checkout (`run.gate`), then `mergeWhenReady` exactly as a lot does: checks running wait,
  green merges, red check / red gate / conflict stop with their `run.merge` reason;
- the card is filed (`fileAsDone`) only once the PR is merged — by the board, GitHub's auto-merge or
  a human. A stopped follow leaves the card open; tapping again after the fix journals a new follow;
- the follow is read from the journal (`card.pr_follow` after the open PR's `card.pr_opened`, no
  `card.pr_merged`/`card.pr_closed`), so a bridge restart resumes it.

A plain « PR » tap is unchanged: it opens the PR and stops. « Merge et terminé » is unchanged.

## What this rules out

A card filed `done` while its PR is still open, and a merge from the tap that skips the gate or the
PR's checks.
