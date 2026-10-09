# 0020 — The gate is the operator's command, run before the lead

**Status:** Accepted
**Date:** 2026-10-09

## Context

ADR 0017's lead judges a landed worker from the diff, the spec and the acceptance criteria. Nothing
in a run executes the repo's own checks. Overgate's pipeline puts a machine verdict (`tools/ovg gate`:
lint, build, tests) ahead of any review — "an agent never validates another's work on its word" —
and escalates after a few reds. Without that, the lead spends a worker's worth of quota reading code
that does not compile, and can approve code it cannot see failing.

## Decision

**A repo may have one *gate*: a command the operator set, which the coordinator runs in the worker's
checkout on every landing, before the lead is asked.**

- **Red** goes straight back to the worker with the tail of the gate's output. The lead is not asked.
  It is journaled as a `run.gate` and a `run.decision: prompt`, so it counts as a round and
  `MAX_ROUNDS` is the escalation to the operator.
- **Green** is journaled, and the lead is asked as before — told the gate passed, so it looks for
  what a gate cannot see instead of re-checking it.
- **A gate that cannot give a verdict** (missing binary, timeout) halts the card. That is the
  operator's to fix, not the worker's fault.
- No gate set: nothing changes.

**Where the command lives: the board's database, set through `POST /api/repos/gate`.** Not in a file
in the repo.

## What this rules out

**A gate read from the repo** (`.collie-board.toml` and the like). The worker edits that checkout; the
bridge would run whatever it wrote, outside the agent's own permission prompts. The command is
remote execution by the bridge, so it is the operator's, behind the write gate, and audited.

**A shell.** The command is split on whitespace and run as argv. Quotes, pipes and `&&` mean nothing;
wrap them in a script and name the script. This keeps `CLAUDE.md`'s "never a shell" intact.

**The coordinator deciding what the gate means.** It runs the command and reads the exit code —
nothing about the output's content. Judging is still the lead's.

## Consequences

- `bridge/gate.ts` is the second place the bridge runs a process, after `git.ts`.
- A run on a gated repo spends no lead quota on a red landing.
- A long gate holds the card's slot while it runs (30 min cap, then halt).
- Not yet: a UI to set the gate (the route and `GET /api/repos`'s `gate` field exist), per-lane
  parallelism, a model per role.
