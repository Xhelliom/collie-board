# 0017 — A run is consent given once, over a chosen set of cards

**Status:** Accepted
**Date:** 2026-09-16

## Context

The operator's loop over a repo, done by hand today:

1. create the tasks;
2. start them in what looks like the right order;
3. check whether the work is good;
4. ask the agent for a summary;
5. judge;
6. if it is good, open a PR;
7. merge the PR once CI is green.

Apart from 1, the operator mostly taps. The question was whether the copilot, or another role,
could take over part of that loop.

The first answer was "no orchestrator", on the strength of two decisions already written: *the
dependency is a gate, not a trigger* (`ARCHITECTURE.md` §9) and *the copilot is off by default*.
Both answer one danger: **code written and quota spent with nobody watching, because the board
decided on its own.** That is the right rule for the board's *defaults*. It is not an answer to
this request, which is different in kind: **the operator picks five cards and says "these, run
them without me".** The consent is given up front, its scope is exactly that set, and nothing
outside it moves. What the two rules protect is intact — the board still never decides on its own;
it executes a decision the operator made once, for a named set, instead of once per tap.

## Decision

**A *run* is a chosen set of cards of one repo that the operator hands over in one gesture.** From
that gesture until the run ends, the board drives those cards through the loop by itself. Cards
outside the run are untouched, and every board default stays as it is.

### Who drives it: a *lead* agent per run, and a coordinator that only plumbs

What the operator actually does between two taps is not a read of state. They open the diff, ask
themselves whether a drift is the agent finding a better path or losing the thread, tell the coder
"commit, and finish the second criterion", and decide whether the follow-ups a review filed deserve
to exist. That is judgement over code and a conversation with the worker, and **it needs an agent**.

**The lead is not the copilot.** The copilot is arranged to be cheap and safe as a default: off,
serialised, judging from `--stat` and a note, never reading the repo (`CLAUDE.md`, ADR 0012). The
lead is the opposite bargain, and the run's gesture is what pays for it: **it reads the code in the
worker's checkout, it talks to the worker, and it decides.** Folding that into the copilot would
make the default reviewer expensive, or the lead blind — one of the two rules would break. Two
roles, two prompts, the same plumbing: `ensurePane` (its own pane, in the repo, adopted by cwd),
the serialised file-answer request, and `promptAndConfirm` to speak to a worker.

**The lead judges and speaks; it never edits, starts, pushes or merges.** Every act on the world
goes through the same routes a tap would use, called by the coordinator on the lead's word, so the
gates of `integrate.ts` and the traces of ADR 0010 apply unchanged. And **every decision is written
to the card's journal with its reason** — that journal is what the operator reads instead of the
diff.

**The coordinator** (`bridge/run.ts`, on `engine.onUpdate`) is deterministic plumbing: it starts
startable members while a slot is free, notices a worker going idle, hands the lead a question, and
executes the answer. It is not a timer; it moves when a snapshot changes.

### The seven steps, under a run

| Step | In a run | Carried by | Missing |
| --- | --- | --- | --- |
| 1. Create | **Operator** — plus choosing the set, which *is* the consent | Cards, reformulation, `depends_on` | Multi-select + "Run these" gesture |
| 2. Start in order | **Coordinator** | `depends_on` as the order; `startCard` / `launchAgent`; `boardMaxAgents` as the cap | The coordinator |
| 3. Check | **Lead**, on every worker idle | The worker's checkout, `cardDiff`, the card's spec and acceptance | The lead: reads the diff, finds what is missing or drifted, and either prompts the worker back to work ("commit; criterion 2 is not met because…") or declares the card finished. Bounded: N rounds per card, then halt to the operator |
| 4. Summary | **Coordinator** | `wrapupPrompt`, `WrapupCoordinator` | Filing `done` on the lead's word instead of a tap |
| 5. Judge | **Lead** | The copilot's review still runs and its verdict and follow-ups land on the card; the lead reads them *with* the diff | The lead's triage: a `drift` it already judged justified is accepted with its reason; each follow-up is kept, folded into the run, or deleted with its reason; the fold-ins are capped so the run cannot grow without limit |
| 6. Open a PR | **Coordinator**, on the lead's word | `prForCard` (fetch, `merge-tree`, push, create, file, cleanup — ADR 0014); on conflict `resolveConflict` to the worker, the lead re-checks after | Calling it without a tap |
| 7. Merge on green | **GitHub** | `gh pr merge --auto`; `prStatusFor` already reads `mergedAt` | Passing `--auto` after create. No branch protection → GitHub refuses → the card counts as done with its PR open |

What stays with the operator, inside a run: the set; a card the lead gives up on after its rounds;
a conflict the worker could not resolve; a **blocked** worker — a permission prompt stalls that card
as it does today, the existing notification says so, and neither the lead nor the run answers
prompts. The lead's journal is the operator's read; the diff stays one tap away.

### Phases before the code: exploration and ideation

A run is not only "code these five". A member may be an **exploration** card — brainstorm,
ideation, a design question — whose deliverable is a written conclusion and the cards it proposes,
exactly the shape of the card that produced this ADR. The loop above already covers it: the worker
writes the conclusion into the repo and files the proposed cards through the API (ADR 0010 traces
them to it), the lead reads the conclusion as it would a diff and triages the proposals — kept,
folded into the run under the cap, or dropped with a reason — and the cards it folds in become the
next members, ordered by `depends_on` on the exploration card. So a run can go *explore → decide →
implement → PR* with the operator hearing back once at the end, or at the first triage the lead is
not sure of.

What makes this cheap: nothing in it is a new phase for the board. It is a `category` (`explore`)
that changes the lead's *check* question — "does the conclusion answer the question and propose
cards it can defend?" rather than "is the diff complete?" — and leaves every route the same.

### How a run ends

A run has a readable end and therefore may speak in the herd's slot (ADR 0011): **finished** when
every member is filed, **halted** when a card needs the operator, retracted when they act on it.

### Durable vs. runtime

Membership is intent, so it is a column: `run_id` on the card, one `run` row with its repo,
created-at and the fold-in cap. The lead's decisions are journal entries. Everything else — which
worker is alive, which card the lead is looking at — is read from the snapshot, as the fork's rule
requires. A bridge restart resumes the run from the cards' state.

## What this rules out

**A global "autopilot" switch.** Consent is per set, never per board.

**The copilot as the lead.** It would make the default reviewer read the repo and spend a worker's
worth of quota on every card, or leave the lead judging from `--stat`. Two roles.

**The lead editing code or pushing itself.** It asks the worker, in the worker's checkout; the
coordinator pushes through the same route a tap would. One writer per checkout, and every act
traced.

**A run that grows without a cap.** Fold-ins are the lead's call, up to the number the operator set
at the gesture; past it, a follow-up is a card for later.

**The board merging when CI is green.** A periodic read of GitHub, refused in ADR 0014. GitHub's
auto-merge is that watcher.

## Implementation cards

Each is its own commit, fork-only, and touches no upstream file:

1. **`run` row + `run_id` column + `run.*` journal kinds** — `db.ts` additive migration; `types.ts`.
2. **Multi-select + "Run these"** — `web/src/`: select cards of one repo; one sheet showing the
   order (from `depends_on`), the parallelism (`boardMaxAgents`), the fold-in cap, and the lead's
   agent kind; `POST /api/runs`.
3. **`Lead`** — `bridge/lead.ts`: the copilot's pane + request plumbing extracted into a shared
   base (or reused as-is with a second instance and its own workspace label), plus three prompts,
   pure and exported: *check* (diff + spec + acceptance → `finished | prompt the worker: "…"`),
   *triage* (review verdict + follow-ups → keep / fold / drop, each with a reason), *conflict
   re-check*. Answers are JSON files, like the copilot's.
4. **`RunCoordinator`** — `bridge/run.ts` on `engine.onUpdate` (one line in `index.ts`): slots,
   idle detection, the lead's questions and the execution of its answers through `promptAndConfirm`,
   `fileAsDone`, `prForCard`, `resolveConflict`, card create/delete; rounds cap; halt/finish
   predicates. Pure logic, `bun test`.
5. **Auto-merge after create** — `git.ts` gains `gh pr merge --auto --<strategy>` as argv;
   `prForCard` takes an `autoMerge` flag the run sets. A refusal is journaled, not an error.
6. **Run alerts** — `board-notify.ts`: `run.finished`, `run.halted(card)`, retraction on operator
   action. Census line in `NOTIFY_AUDIT.md` §6.
7. **`explore` category** — `pickCategory` and the card create allowlist accept it; the lead's
   *check* prompt branches on it; the exploration's proposals are the cards it files itself.
8. **Lead journal on the card screen** — `web/src/`: render `run.*` entries (decision + reason) in
   the card's journal, which the app already shows.
9. **Docs** — `ARCHITECTURE.md` §9 gains a paragraph on runs and the lead beside "a gate, not a
   trigger", pointing here.

## Consequences

- The by-hand loop is unchanged for every card not in a run; the two older rules still describe
  the default.
- For a run, the operator writes the cards, chooses them, and hears back at the end or at the first
  card that needs a human.
- A run spends quota unattended — the workers, the lead's reads, and the copilot's reviews — by
  design and by the operator's choice, bounded by `boardMaxAgents`, the set, the fold-in cap and
  the rounds per card.
- The lead's journal replaces the operator's reading of every diff; the diff is still one tap away.
