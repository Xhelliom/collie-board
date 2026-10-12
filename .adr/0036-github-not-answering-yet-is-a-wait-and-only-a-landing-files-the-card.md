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

The same went for a GitHub that could not be read at all (network, `gh` logged out, rate limit): one
failed `gh pr view` halted a run's card, and stopped a "PR & done" follow for good.

A dependent card whose predecessor was filed this way (auto-merge armed, not merged yet) forks from
the predecessor's branch, persists it as its base and opens its PR against it; the cards forked from
a branch were only repointed when that branch was deleted by a cleanup, never when its PR merged.

## Decision

**"GitHub has not answered yet" is a wait**, journaled once as `run.merge { wait: true }` like
running checks (ADR 0029):

- mergeability `UNKNOWN`;
- an empty rollup within `CHECKS_GRACE_MS` (5 min) of the **last push**: the newest of the card's
  journaled `card.pr_opened` / `card.pr_updated` and the PR's own `createdAt`. A re-push gets its
  grace too — the new head's rollup is empty again, on a PR that may be hours old (the PR #44 case of
  0029). Neither known: no grace, the PR merges at once;
- GitHub unreadable — `prStatusOf` or `checksOf` null — fewer than `MAX_UNREADABLE` (5) asks in a
  row. The count is per card and run, in memory (a restart starts it again); any other answer clears
  it. The fifth in a row is a skip, `could not read … 5 times in a row`, for the operator.

The caller's next `engine.onUpdate` tick asks again — a run's land step, or the "PR & done" follower —
at most every 30 s. No timer, and no reading of the repo's workflow files: past the grace, an empty
rollup is "no CI" again, as 0029 says.

**Only a landing files a card**: the PR merged — by the board, GitHub's auto-merge or a human — or
GitHub's auto-merge armed (`card.automerge_armed`, `gh` accepted it). Any other refusal does not:
a red check goes back to the worker (0029), a conflict to the worker's agent (0014), anything else
(PR closed, GitHub unreadable five times in a row, merge refused) halts the card for the operator.
The follower reads the PR's state before it gives up, so a merge by hand after a red check still
files the card. A PR journaled closed, then reopened and merged on GitHub, is journaled merged when
next read (`notePrOutcome` writes any new outcome, not only the first) — the land step would
otherwise ask for ever.

**A card filed on an armed auto-merge holds its dependents in the lot** until the board has seen the
merge. Nothing else would see it: GitHub merges on its own, and in a lot no follower watches that PR.
So a dependent whose predecessor's newest PR word is `card.automerge_armed` does not start: the
coordinator asks GitHub for the predecessor's PR (`refreshPr` → `notePrOutcome`, at the land step's
pace) — merged, it is journaled, its dependents rebound, and the dependent starts from its base on the
next tick (0034); closed, the dependent halts for the operator; still open, it waits, said once as
`run.decision { decision: "wait" }`. Outside a lot nothing arms an auto-merge, so a manual start is
unchanged (0034's Check tap).

**Every merge the board learns of repoints the cards forked from that branch** to its base
(`notePrMerged` → `rebindDependents`), as a cleanup already did. The base is the card's `baseRef`,
else the base its PR was opened against (journaled on `card.pr_opened`).

**A PR the board only watches is asked slower and slower.** A stopped "PR & done" follow (red check,
conflict…) and a dependent waiting on its predecessor's auto-merge keep reading the PR — a merge by
hand must still be seen — every 30 s at first, then every quarter of the time already waited, at
most every 30 min (`askEvery`). Throttled inside the consumer, read from the journal's timestamps: no
timer, and a restart keeps the pace.

## What this rules out

A timer or an in-request retry waiting on GitHub; guessing CI from the repo's YAML; a card filed
`done` while its PR is open and nothing will merge it; a dependent forked from a branch whose merge
the board has not seen.

## Consequences

- A repo without CI merges up to 5 minutes after its last push instead of at once.
- `UNKNOWN` that never resolves (GitHub stuck) leaves the card in review with a `wait` — visible in
  the journal, not filed. Revisit if that is ever seen.
- A push the board did not make (the agent's own `git push` on an open PR) journals nothing: its grace
  is only the PR's `createdAt`. The board's own pushes all go through `prForCard`.
- A card filed on an armed auto-merge whose checks then fail stays filed with its PR open, as
  ADR 0017 step 7 accepted; in a lot its dependent waits, visibly, at a pace down to once per 30 min.
- **Rebinding moves the label, not the branch.** A dependent already started was forked from its
  predecessor's branch: after a squash merge its branch still carries those commits (and their
  `changes/` fragment) — ADR 0034's bug. The board does not rewrite an agent's branch; it journals
  `card.base_moved { from, to }` on that card, shown in its journal as "merge or rebase `to` into it
  before its PR". Acting on it is the agent's or the operator's.
