# 0028 — The orchestrator is woken by the board when a lot ends

**Status:** Accepted — amends the reading of [ADR 0013](./0013-the-bridge-does-not-know-its-consumers.md)

## Context

The orchestrator ([ADR 0021](./0021-a-project-is-a-roadmap-phases-and-lots-planned-by-an-agent-that-never-launches.md))
only moves when the operator speaks to it. A lot can end, or the lead can hand back a card it could
not merge, and the agent that planned the work learns nothing until someone opens its pane.

ADR 0013 says the bridge never initiates toward a consumer. The orchestrator is not one: it is an
agent **of the board** — started by the board, found by the board's label, silenced by the board's
hooks — in the same position as a card's worker or the lead, to whom the bridge already types.

## Decision

**The bridge types one short message into the repo's orchestrator pane when a lot finishes
(`run.finished`) and when the lead reports a card unmerged or blocked (`run.merge` with
`merged: false`, `run.halted`).** A card is reported once per run. No live orchestrator: nothing is
sent and nothing fails.

It is a journal tailer in `bridge/orchestrator-nudge.ts`, hung off `engine.onUpdate`, cursored in
memory — no timer, no new poll.

## Consequences

- ADR 0013 stands for everything that is **not** a board agent: voice assistants, scripts, other
  apps still poll `/api/notifications/log`. The line is "agent the board started", not "wants to hear".
- The message never asks the orchestrator to launch anything; its launch routes still refuse it.
- A restart forgets what was told: the tailer starts at the newest event, so nothing is replayed.
- The message is not retracted — it states what happened, not a state that can stop being true
  ([ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md) does not apply: no alert slot).
