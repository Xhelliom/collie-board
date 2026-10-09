# 0021 — A project is a roadmap, phases and lots, planned by an agent that never launches

**Status:** Accepted
**Date:** 2026-10-09

## Context

The operator's way of running a project (Overgate, by hand): a **roadmap** of phases that is
iterated on; each phase cut into **lots** of tickets run together; an orchestrator that plans with
them and launches the lots. Collie has the bottom of that — cards, `depends_on`, a *run* (ADR 0017) —
and nothing above it. The project view (read-only, derived) can only group by *container*, and a
container is something else: a dictation split into sub-tasks, not startable, status derived.

Two things were weighed and are decided here: what the missing levels are made of, and who plans
them.

## Decision

**Four levels, one repo each: roadmap → phase → lot → card.**

- **Roadmap** — one document per repo, **in the board's database**: a vision and an ordered list of
  items (`name`, `goal`, `status`: planned / active / done / dropped). Entries are *intents*, never
  cards; they become a phase when the operator gets to them, so there are never forty stale cards
  waiting. It can be exported as Markdown (`GET /api/roadmap?repo=…&format=md`) — **one way, board
  to repo**: the caller writes and commits the file, the bridge never writes into a repo, and
  nothing imports it back.
- **Phase** — a table (`phase`: repo, name, goal, position, optional roadmap item) and
  `card.phase_id`. Not a container. Its progress is derived from its cards, as everything in the
  project view is; the view falls back to containers for a repo with no phase.
- **Lot** — a **planned run**: a run gains `phase_id`, `name`, `position` and `launched_at`. Until
  launched it drives nothing; the coordinator skips it. A lot is composed ahead, in order, then
  launched.
- **Launching is the operator's gesture.** ADR 0017's consent is unchanged: given once, over a chosen
  set. Everything before it can be prepared by an agent.

**The planner is a per-repo *orchestrator* agent, not the lead.** It is a conversational agent pane
in the repo (`ensurePane`, its own label), started by the operator's tap on the project tab, and
shown in a panel there by embedding the existing pane chat. It plans through the board's HTTP routes,
with the `collie-board` skill — the same door as any consumer (ADR 0013) — and every card it files is
traced by its `x-collie-pane` header (ADR 0010). **The launch route refuses that header**: the agent
that plans cannot start what it planned.

**The lead stays what ADR 0017 made it** — a judge that reads and speaks, never edits, starts or
merges. The orchestrator writes to the board; the lead must not. Two roles, two prompts.

**State lives in the board, not in the conversation.** Roadmap, phases and lots are rows; an
orchestrator pane that dies or compacts is replaced by one that reads them.

## What this rules out

**A phase as a container.** It would make every split card a phase and every phase refuse a branch.

**Roadmap entries as cards.** A card is a thing to start; an intent three phases away is not.

**Importing the repo's Markdown.** Two writers means two truths — Overgate's plan-as-source problem
turned around. The export is a copy.

**An orchestrator that launches.** It would turn "these, run them without me" into "run whatever I
decide", with the operator's consent given to nobody in particular.

**One lead-and-orchestrator.** The judge would gain write powers, or the planner a silent voice.

**An orchestrator started on its own.** It spends the operator's quota; it starts on a tap.

## Consequences

- The migration is additive: `phase` and `roadmap` tables, `card.phase_id`, three run columns.
  Existing runs are launched ones (`launched_at` = their creation).
- The `collie-board` skill gains the phase / lot / roadmap routes; that is how any session — the
  panel's or the operator's own terminal — plans.
- The lead is still one pane for every repo, serialised. A lead per repo is deferred until two repos
  run at once and it hurts.
- A library for typed model output instead of the lead's JSON answer files is a separate question:
  it changes how the lead is called, not what a project is.
