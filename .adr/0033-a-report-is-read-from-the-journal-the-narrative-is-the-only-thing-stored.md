# 0033 — A report is read from the journal; the narrative is the only thing stored

**Status:** Accepted — extends [ADR 0028](./0028-the-orchestrator-is-woken-by-the-board-at-the-end-of-a-lot.md) (the end-of-lot bilan)

## Context

When a lot ends, ADR 0028 wakes the orchestrator and asks it for a short bilan. The answer lives in
its pane and evaporates: it cannot be reopened from the lot or the phase, and it exists only if the
agent happened to answer. A project also has no one place to read what happened: a card's journal,
the roadmap's decision journal and the notification bell each hold a slice.

## Decision

**A bilan is two parts, and only one is stored.**

- **The facts are read, never stored.** For a lot (a run) or a phase, the bridge computes them from
  what it already keeps — the cards' journals and the run's `run.*` entries: cards merged and their
  PR, cards halted or blocked and why, rounds and send-backs, the flow each card went through,
  duration. A phase's bilan is its lots' plus the note it was validated with. No agent, no quota, and
  it exists whether or not anyone wrote anything. (`card` durable, `session` ephemeral: a fact the
  journal can answer is not copied.)
- **The narrative is stored.** A short Markdown text for a lot or a phase — what happened, what
  remains — written by the orchestrator (the end-of-lot wake now asks it to *write* it, not say it)
  or by the operator. One row per scope (`project_report`): re-writing replaces it.

**The project journal is a timeline read from the same entries, plus notes.** Lots launched and
finished, cards merged or halted, phases validated, roadmap decisions — for one repo, newest first,
paged. The only new data is the **note** (`project_note`): free text for what happens outside the
board — a decision, an incident, an idea. Append-only; its author is **derived** from the
`x-collie-pane` header (`orchestrator` or `operator`), never declared (ADR 0010).

## What this rules out

**A fourth journal with its own events.** The timeline is a view; the card journal, the run journal and
the roadmap's decisions stay the one source of each fact.
**A bilan written by an agent for every event** — it would spend the operator's quota to restate what
the journal already says.
**A narrative that rewrites the facts.** It sits beside them; the facts are always recomputed.
**The orchestrator deleting a note.** It may add one; removing is the operator's.

## Consequences

- Both tables enter the backup (it lists tables from the schema).
- Routes: `GET /api/project/report`, `PUT /api/project/report` (the narrative), `GET /api/project/journal`,
  `POST /api/project/notes`, `DELETE /api/project/notes/:id` (refused for an agent pane). The skill
  documents the first four; the delete is the operator's.
- The end-of-lot message (ADR 0028) asks the orchestrator to `PUT` its bilan; if it never does, the
  report still opens with its facts.
- Facts are read by walking a lot's cards' journals: bounded by the journal's own size, and cheap enough
  to compute per open rather than cache. A cache is the answer only if a project's journals grow past it.
