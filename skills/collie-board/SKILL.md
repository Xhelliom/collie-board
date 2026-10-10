---
name: collie-board
description: >-
  Read and write the Collie Board kanban from any conversation, over its local
  HTTP API. Use this skill when the user wants work turned into board cards —
  "put that in the board", "create tasks from this audit / review / TODO list",
  "file these findings" — or wants to query the board: list cards, read one,
  check what is in progress or blocked, update a status. The board is Collie
  Board's durable card layer (bridge on 127.0.0.1); each card can later be
  started as a real herdr agent in a git worktree, from the phone UI. Also use
  it to send the user a push notification on their phone from a herdr pane —
  "notify me", "ping me when…", reporting progress on a long task while they
  are away. Also use it to PLAN a project on the board — "put these cards in a
  phase", "group them into lots", "draft / update the roadmap" — phases, lots
  (planned runs) and the per-repo roadmap. You prepare; the user launches.
---

# Collie Board — cards over the local HTTP API

The bridge already exposes everything. There is no CLI and no MCP server: use
`curl`. Works **only on the machine running the bridge** — the API is bound to
loopback, and a loopback request with no `Origin` header is what the gate lets
write.

## Base URL

`http://127.0.0.1:8788` by default (`COLLIE_BOARD_PORT` overrides it).

Check it is up before anything else — a non-200 means the service is down
(`systemctl --user status collie-board`), not that the request was wrong:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/api/cards
```

If it answers `403`, the deployment has the optional device gate on
(`COLLIE_BOARD_DEVICE_HEADER`); reads still work, writes need that header. Say so
rather than retrying.

## Read

```bash
curl -s http://127.0.0.1:8788/api/cards            # every card, with live agent state
curl -s http://127.0.0.1:8788/api/cards/<id>       # one card + journal, sessions, reviews, children
curl -s http://127.0.0.1:8788/api/repos            # repos the board knows about (for repoPath)
```

Pipe through `jq` to keep the output small — `/api/cards` returns the whole
board and grows with it:

```bash
curl -s http://127.0.0.1:8788/api/cards | jq -r '.cards[] | "\(.status)\t\(.title)"'
```

## Create a card

```bash
curl -s -X POST http://127.0.0.1:8788/api/cards \
  -H 'content-type: application/json' \
  -H "x-collie-pane: $HERDR_PANE_ID" \
  -d '{
    "title": "Short imperative title",
    "spec": "What to do and why, in a couple of sentences.",
    "acceptance": ["one verifiable condition", "another"],
    "repoPath": "/home/user/git/project"
  }'
```

### Always send `x-collie-pane`

`$HERDR_PANE_ID` is in the environment of every herdr pane. Sending it is what marks the card
**agent** on the board — the same way the copilot's own cards are marked **auto** — and links it
back to the card this session is working in, so the user can tell "the agent decided to file this"
from "I dictated this". Without it the card is indistinguishable from one the user typed, which is
misleading rather than merely undocumented.

Send it on **every** `POST /api/cards`, including the ones you make on the user's explicit request:
the mark says who typed the request, and that was you either way.

Outside a herdr pane the variable is unset and the header goes empty — harmless, the board just
files the card unmarked.

Fields, all optional except `title`:

| field | meaning |
|---|---|
| `title` | **required**, the only thing shown on the board |
| `spec` | the brief the agent receives when the card is started |
| `acceptance` | array of strings, the done-conditions |
| `repoPath` | absolute path; **without it the card cannot be started later** |
| `baseRef` / `branch` | branch point and worktree branch name |
| `agentKind` | `claude`, `codex`… — defaults to the board's setting |
| `parentId` | card id of a container — use it to group a batch |
| `dependsOn` | card id that must be `done` first (a gate, nothing auto-starts) |
| `status` | `backlog` (default), `ready`, `working`, `blocked`, `review`, `done`, `archived` |
| `rawInput` | **do not use from here** — see below |

### `spec`, never `rawInput`

`rawInput` is the phone's braindump field: writing it fires the copilot, which
spends the user's API quota rewriting the text into a spec. Coming from a
conversation the text is already written — put it in `spec` and leave
`rawInput` unset.

### Batches

One `POST` per card, in a loop. When filing several findings at once, create a
container card first and pass its id as `parentId` on the rest, so the board
gets one row that expands rather than fifteen loose cards:

```bash
parent=$(curl -s -X POST http://127.0.0.1:8788/api/cards \
  -H 'content-type: application/json' \
  -H "x-collie-pane: $HERDR_PANE_ID" \
  -d '{"title":"Audit du 29/07 — 6 constats"}' | jq -r .card.id)
```

New cards land at the top of their column, so create them in reverse order if
the order on the board matters.

## Update / delete

```bash
curl -s -X PATCH http://127.0.0.1:8788/api/cards/<id> \
  -H 'content-type: application/json' -d '{"status":"ready"}'

curl -s -X DELETE http://127.0.0.1:8788/api/cards/<id>
```

## Notify the user's phone

From any herdr agent pane — started from a card or by hand — you can send a
push notification in your own words, e.g. to report progress while the user
is away:

```bash
curl -s -X POST http://127.0.0.1:8788/api/board/notify \
  -H 'content-type: application/json' \
  -H "x-collie-pane: $HERDR_PANE_ID" \
  -d '{"message":"Tests pass, starting the migration"}'
```

| field | meaning |
|---|---|
| `message` | **required**, the body (one line, ~140 chars shown); the title is your card's, or your repo's when the pane has no card |
| `kind` | `note` (default, marker **Note** — asks nothing), `question` (**Needs you** — you are waiting on them), `done` (**Done**) |
| `persistent` | `false` (default): gone from the phone after 10 min or when your pane changes status. `true`: stays until the user reads it |

```bash
curl -s -X POST http://127.0.0.1:8788/api/board/notify \
  -H 'content-type: application/json' -H "x-collie-pane: $HERDR_PANE_ID" \
  -d '{"message":"Deployed to staging — check the login page","kind":"done","persistent":true}'
```

- Either way it is withdrawn once read (or dismissed) in the app's bell, or
  when your pane closes. The bell keeps every note.
- Sent after a ~30 s debounce (several notes inside it: only the last goes
  out); a newer note from your pane replaces the older one.
- `persistent` for something the user must not miss (a result, a decision to
  make); the default for progress.
- Going `done`/`blocked` already notifies on its own — don't duplicate it.
- `404` = no herdr agent in that pane (header wrong or not in herdr).
- Don't send one per step: a milestone, or something the user must see.

## Plan a project: phases, lots, roadmap

A project is one repo: **roadmap → phase → lot → card**. You prepare all of it; **you never
launch a lot** — launching is the user's tap. Always send `x-collie-pane: $HERDR_PANE_ID`:
the launch routes refuse any request that carries it (`403`), which is the guarantee.

The project tab's **orchestrator** is this same skill running in a pane the user starts
(`POST /api/orchestrator {"repoPath"}` from the tab's "Démarrer l'orchestrateur"; `GET
/api/orchestrator?repo=` says whether it lives). You do not start it yourself — it spends the
user's quota — and its pane id is what `$HERDR_PANE_ID` carries when it plans.

- **Roadmap** — intents, not cards: a `vision` and ordered `items`
  (`name`, `goal`, `status`: `planned` | `active` | `done` | `dropped`). Turn an item into a
  phase only when the user gets to it; do not file forty cards ahead.
- **Phase** — groups a repo's cards (not a container). Its progress is derived.
- **Lot** — a *planned run*: a named, ordered set of one repo's cards inside a phase. It drives
  nothing until the user launches it.
  Set `maxParallel` (1 to 16, or null for the board's own cap) when you plan it: **1 is sequential**.
  Decide it from the cards — ones that touch the same files, or build on each other's output, get 1
  (or a `dependsOn` chain); independent ones can run side by side. Patchable while the lot is planned.

```bash
B=http://127.0.0.1:8788; H=(-H 'content-type: application/json' -H "x-collie-pane: $HERDR_PANE_ID")

# roadmap: read it first, write it back with the revision you read (0 when there is none).
curl -s "$B/api/roadmap?repo=/abs/repo"                       # {roadmap:{vision,items,revision}}
curl -s -X PUT "$B/api/roadmap" "${H[@]}" -d '{"repoPath":"/abs/repo","revision":0,
  "vision":"One paragraph.","items":[{"name":"Foundations","goal":"…","status":"active"}]}'
#   409 {kind:"revision",current:N} = someone wrote in between: re-read, merge, retry.
curl -s "$B/api/roadmap?repo=/abs/repo&format=md"             # Markdown, for the user's repo

# phases
curl -s -X POST "$B/api/phases" "${H[@]}" -d '{"repoPath":"/abs/repo","name":"Foundations","goal":"…","roadmapItemId":"<item id>"}'
curl -s "$B/api/phases?repo=/abs/repo"
curl -s -X PATCH "$B/api/phases/<id>" "${H[@]}" -d '{"name":"…","goal":"…","position":0}'
curl -s -X DELETE "$B/api/phases/<id>" "${H[@]}"              # releases its cards and lots, deletes neither

# put a card in a phase (at creation, or later)
curl -s -X PATCH "$B/api/cards/<id>" "${H[@]}" -d '{"phaseId":"<phase id>"}'

# lots: a PLANNED run. `foldInCap` is required (0 = the lead folds nothing in).
curl -s -X POST "$B/api/runs" "${H[@]}" -d '{"planned":true,"cardIds":["<id>","<id>"],"foldInCap":2,
  "phaseId":"<phase id>","name":"Lot 1","position":0}'
curl -s "$B/api/runs?repo=/abs/repo"                          # lots and runs, with cardIds
curl -s -X PATCH "$B/api/runs/<id>" "${H[@]}" -d '{"name":"…","position":1,"cardIds":["<id>"]}'  # planned only
curl -s -X DELETE "$B/api/runs/<id>" "${H[@]}"                # planned only; releases the cards
```

A card sits in at most one lot (`409` otherwise). Order lots by `position`, cards inside a lot
by `dependsOn`. **State lives in the board, not in this conversation**: when you start, read the
roadmap, `/api/phases` and `/api/runs` rather than relying on what you remember. Tell the user
what you prepared and let them launch it.

## What to confirm with the user first

These spend quota or drive a real terminal. Never fire one unasked:

- `POST /api/cards/<id>/start` — cuts a git worktree, opens a herdr workspace and
  launches an agent on the card.
- `POST /api/cards/<id>/prompt` (`{"text":"…"}`) — types into that agent's pane.
- `POST /api/cards/<id>/reformulate` — hands the card to the copilot.
- `POST /api/cards/<id>/handoff`, `DELETE` on a card that has work in it.
### Roadmap, decisions, memory (ADR 0023)

The roadmap is a **document you write with the user**, not three lines. When it is empty, run a real
brainstorm: one theme at a time (vision, audience, loop, constraints, risks, order of phases), restate,
get a yes. The brainstorm itself is the phase « Cadrage » (a roadmap item `active` + a phase of that name);
mark it `done` when the user validates the plan. Cut ONLY the next phase into lots and cards.

```bash
# items carry a long form: objective, end-of-phase demo, risk, why here (Markdown, ≤ 20000 chars)
curl -s -X PUT "$B/api/roadmap" "${H[@]}" -d '{"repoPath":"<repo>","revision":<read>,"vision":"…",
  "items":[{"id":"p0","name":"Cadrage","status":"active","goal":"…","detail":"## Démo\n…"}]}'
# write EACH decision the moment it is taken; reuse its id to settle an open question
curl -s -X POST "$B/api/roadmap/decision" "${H[@]}" -d '{"repoPath":"<repo>","text":"Équipes de 16","status":"decided","itemId":"p0"}'
#   status: decided (✅) | leaning (🟡) | open (❓)
# your memory: one short note (≤ 4000 chars) to your next self — update it at every milestone
curl -s "$B/api/orchestrator/memory?repo=<repo>" "${H[@]}"
curl -s -X PUT "$B/api/orchestrator/memory" "${H[@]}" -d '{"repoPath":"<repo>","note":"où on en est · écarté · prochaine question"}'
# exports the user commits into the repo (you never write there)
curl -s "$B/api/roadmap?repo=<repo>&format=md"      # the detailed roadmap
curl -s "$B/api/roadmap?repo=<repo>&format=steps"   # step by step — rendered from phases, lots, cards
```

The user hands you over (`/api/orchestrator/renew`) when your context fills: the route refuses your own
pane header. Write your note when asked.

- `POST /api/runs/<id>/launch`, and `POST /api/runs` **without** `planned:true` — both start work;
  they are the user's, and refuse your `x-collie-pane` anyway.
- **Validating a phase** (`POST /api/phases/<id>/close`, `.../reopen`, `POST /api/phases/seal`) — see
  *Milestones* below. They are the user's too, and refuse your `x-collie-pane`.

### Milestones (ADR 0025): propose, never validate

A project is never "100 % done": progress is read **per milestone**, and a milestone is a **phase the user
has validated**. The page's ring and counters only count the work that is not in a validated phase; what was
delivered is kept ("N steps delivered in M validated phases").

- **Close** — `POST /api/phases/<id>/close {"moveOpenTo": "<open phase id>" | null, "note": "…"}`: finished
  cards stay in the phase, frozen; open ones move to `moveOpenTo` (or to no phase); the linked roadmap item
  becomes `done`. `409` while the phase still has a lot that is not over. `POST …/reopen` undoes it.
- **Seal** — `POST /api/phases/seal {"repoPath": "…", "name": "v1"}`: for an old project with **no phases**,
  makes one already-validated phase and files every finished, phase-less card under it (never a container, which
  holds no work). Add `"cardIds": ["…"]` to seal only those — one old dictation's steps, say. `400` if there is none.
- `GET /api/phases?repo=…` shows `closedAt` / `closedNote` (null = in progress).

**You do not do these.** All three refuse your `x-collie-pane` (`403`). When a phase looks done — every step
filed, nothing open — **say so and propose the validation**, naming where the open steps would go; the user
taps it. Likewise for an old project whose figure sits near 100 %: propose "validate what is finished as a
first milestone" instead of leaving a number that means nothing.

Creating and reading cards is free and reversible — no need to ask.

## Typical flow: turning an audit into cards

1. `GET /api/repos` if you need the exact `repoPath` (or use the repo you are in).
2. Create the container card, keep its id.
3. One `POST` per finding: imperative `title`, `spec` naming the file and the
   problem, `acceptance` stating how to tell it is fixed, same `parentId` and
   `repoPath`.
4. Report the count and the container's title. The user starts them from the
   phone — you never start them.

### Agent templates (ADR 0026)

A template is a **role** for a worker: a brief (put in front of the card's first prompt), an agent kind and a
model. Five ship — `implementer`, `reviewer`, `doc`, `explore`, `fix` — and the user makes more in Settings.
You can read them and attach one; you never start a card.

```bash
curl -s "$B/api/templates"                                   # {templates:[{id,key,name,description,agentKind,model,brief,builtin}], modelKinds:["claude"]}
curl -s -X PATCH "$B/api/cards/<id>" "${H[@]}" -d '{"templateId":"<template id>"}'     # null clears it
curl -s -X PATCH "$B/api/phases/<id>" "${H[@]}" -d '{"templateId":"<template id>"}'    # every card of the phase without its own
curl -s -X POST "$B/api/cards" "${H[@]}" -d '{"title":"…","repoPath":"…","templateId":"<id>"}'
```

Choose from the card: a doc-only card gets `doc`, a bug gets `fix`, an investigation gets `explore`, ordinary
tickets get `implementer`. A card's own agent kind wins over the template's; the **model** is passed only to the
kinds in `modelKinds` (today `claude`). Do not create or edit templates unasked — they are the user's roles, and
`POST /api/templates/import` (a repo's `.claude/agents/*.md`) only ever *proposes*.

### Gate and facts (ADR 0020) — read, don't set

A repo may have a **gate**: a command the user set (build, tests, lint) that the board runs in a worker's checkout
every time it lands, before the lead judges it. Red goes straight back to the worker. It is the user's alone — do
not set or change it (`POST /api/repos/gate` and `/suggest` are their screens); but know it exists, because a card in a
gated repo is checked by a machine first.

```bash
curl -s "$B/api/repos" | jq '.repos[] | {path, gate}'        # gate = the command, or absent
curl -s "$B/api/project/facts?repo=/abs/repo"                # per card, read off its journal: gate result, the lead's
                                                              # verdict and reason, review verdict, PR + auto-merge,
                                                              # times sent back, template, start/end
```

Use the facts to say *why* a card is stuck or sent back before proposing a next step, instead of guessing.
