# 0044 — The orchestrator's own pane screen shows its buttons

**Status:** Accepted
**Date:** 2026-10-21
**Amends:** [0042](./0042-the-orchestrator-proposes-buttons-from-the-mcp-catalog.md), "Only in the
orchestrator's conversation" (the pane screen) — not edited.

## Context

ADR 0042 made the buttons live in the orchestrator panel of the project page only: anywhere else,
the pane screen included, a `collie-buttons` block is code, because any agent can write one. The
operator also opens the orchestrator's session the classic way (`/pane/<id>`) and found its
questions there without their buttons.

## Decision

- **On a pane screen, the buttons are live only when that pane is its project's orchestrator**, by
  the derivation the panel itself relies on: `isOrchestrator` (`web/src/lib/agent-groups.ts`), the
  same as `findOrchestrator` (`bridge/orchestrator.ts`) — workspace labelled
  `orchestrator-<repo basename>` and running in that repo. Nothing declared, nothing an agent writes.
  For any other pane, the block stays code.
- **Reading mode** sets the context around the transcript for that pane; 0042's per-turn rules stand
  (assistant turns only, never a thinking block, a summary or a note).
- **Terminal mode** never turns the mirror into buttons — the screen is raw output. The buttons of the
  orchestrator's **last** assistant message come from its transcript, pulled once per settled poll (no
  timer of its own), in a row above the composer. A user turn after it removes the row: the question
  was answered.

## Why not every pane

The guarantee of 0042 is that a button can only come from the orchestrator's own words. Another
agent — a worker reading an injected spec — writing the same block on its own screen would give the
operator a lie to tap. Gating on the derived orchestrator keeps the guarantee and only widens *where*
the orchestrator's own buttons show.
