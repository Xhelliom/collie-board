# 0032 — A flow is a named pipeline, kept in the board

**Status:** Accepted — supersedes [ADR 0031](./0031-a-pipeline-is-an-ordered-list-of-roles-run-inside-a-run.md) on *where a pipeline lives*; its chaining rules stand

## Context

ADR 0031 stored a pipeline as a bare list of template ids on each card and phase. It has no name, is
rebuilt by hand phase after phase, and cannot be shared: the operator's mental model is a
**preset**, like a template — "Dev standard = implementer then reviewer" — defined once, then picked.

## Decision

**A flow is a row of `agent_flow`: a name, a description and an ordered list of template ids** —
the same shape of object as ADR 0026's template. Shipped ones are inserted by `key` and only when
missing (`code` = implementer → reviewer, `doc`, `explore`); the operator may edit one and **reset**
it, never delete it. A custom flow is created in Settings and deleted freely (references cleared).

**A card, a phase and a repo each point at a flow**, by id (`pipeline_id`; `repo_pref.flow_id`).
A card resolves, most specific first: its own flow, its own single template, its phase's flow, its
phase's template, **its repo's default flow**, none. The per-card and per-phase lists of ADR 0031 are
gone; an id whose flow or template was deleted is dropped (soft references).

Chaining is unchanged: fresh session per step, same branch, only inside a run (ADR 0031).

## What this rules out

**A flow written into the card or the phase.** One place to edit it, one name to read it by.
**A flow read from the repository** — the repo proposes, the board decides (ADR 0026).
**A default that overrides what the operator chose closer to the card**: the repo's flow is the last
fallback, never above a phase's or a card's own choice.

## Consequences

- `card.pipeline` and `phase.pipeline` (ADR 0031's JSON columns) are no longer read; they were
  never written outside tests and the phase screen, which this replaces.
- `/api/flows` mirrors `/api/templates` (list, create, edit, delete, reset); `POST /api/repos/flow`
  sets a repo's default. The orchestrator's skill names a flow by id.
