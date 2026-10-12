# 0036 — "GitHub has not answered yet" is a wait, and only a landing files the card

**Status:** Accepted
**Date:** 2026-10-12
**Supersedes:** [0027](./0027-the-board-merges-the-pr-when-github-will-not.md) on one point — "`UNKNOWN` is a skip, not a wait"
**Amends:** [0029](./0029-the-board-reads-the-prs-checks-before-it-merges.md) on one point — "no check at all" (neither is edited: this is their successor)

## Context

ADR 0027 made `UNKNOWN` mergeability a skip. But `UNKNOWN` is what GitHub answers for seconds to
minutes after `gh pr create` or a push — exactly when the board asks. Three patches piled up around
that one rule, each against an ADR:

- `landPr` slept 5 s and asked once more (`MERGEABLE_RECHECK_MS`): a timer, and a guess at GitHub's lag;
- an empty check rollup right after `pr create` merged as "no CI" until `hasPrWorkflow` grepped the
  main checkout's `.github/workflows` for `pull_request` — not injectable, and a workflow filtered by
  `paths:` or `branches:` would have made the board wait for ever;
- the coordinator's own ask had no sleep, so `UNKNOWN` was a final skip there, and `landed()` then
  filed the card with its PR open and unmerged — what ADR 0035 removed for "PR & done". The "PR &
  done" follower met `UNKNOWN` on its first tick (≤ 1.5 s after the PR opened) and stopped for good.

A dependent card whose predecessor was filed this way (auto-merge armed, not merged yet) forks from
the predecessor's branch, persists it as its base and opens its PR against it; the cards forked from
a branch were only repointed when that branch was deleted by a cleanup, never when its PR merged.

## Decision

**"GitHub has not answered yet" is a wait**, journaled once as `run.merge { wait: true }` like
running checks (ADR 0029): mergeability `UNKNOWN`, and an empty rollup on a PR younger than
`CHECKS_GRACE_MS` (5 min, read from the PR's own `createdAt`). The caller's next `engine.onUpdate`
tick asks again — a run's land step, or the "PR & done" follower — at most every 30 s. No timer, and
no reading of the repo's workflow files: past the grace, an empty rollup is "no CI" again, as 0029 says.

**Only a landing files a card**: the PR merged — by the board, GitHub's auto-merge or a human — or
GitHub's auto-merge armed (`card.automerge_armed`, `gh` accepted it). Any other refusal does not:
a red check goes back to the worker (0029), a conflict to the worker's agent (0014), anything else
(PR closed, GitHub unreadable, merge refused) halts the card for the operator. The follower reads
the PR's state before it gives up, so a merge by hand after a red check still files the card.

**Every merge the board learns of repoints the cards forked from that branch** to its base
(`notePrMerged` → `rebindDependents`), as a cleanup already did.

## What this rules out

A timer or an in-request retry waiting on GitHub; guessing CI from the repo's YAML; a card filed
`done` while its PR is open and nothing will merge it.

## Consequences

- A repo without CI merges up to 5 minutes after its PR opens instead of at once.
- `UNKNOWN` that never resolves (GitHub stuck) leaves the card in review with a `wait` — visible in
  the journal, not filed. Revisit if that is ever seen.
- A card filed on an armed auto-merge whose checks then fail stays filed with its PR open, as
  ADR 0017 step 7 accepted; its merge is learnt on the next Check or card screen.
