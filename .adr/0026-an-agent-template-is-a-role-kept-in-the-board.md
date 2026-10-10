# 0026 — An agent template is a role, kept in the board

**Status:** Accepted
**Date:** 2026-10-10

## Context

Overgate gives its agents roles: `ovg-implementer` and `ovg-reviewer` are files in `.claude/agents/`
— a frontmatter (name, description, tools, model) and a prompt: method, limits, shape of the report.
Its orchestrator session spawns them as sub-agents. In Collie a worker is a herdr pane running a CLI
agent that the board starts with a kind and a name, and the first thing it is told is the card. There
was nowhere to say *what kind of worker this card wants*: an implementer who writes the tests first
and stops on an open design question, a read-only reviewer, a doc-only writer.

## Decision

**A template is a role: a brief, an agent kind, a model.** It is one row of `agent_template`, in the
board. Starting a card resolves its template — the card's own, else its phase's, else none — and then:

- the **brief goes in front of the card's first prompt** (`brief`, a separator, the card's prompt). It
  works with every agent kind, because it is only text;
- the **kind** is the card's explicit one, else the template's, else the board's default;
- the **model** reaches the CLI as `args` of `agent start` (`herdr agent start … -- --model sonnet`),
  and only through the kind's own flag, declared in `adapters/agents.toml` as `model_flag`. Today
  that is `claude` alone (`claude --help` lists `--model`); every other kind ignores a template's model
  and the screen says so, by the same rule as `context = true`: a claim is made for what was verified.

**Five ship**, inserted by `key` and only when missing: `implementer`, `reviewer`, `doc`, `explore`
(ADR 0017's exploration card) and `fix`. The operator may edit a shipped one and **reset** it to the
shipped text; it is never deleted. A custom one is created in the app — with the copilot drafting the
brief from a sentence, on a tap — and deleted freely (its references are cleared).

**Importing from a repository is a proposal.** `POST /api/templates/import` reads the repo's
`.claude/agents/*.md` and returns what it found; the operator saves the ones they want. Nothing is
read from a repo at start time, and nothing a repo says is applied on its own.

## What this rules out

**Templates read from the repository on every start.** A branch is where the worker writes: it could
rewrite its own role, and a brief the operator never saw would reach the next agent. Same reasoning as
ADR 0020's gate, with a weaker threat (text, not a command) but the same line: the repo proposes, the
board decides.

**Free-form CLI flags.** A model is one word that must look like one (`sonnet`, `claude-sonnet-4-5`),
validated on every write and again when the args are built. An arbitrary flag field would let a saved
template carry `--dangerously-skip-permissions` into every start.

**Restricting a worker's tools from a template** (Overgate's `tools:` line). The import shows it, and
it is dropped: tool limits are the CLI's and the repo's own settings, and a template that claims to
enforce them by prompt would be a promise nobody checks.

## Consequences

- `card.template_id` and `phase.template_id` are soft references; the table enters the backup with
  the others (the backup lists tables from the schema).
- `launchAgent` takes optional `args`; `startCard` takes optional `adapters` so the model flag follows
  the operator's own `agents.toml`. A restart that sends a special prompt (a conflict to settle) does
  not repeat the brief: that agent already has its role.
- The lead's, the copilot's and the orchestrator's prompts are still written in code. Making them
  templates is the next step, not this one.
