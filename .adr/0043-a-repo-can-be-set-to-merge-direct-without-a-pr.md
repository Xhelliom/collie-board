# 0043 — A repo can be set to merge direct, without a PR

**Status:** Accepted
**Date:** 2026-10-21
**Amends:** [0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md) steps 6–7 and
[0027](./0027-the-board-merges-the-pr-when-github-will-not.md) ("the merge goes through the PR"), for
this mode only — neither is edited.

## Context

A new project — no remote, one person — has no GitHub to open a PR on, and no reviewer to read one. ADR
0017 makes a run open a PR per card and ADR 0027 merges that PR; on such a repo the run halts at step 6
for ever, and the operator merges each card by hand.

## Decision

**A per-repo setting, `integration: "pr" | "direct"`, default `pr`** (`repo_pref.integration`, null = pr).
It is the operator's alone, like the gate (ADR 0020): `POST /api/repos/integration` refuses any request
carrying `x-collie-pane`, and the control sits in the project page's settings block.

With `direct`, a run's integration step is `mergeCard` — the Merge tap's own path — instead of a PR:

- **The guards stay.** The lead must have said finished, and a repo with a gate must have a green
  `run.gate` of this run; otherwise nothing is merged.
- **The merge happens in the repo's checkout**, into the card's base, `--no-ff`. It is refused —
  the card halted with the reason, still in review, nothing touched — when that checkout is not on
  the base, or has uncommitted changes. (The Merge tap tolerates a dirty base: git refuses by itself if
  it would overwrite. A run has nobody watching, so it does not lean on that.)
- **Pushed only if there is an `origin`**; with one, origin ahead of either side refuses, and a refused
  push undoes the merge (the rules of the Merge tap). The card is filed only on a merge that landed.
- **A conflict goes to the worker**, against the local base, as a merge conflict does.
- **A lot merged direct has no lot PR:** each card lands on its own, as a `card` run would.

## What this rules out

A PR opened "anyway" on a direct repo, a merge on a red gate or without the lead, a stash or reset of
the operator's checkout to make a merge go through, and an agent switching the mode for itself.
