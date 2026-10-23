# 0030 — The orchestrator may launch a lot when the operator allows it, per project

**Status:** Accepted · amended by [0047](./0047-the-orchestrator-may-start-a-lot-when-nothing-runs-if-the-operator-allows-it.md) (a start when nothing runs, if the operator allows it) — amends [ADR 0021](./0021-a-project-is-a-roadmap-phases-and-lots-planned-by-an-agent-that-never-launches.md) ("prepares, never launches")

## Context

ADR 0021 made launching the operator's tap: the launch routes refuse any request carrying
`x-collie-pane`. On a project with a long, already-planned roadmap that tap is the only thing the
operator does between lots. They asked for a per-project opt-in to let the orchestrator chain lots.

## Decision

**A per-repo setting, off by default** (`repo_autonomy`): `enabled`, `maxChain` (1 to unlimited, null =
unlimited; default 1) and `stopOnRed` (default on). The row is the operator's alone —
`PUT /api/orchestrator/autonomy` refuses any request that carries `x-collie-pane`, so the orchestrator
cannot grant itself autonomy or widen its bounds. Edited from the orchestrator panel.

**The launch is armed by the end-of-lot wake, never by a poll** (ADR 0028). When a lot finishes, the
nudger asks `endOfLot()`: autonomy on, a planned lot waiting, no red gate/CI (if `stopOnRed`), chain
below `maxChain` → it arms **one** launch and tells the orchestrator so. `POST /api/runs/:id/launch`
accepts an agent pane only while armed, spends the grant (`chained + 1`) and audits it with
`autonomous: true` and the pane. An operator launch resets the chain.

**A bound reached disarms, tells the orchestrator not to launch, and rings the operator's bell.**
It states a stop, not a state that can lapse, so the bell — not the herd's slot — is right
([ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md)).

**Validating a phase stays the operator's in every case** (ADR 0025), as does `POST /api/runs`
without `planned` (it creates and launches at once).

## What this rules out

**A timer or poll that launches.** The grant exists only after a lot ended and the orchestrator was woken.
**An orchestrator-writable setting.** The write route is the one place the guarantee lives.
**Autonomy implying validation.** Chaining lots is not accepting a milestone.

## Consequences

- Red = the lot's last `run.gate` is `ok:false`, or its last `run.merge` is unmerged with a `ci` failure, on a card never filed.
- The grant is withdrawn when no orchestrator is alive to receive it, so a worker pane cannot use it.
- Backups carry the table (settings and counters).
