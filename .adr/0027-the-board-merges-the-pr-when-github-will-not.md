# 0027 — The board merges the PR itself when GitHub's auto-merge is not there

**Status:** Accepted
**Date:** 2026-10-10
**Amends:** [0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md), step 7 (not edited: this is its successor)

## Context

ADR 0017 step 7 left the merge to GitHub: `gh pr merge --auto`. A repo without `allow_auto_merge`
(or branch protection) refuses, and the card was filed done with its PR left open — the operator
tapped the last step after all.

## Decision

After opening a run's PR the coordinator still asks for `--auto` first: it is a bonus, GitHub watches
the checks. If GitHub refuses, **the board merges it now** (`gh pr merge --squash`), because the lead
has validated and the operator's consent covers the merge. It never does when:

- the repo has a gate and its newest `run.gate` of this run is not green (or never ran);
- `gh pr view` does not say `MERGEABLE` — `CONFLICTING`, `UNKNOWN` (not computed yet), or unreadable.

Either way the decision is journaled as `run.merge { merged, reason }`; a skipped merge leaves the PR
open as before. No poll is added: `UNKNOWN` is a skip, not a wait.

## What this rules out

A merge that bypasses the gate, or that waits on GitHub in a loop. A repo without a gate set merges
on the lead's word alone — set a gate to demand more.
