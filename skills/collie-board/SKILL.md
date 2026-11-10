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

The bridge already exposes everything. There is no CLI: use `curl`. (An MCP server, `bridge/mcp.ts`, wraps this same API for
MCP clients; same guards, `HERDR_PANE_ID` (or hc's `HC_TERMINAL_ID`) relayed as `x-collie-pane`. Its `message_orchestrator(repoPath, text)` types `[vocal] <text>` into the live orchestrator's pane — a message from the operator by voice; it starts nothing if none lives. `notify` is offered only to a client with a pane. `project_roadmap(repoPath, format?, phase?)` reads the roadmap — `md` or `steps`, clipped — then the cards of the open phases, or of one, with status, flow and lot.) Works **only on the machine running the bridge** — the API is bound to
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
curl -s 'http://127.0.0.1:8788/api/cards?view=summary'  # the light list (below)
curl -s http://127.0.0.1:8788/api/cards/<id>       # one card + journal, sessions, reviews, children
curl -s http://127.0.0.1:8788/api/repos            # repos the board knows about (for repoPath)
curl -s http://127.0.0.1:8788/api/repos/listed     # {"paths":[…]} repos the operator added to the project lists by hand
```

The project lists are the repos with cards plus those `listed` ones. The operator adds or takes one off
(`POST /api/repos/listed` with `{"path":"/abs/repo","listed":true|false}`) — it touches no card; leave it
to them unless asked.

Pipe through `jq` to keep the output small — `/api/cards` returns the whole
board and grows with it:

```bash
curl -s http://127.0.0.1:8788/api/cards | jq -r '.cards[] | "\(.status)\t\(.title)"'
```

`/api/cards?view=summary` is the same list, lighter: no `spec`, `acceptance` or `rawInput` (a
`specLine` — the spec's first line — and an `acceptanceCount` stand in), and of the `done` cards only
the 5 newest per repo plus those still tied to open work (an open phase, the parent or `dependsOn` of
an unfinished card). `counts` covers every done card: `delivered` (last 7 days), `doneByRepo`,
`doneByPhase`. Read one card's spec with `/api/cards/<id>`.

What the bridge spends its CPU on, since it started — per route (method + path, ids as `:id`):
calls, cumulated / average / max handler time in ms, bytes sent, 304s; plus the background loop
as `engine poll` and `engine enrichSessionNames`, each `engine.onUpdate` subscriber as
`onUpdate <name>` (its synchronous part), the herdr event stream as `events stream` (decode),
`event <type>` (a count per type) and `events poke` (the polls it asked for, at most one a second).
Busiest first:

```bash
curl -s http://127.0.0.1:8788/api/diag/routes | jq -r '.routes[] | "\(.totalMs)ms\t\(.calls)\t\(.route)"' | head
```

## Create a card

```bash
curl -s -X POST http://127.0.0.1:8788/api/cards \
  -H 'content-type: application/json' \
  -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" \
  -d '{
    "title": "Short imperative title",
    "spec": "What to do and why, in a couple of sentences.",
    "acceptance": ["one verifiable condition", "another"],
    "repoPath": "/home/user/git/project"
  }'
```

### Always send `x-collie-pane`

`$HERDR_PANE_ID` is in the environment of every herdr pane (`$HC_TERMINAL_ID` under herdr-core). Sending it is what marks the card
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
| `baseRef` / `branch` | branch point and worktree branch name. Omit `baseRef` and the board fills in the repo's default branch (`origin/HEAD`, else `main`/`master`); send one only when the work really must fork from elsewhere — or when the repo has none of those, since the board then fills in nothing rather than guess |
| `agentKind` | `claude`, `codex`… — defaults to the board's setting |
| `parentId` | card id of a container — use it to group a batch |
| `dependsOn` | card id that must be `done` first (a gate, nothing auto-starts) |
| `status` | `backlog` (default), `ready`, `working`, `blocked`, `review`, `done`, `archived` |
| `category` | create-only: `explore` (a question, its output a conclusion) or `business` (writing, marketing, an offer — its deliverable a document or a page: no gate, no CI required, the lead judges the text, its recette reads « à relire ») |
| `rawInput` | **do not use from here** — see below |
| `assignee` | who the card is meant for, as a git identity (`user.email`) — an intention, not a right; also settable by PATCH, `null` clears it |

Read-only, on a shared board (ADR 0048 §5): `createdBy` is the git `user.email` of the pair that created the card — derived by the bridge, never taken from a body (an agent's card too: `origin: agent`, `createdBy` = the machine's owner). `null` on an unshared repo and on cards older than the field. Both travel through the shared journal. `GET /api/cards` and `GET /api/cards/:id` also return `identities`: per shared repo, `{ me, people }` — this pair's `user.email` and every identity the repo knows (journal authors, creators, assignees); an unshared repo is absent.

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
  -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" \
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

### Manual tests — the « recette »

At the end of a card that changes something a person can see or do, write 1 to 5 steps the operator
can test by hand. Usage, not code: each step is ONE line (≤ 100 chars) — verb + where + what to
expect — in the user's words; never a route, a file name or a PR (the card already shows those).
`capability` is what the user can now DO, `usageGroup` the use it serves. A step may name a
deliverable of the card in `shot`. Purely internal work (tests, refactor, invisible fix): nothing.

```bash
curl -s -X PATCH http://127.0.0.1:8788/api/cards/<id> -H 'content-type: application/json' \
  -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" -d '{
  "capability": "Lancer une carte sur dev depuis l’éditeur",
  "usageGroup": "Piloter une autre machine",
  "manualChecks": [{"text": "Choisir « dev » dans Environnement", "expected": "le chip dev apparaît", "shot": "dev.png"}]
}'
```

A step without `id` gets one from its text: rewording a step asks for a fresh verdict.

**The verdict is the operator's** — `POST /api/cards/<id>/checks/<stepId>` `{status: ok|ko|skip, note?,
followUp?}` is refused (403) to any `x-collie-pane`: an agent does not pass its own recette. `by` is
derived (the pair's git identity on a shared repo, else `operator`). `followUp: true` with a KO and a
note files a card linked back by `originCardId`. Steps and verdicts travel through the shared journal.

`GET /api/recette?repo=<path>&since=<epoch ms or date>&all=1` — delivered cards (done/archived) that
have steps, newest first, grouped by `usageGroup`: `{groups:[{usage, entries:[{cardId, capability,
state: todo|ok|ko, deliveredAt, phaseId, phase, runId, lot, prUrl, project, steps:[{id, text, expected?,
shot?, verdict}]}]}]}`. `prUrl` is the card's PR, or its lot's for a one-PR lot; `project` (the repo's
name) is set only when no `repo` is given. Fully validated cards are left out unless `all=1`.

### Run a card on another machine (ADR 0046 §4)

A card may carry `"environment": {"peer": "dev", "name": "dev-board"}` (create or PATCH; `null` = this
machine). Its start then goes to that paired peer, never here; diff and end go through it too.

```bash
curl -s "http://127.0.0.1:8788/api/repos/environments?repo=/home/user/git/project"
# {remote, environments:[{peer, name, agent, remote}], blocked:[{peer, reason}], unreachable:[{peer, error}]}
#   environments: usable ones whose origin is this repo's; blocked: a reached peer with none, and why
curl -s http://127.0.0.1:8788/api/cards/<id>/remote   # {environment, session, state} — reads the peer once
```

**Making a repo launchable from another machine** is the operator's, on the machine that runs the
agent (the peer), in that project's settings, *Run from another machine* — never by an agent (those routes refuse an agent pane), never
by editing `node.toml` (a hand edit is still taken without a restart). Tell the user the steps when
`blocked` names a `reason`:

1. Pair both machines (code from that peer's Settings → Peers). A new peer may launch **nothing**.
2. `no-environment` / `origin-mismatch` — on the peer, the repo's settings: *Offer this repo to the
   other machines* (same `origin` as here; clone it there and add it to its projects first), an agent.
3. `launch-not-granted` — same section, tick *Allow launching from <this machine>*. That
   grant is the only consent asked (ADR 0051): the repo's autonomy there is not needed and not
   touched. Claude Code's « trust this folder » is pre-accepted for each checkout a peer launches,
   so it never blocks a remote start.

A retried start reuses the card's checkout on the peer (and keeps an agent already in it).

## Publish a deliverable on a card (« Publier un livrable »)

What you made for a card — an image, a PDF, a spreadsheet, a report — is lost with your session
unless you publish it. The bridge keeps it under the card, after the worktree is merged and gone
(ADR 0045).

**When:** every render the operator will want to see — an image, an animation exported as
GIF/WebP/MP4, a screenshot, a report, a spreadsheet. Publish it as soon as it exists, not at the end.

**With the MCP server** (`collie-board`): `publish_file {path}` — it reads the file on your disk and
sends it to the card your pane works on (`cardId`/`name` optional). `list_deliverables {cardId |
repoPath}` and `read_deliverable {cardId, name}` read them back (an image comes back as an image).

**Without MCP**, the same with curl. Send the **bytes**, never a path; send `x-collie-pane` so it is
marked as yours. Your card id is the `cardId` of your pane in `GET /api/snapshot`.

```bash
H=(-H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}")
curl -s -X POST "http://127.0.0.1:8788/api/cards/<id>/deliverables?name=chart.png" "${H[@]}" \
  --data-binary @chart.png                     # → {name, size, mime}; a taken name gets "-2"
curl -s http://127.0.0.1:8788/api/cards/<id>/deliverables          # [{name, size, mime, publishedAt, by}]
curl -s http://127.0.0.1:8788/api/cards/<id>/deliverables/<name>   # the file
curl -s -X DELETE http://127.0.0.1:8788/api/cards/<id>/deliverables/<name>
```

25 MB max. No SVG (415) — publish a PNG. Images, Markdown, HTML (scrubbed, sandboxed) and PDF
render in the app; anything else downloads as an attachment.

## Notify the user's phone

From any herdr agent pane — started from a card or by hand — you can send a
push notification in your own words, e.g. to report progress while the user
is away:

```bash
curl -s -X POST http://127.0.0.1:8788/api/board/notify \
  -H 'content-type: application/json' \
  -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" \
  -d '{"message":"Tests pass, starting the migration"}'
```

| field | meaning |
|---|---|
| `message` | **required**, the body (one line, ~140 chars shown); the title is your card's, or your repo's when the pane has no card |
| `kind` | `note` (default, marker **Note** — asks nothing), `question` (**Needs you** — you are waiting on them), `done` (**Done**) |
| `persistent` | `false` (default): gone from the phone after 10 min or when your pane changes status. `true`: stays until the user reads it |

```bash
curl -s -X POST http://127.0.0.1:8788/api/board/notify \
  -H 'content-type: application/json' -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" \
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

## Organise a repo's documentation

When asked to set up or tidy a project's docs, follow
[`docs/conventions/DOC_CONVENTION.md`](../../docs/conventions/DOC_CONVENTION.md) (in the Collie Board
repo): a common base (`docs/README.md` index, short `AGENTS.md`, ADRs, plan by phase, statuses ✅🟡❓)
plus one "what we build" module (game · product · tool · infra). Ask its §3 questions to pick the
module; on an existing repo **propose a mapping, move nothing yourself**, migrate by PR. Its
`json doc-paths` block is the machine-readable path list.

Read a repo's docs as they stand on its default branch (from git's tree — never the working copy).
Any project the board knows (`GET /api/repos`, hidden ones included) can be read this way, read-only —
another repo's too; a path the board does not know is refused **403**. With the MCP server:
`read_project_docs {repoPath}` lists them by rubric then the decisions, `read_project_docs {repoPath, path}`
reads one file. To change a doc, never write it from the board: the operator's « Demander une modif »
files a card (the file + what to change) and the agent that takes it opens the PR.
- `GET /api/docs?repo=<path>` — `{ ref, rubrics:[{id,label,docs:[{path,title,size}]}], other, decisions }`:
  every `.md` classed by those rubrics (`other` = outside the convention), and `decisions` = the ADRs
  (`kind:"adr"`, status and date read in the file) merged with the roadmap's (`kind:"roadmap"`), newest first.
  `bilan` = the gaps to the convention, one `{code,…}` each (`missing`, `noModule`, `agentsLong`,
  `agentsMany`, `decisionsTwice`, `tooBig`, `noStatus`); empty when the docs follow it. Its « Mettre la
  doc aux normes » files a card: the agent asks first (an open decision with the card's `cardId`), then
  proposes a mapping by PR — nothing moved or deleted outside one.
- `GET /api/docs/file?repo=<path>&path=<repo-relative .md>` — `{ path, text, truncated }`; 404 when absent.
- `GET /api/docs/search?repo=<path>&q=<text>` — `{ paths }` whose text contains `q` (case-insensitive).
- `GET /api/docs/pages?repo=<path>` — `{ ref, pages:[{name,size}] }`: the custom pages (below).
- `GET /api/docs/page?repo=<path>&name=<name>` — that page's HTML, scrubbed, under its own sandbox CSP.

### A custom project page

When a project needs a page nothing generic covers (a marketing plan, an art direction), write
**`docs/pages/<name>.html`** and merge it to the default branch: the project views then show a tab
`<name>`. `<name>` is letters, digits, `-` and `_` only (no dot, no sub-folder). The page is shown
**inert** in a sandboxed iframe (ADR 0053): **no script** (stripped, and would not run), no form, no
network — no external stylesheet, font or image, no fetch. So it must be self-contained: CSS in a
`<style>`, images as `data:` URIs or inline `<svg>`. Minimal template:

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan marketing</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 16px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #111; } }
</style>
</head>
<body>
  <h1>Plan marketing</h1>
  <p>…</p>
</body>
</html>
```

## Plan a project: phases, lots, roadmap

A project is one repo: **roadmap → phase → lot → card**. You prepare all of it; **you never
launch a lot** — launching is the user's tap. Always send `x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}`:
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
  **Name the files in each spec** (`bridge/lot.ts`, `web/src/…`): the board compares them. When two
  cards that may run together (lot not at 1, not chained) cite the same file, `POST /api/runs`
  answers with `overlaps: [{cardIds:[a,b], files}]` and a `warning` sentence, and the lot shows it
  (`overlaps` on `GET /api/runs?repo=` too). Nothing is blocked — act on it: PATCH the second card
  `{"dependsOn":"<a>"}`, or the lot `{"maxParallel":1}`. A spec that names no file is never flagged.
  Set `integration` (`"card"`, the default, or `"lot"`) too: with `"lot"` the cards fork from a shared
  lot branch, fold into it locally once the lead accepts them, and the lot opens **one PR** for all of
  them — one CI instead of one per card. Pick it when CI is billed or the cards belong together; keep
  `"card"` for independent changes. Patchable while the lot is planned
  (`curl -X PATCH $B/api/runs/<id> -d '{"integration":"lot"}'`). `GET /api/cards/<id>/pr` of such a
  card answers with the lot's PR.

```bash
B=http://127.0.0.1:8788; H=(-H 'content-type: application/json' -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}")

# roadmap: read it first, write it back with the revision you read (0 when there is none).
curl -s "$B/api/roadmap?repo=/abs/repo"                       # {roadmap:{vision,items,revision}}
curl -s -X PUT "$B/api/roadmap" "${H[@]}" -d '{"repoPath":"/abs/repo","revision":0,
  "vision":"One paragraph.","items":[{"name":"Foundations","goal":"…","status":"active"}]}'
#   409 {kind:"revision",current:N} = someone wrote in between: re-read, merge, retry.
curl -s "$B/api/roadmap?repo=/abs/repo&format=md"             # Markdown, for the user's repo

# phases
curl -s -X POST "$B/api/phases" "${H[@]}" -d '{"repoPath":"/abs/repo","name":"Foundations","goal":"…","roadmapItemId":"<item id>"}'
curl -s "$B/api/phases?repo=/abs/repo"
curl -s "$B/api/phases"                                        # every repo's phases at once (each has its repoPath)
curl -s -X PATCH "$B/api/phases/<id>" "${H[@]}" -d '{"name":"…","goal":"…","position":0}'
curl -s -X DELETE "$B/api/phases/<id>" "${H[@]}"              # only an EMPTY phase (no card, no lot) — 409 otherwise

# put a card in a phase (at creation, or later)
curl -s -X PATCH "$B/api/cards/<id>" "${H[@]}" -d '{"phaseId":"<phase id>"}'

# lots: a PLANNED run. `foldInCap` is required (0 = the lead folds nothing in).
curl -s -X POST "$B/api/runs" "${H[@]}" -d '{"planned":true,"cardIds":["<id>","<id>"],"foldInCap":2,
  "phaseId":"<phase id>","name":"Lot 1","position":0}'
curl -s "$B/api/runs?repo=/abs/repo"                          # lots and runs, with cardIds, finished, finishedAt, done/blocked counts, prUrl (one-PR lot); no ?repo = every repo
curl -s -X PATCH "$B/api/runs/<id>" "${H[@]}" -d '{"name":"…","position":1,"cardIds":["<id>"]}'  # planned only
curl -s -X DELETE "$B/api/runs/<id>" "${H[@]}"                # planned only; releases the cards
```

A card sits in at most one lot (`409` otherwise). Order lots by `position`, cards inside a lot
by `dependsOn`. **State lives in the board, not in this conversation**: when you start, read the
roadmap, `/api/phases` and `/api/runs` rather than relying on what you remember. Tell the user
what you prepared and let them launch it.

**At the end of a lot, keep the recette** (the board's end-of-lot message reminds you): before the
bilan, re-read the [manual tests](#manual-tests--the--recette-) of the cards it merged and PATCH them
into shape — concrete (where to tap, what to expect), short, steps that are done together merged into
one; a card that is purely internal gets none (`"manualChecks": []`). Then cite « N à tester » in the
bilan (N = the `todo` entries of `GET /api/recette?repo=<repo>`). Their verdict stays the operator's.

**What each card came to** is in `GET /api/cards/<id>` → `reportEvents` (oldest first, uncapped):
`run.report` = a worker's bilan as the lead read it, `{runId, round, text, issue}` — `issue` is
`coded | present | partial | none`, or null when the bilan opened with no `Issue :` line; then
`run.decision` (`finished` / `prompt` + `reason`) and `run.halted` (`reason`) — the lead's answer.
`sessions[].handoffMd` is the end-of-session report. Cite them in the lot's bilan: an empty diff with
`issue: "present"` is « déjà présent », not a failure.

## Watch and answer the herd

An agent stuck on a question, or a PR that no longer merges, is yours to look at — and to unblock.

```bash
B=http://127.0.0.1:8788
curl -s "$B/api/snapshot"                     # every agent: paneId, status (blocked = waiting on someone), cwd
curl -s "$B/api/pane/<paneId>"                # that pane's recent output — read it before you answer
curl -s -X POST "$B/api/pane/<paneId>/reply" -H 'content-type: application/json' \
  -d '{"text":"yes, go ahead"}'               # types the text and submits it (`"submit":false` only types)
curl -s "$B/api/board/prs"                    # the cards whose PR is still open (journal only, free)
curl -s "$B/api/cards/<id>/pr"                # one card's PR: state, mergeable, conflicting (asks GitHub)
#   GET /api/cards/<id> carries `card.prUrl` (its PR, from the journal; null = none). With one, finish_card
#   mode "merge" merges that PR on GitHub — never the local branch.
curl -s "$B/api/board/pins"                   # the sessions the user pinned: [{session, name}], session = agentSessionId
curl -s -X POST "$B/api/board/pins" -H 'content-type: application/json' \
  -d '{"session":"<agentSessionId>","name":"chat infra","pinned":true}'   # pin (false = unpin; ask first)
```

The agents of the paired peers (other machines this one drives) are one more herd, read every ~5 s
and never stored. A pane there is named by its peer; reading, answering and keys go through this
bridge, never to the peer directly:

```bash
curl -s "$B/api/herd"                         # {peers:[{peer, state, error, agents, shellPanes, at}]}
#   state: connected | disconnected (unreachable, refused, or its herdr down — that peer only) | pending
#   each pane carries `peer`; its paneId is the peer's own
curl -s "$B/api/herd/<peer>/pane/<paneId>"    # that remote pane's recent output
curl -s -X POST "$B/api/herd/<peer>/pane/<paneId>/reply" -H 'content-type: application/json' \
  -d '{"text":"yes, go ahead"}'               # same body as the local reply
curl -s -X POST "$B/api/herd/<peer>/pane/<paneId>/keys" -H 'content-type: application/json' \
  -d '{"keys":["Enter"]}'                     # same key grammar as the local keys
```

- Answer a pane only for what the user already decided or what is plainly safe (a "continue", a
  fact in the roadmap). A real choice is theirs: put it to them first.
- Never type into your own pane, and never `reply` to something that is not an agent waiting.
- Tell the user what you answered, with a link: `[title](/pane/<paneId>)`.

```bash
curl -s "$B/api/tidy?idleHours=2"             # « Ménage »: panes that no longer serve, by reason
#   card-done | agent-done | idle (≥ idleHours, no card in progress) | shell — each with `since`.
#   Never proposed: orchestrators, the board's lead/copilot, working/blocked agents, a running lot's cards.
```

`POST /api/tidy/close` (`{"paneIds":[…],"idleHours":2}`) closes the ones still proposed — the
operator's gesture only: it answers 403 to any call carrying `x-collie-pane`. Point the user at the
« Ménage » sheet of the agent list instead.

## What to confirm with the user first

These spend quota or drive a real terminal. Never fire one unasked:

- `POST /api/cards/<id>/start` — cuts a git worktree, opens a herdr workspace and
  launches an agent on the card.
  On a **shared** repo it first pushes the card's claim (ADR 0048 §7): `409 {kind:"claimed"}` when
  another pair holds it (`error` says who and since when), or when offline and the card is not
  assigned to you. Taking a card back (`POST /api/cards/<id>/claim`) is the operator's gesture — refused to a pane.
  **Never start a card assigned to someone else** (`assignee` ≠ you): the bridge refuses your pane `403`.
- `POST /api/cards/<id>/prompt` (`{"text":"…"}`) — types into that agent's pane.
- `POST /api/cards/<id>/next-step` — hands a landed card (outside a run) to the next role of its flow; the user's tap, never yours.
- `POST /api/cards/<id>/reformulate` — hands the card to the copilot.
- `POST /api/cards/<id>/handoff`, `DELETE` on a card that has work in it.
- `DELETE /api/cards/<id>/remote` — ends a card's session on its peer (closes the pane there).
### Roadmap, decisions, memory (ADR 0023)

The roadmap is a **document you write with the user**, not three lines. When it is empty, run a real
brainstorm: one theme at a time (vision, audience, loop, constraints, risks, order of phases), restate,
get a yes. The brainstorm itself is the phase « Cadrage » (a roadmap item `active`, and NO board phase — it files no card);
mark it `done` when the user validates the plan. Cut ONLY the next phase into lots and cards.

```bash
# items carry a long form: objective, end-of-phase demo, risk, why here (Markdown, ≤ 20000 chars)
curl -s -X PUT "$B/api/roadmap" "${H[@]}" -d '{"repoPath":"<repo>","revision":<read>,"vision":"…",
  "items":[{"id":"p0","name":"Cadrage","status":"active","goal":"…","detail":"## Démo\n…"}]}'
# write EACH decision the moment it is taken; reuse its id to settle an open question
curl -s -X POST "$B/api/roadmap/decision" "${H[@]}" -d '{"repoPath":"<repo>","text":"Équipes de 16","status":"decided","itemId":"p0"}'
#   status: decided (✅) | leaning (🟡) | open (❓)
#   domain (optional): product (product/business) | technical — absent reads as technical. A
#   decision restated without it keeps the one it had.
# a question about ONE card: add its cardId (same repo). While open, that card shows « L'orchestrateur
# attend ta décision », which opens your conversation; it goes when the decision is leaning or decided.
# Link the card in the question you ask, `[titre](<base>/card/<id>)`. No extra notification.
curl -s -X POST "$B/api/roadmap/decision" "${H[@]}" -d '{"repoPath":"<repo>","text":"SQLite ou Postgres ?","status":"open","cardId":"<card>"}'
# your memory: one short note (≤ 4000 chars) to your next self — update it at every milestone
curl -s "$B/api/orchestrator/memory?repo=<repo>" "${H[@]}"
curl -s -X PUT "$B/api/orchestrator/memory" "${H[@]}" -d '{"repoPath":"<repo>","note":"où on en est · écarté · prochaine question"}'
# exports the user commits into the repo (you never write there)
curl -s "$B/api/roadmap?repo=<repo>&format=md"      # the detailed roadmap
curl -s "$B/api/roadmap?repo=<repo>&format=steps"   # step by step — rendered from phases, lots, cards
```

The user hands you over (`/api/orchestrator/renew`) when your context fills: the route refuses your own
pane header. Write your note when asked.

### What moved without you — at the start of each turn

The user creates and edits cards, settles decisions, launches or deletes lots, merges PRs by hand — none
of it reaches your conversation. `GET /api/orchestrator/since?since=<ts>` lists it: the repo's audited
gestures (yours, i.e. your pane's, left out) and the PRs merged or closed — plus a remote card stopped with no PR (`card.remote_idle`) and what retracts it (`card.remote_idle_cleared`, `card.remote_ended`) — newer than `since` (ms epoch).
It answers only the orchestrator's own pane (`204` for any other) and derives the repo from it.

```bash
curl -s "$B/api/orchestrator/since?since=<cursor>" "${H[@]}"   # {cursor, count, summary}
#   no `since` yet: {cursor: now, count: 0} — keep `cursor`, send it next time.
```

- **Claude Code** — a `UserPromptSubmit` hook injects `summary` at the top of each turn: nothing when
  nothing moved, never an interruption, silent in every pane that is not an orchestrator. Install it
  once in `~/.claude/settings.json` (needs `bun` — the same hook on Linux, macOS and Windows; the
  cursor sits in `~/.local/state/collie-board/since-<pane>`, `:` turned into `_`):

  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [
      { "type": "command", "command": "bun ~/.claude/skills/collie-board/since-hook.ts" } ] } ] } }
  ```

  A turn that starts with « Depuis ton dernier tour… » is that hook: read it as the board's word.
- **Without hooks** (another agent) — make the call yourself as the first thing of each turn where the
  user speaks, keep the returned `cursor` for the next one, and say nothing of it when `count` is 0.

### Buttons in your messages — orchestrator only (ADR 0042)

When a question settles in one gesture (yes/no, merge this card, launch that lot), **end the message
with its buttons**: a fenced block tagged `collie-buttons` holding a JSON array. The board's
orchestrator panel turns it into buttons; anywhere else (another agent's output, a user turn) it stays
code.

````
```collie-buttons
[{ "label": "Oui, fusionne", "tone": "primary", "action": "finish_card", "args": { "cardId": "<card>", "mode": "merge" } },
 { "label": "Non", "tone": "neutral", "action": "say", "args": { "text": "non" } }]
```
````

- **Look is yours**: `label`, `tone` (`primary` · `neutral` · `secondary` · `ghost` · `danger` ·
  `success` · `warning`, mapped on the theme), `size` (`sm` · `md` · `lg`), `wide: true` for a full row.
- **`action` is a tool of the MCP server** (`bridge/mcp.ts` → `web/src/lib/board-tools.ts`), `args`
  checked against its schema — or `say {text}`, which types `text` into YOUR pane and submits.
  `reply_to_agent` and `notify` are not buttons. An unknown action or bad args: the button is greyed with
  the reason and nothing runs.
- The button shows what it will do from `action`+`args` (« Fusionner « titre » dans main »), not from
  your label; a destructive tool (`finish_card`, `launch_lot`) asks for confirmation. The tap is the
  user's, with the user's rights: writing the block runs nothing, and what refuses you still does.
- No buttons for an open question that wants a sentence — ask for the sentence.

- `POST /api/runs/<id>/launch`, and `POST /api/runs` **without** `planned:true` — both start work;
  they are the user's, and refuse your `x-collie-pane` — with one exception (ADR 0030): if the user
  turned **autonomy** on for this repo (`GET /api/orchestrator/autonomy?repo=`; only the user can change
  it, the write refuses your pane header) the board's end-of-lot message tells you that you may launch
  **one** planned lot with `POST /api/runs/<id>/launch`. Only then; a bound (lots chained, red gate/CI)
  withdraws it and you launch nothing. And if the user also turned on `startWhenIdle` (same route;
  ADR 0047), you may launch a planned lot whenever **no lot of this repo is running** — the bridge checks
  at your request, counts it in the chain and refuses past the same bounds. `POST /api/runs` without
  `planned` stays refused in every case.
  **The call carries `x-collie-pane: ${HERDR_PANE_ID}`** — the header is what makes the bridge check
  the autonomy and its bounds; a launch without it would pass for the user's own tap. For it not to
  wait on a confirmation in your pane, the user allows it once in Claude Code (`permissions.allow` of
  the repo's `.claude/settings.json` or of `~/.claude/settings.json`; Settings → Autonomy shows the
  line, copiable): `Bash(curl -s -X POST http://127.0.0.1:8788/api/runs/*/launch*)` — other port if
  `COLLIE_BOARD_PORT` is set. You never write that file yourself; propose the line to the user.
  ```bash
  curl -s -X POST "http://127.0.0.1:${COLLIE_BOARD_PORT:-8788}/api/runs/<id>/launch" \
    -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}"
  ```
  On a **shared** repo a lot belongs to its creator (ADR 0048 §7): `GET /api/runs` gives `createdBy` /
  `createdPair`, and launching or resuming another pair's lot is refused `403` — to you and to the user
  alike. Never launch a lot that is not this pair's, nor one holding a card assigned to someone else.
  Its coarse state is shared (`launchedAt`, `finished`/`finishedAt`); its current step is not.
- `POST /api/runs/<id>/resume` — lifts a lot's halts (`run.halted`): each halted card picks up at the
  step it stopped on (a triage is asked again, its worker is not relaunched). The user's, and refuses
  your `x-collie-pane`; when a lot is halted (`GET /api/runs` gives the reason in `halted`), tell the
  user why and let them resume it.
  **Except (ADR 0055)**: with autonomy on — or the repo's objective active — **the repo's orchestrator** may resume it itself when the
  halt is mechanical — a PR not up to date with its base, a red pre-push, a silent lead, uncommitted
  work, a failed start. Fix the cause first if it is yours to fix, then send the same POST with your
  `x-collie-pane`. At most **3** such resumes per lot; past it, or for a decision halt (the lead's
  rounds ran out, finished with no commit, a verdict), or another pair's lot, it is `403` — tell the user.
  A card halts after **`maxRounds`** send-backs by the lead with no finish (the repo's « Rounds before
  calling me », 1–15, default 5): read it in `maxRounds` of `GET /api/orchestrator/autonomy?repo=`.
  It is the user's — the write refuses your pane header. When cards keep hitting it just short of the
  end, **propose** a higher value to the user; never try to change it. A resume gives the card the full
  count again, and a new value applies to running cards from their next round.
- **Validating a phase** (`POST /api/phases/<id>/close`, `.../reopen`, `POST /api/phases/seal`) — see
  *Milestones* below. They are the user's too, and refuse your `x-collie-pane`.

### The objective (ADR 0056): read it, claim it, never set or validate it

A repo may have **one open objective** (`active`, `paused` or `claimed`): a text, success criteria, and a
budget `{maxLots, quotaPct, deadline}` (defaults 10 lots, 80 % of the week's quota, no deadline).

- `GET /api/goals?repo=…` (newest first) or `GET /api/goals/<id>` — each with `spent`: `lots` (the repo's
  lots launched while it was open — what the budget counts), `lotIds` (those plus the lots planned while it
  was open), `cardIds` (their cards and those of its phases), `phaseIds` (the repo's phases created while it
  was open), and `quotaPct` (the week's gauge, null without a reading). Nothing to tag: what you create
  while it is open is attached.
- **While it is `active`, you work toward it.** You may create cards, lots and phases and launch your own
  planned lot — `POST /api/runs/<id>/launch` with your pane — **one lot at a time** (`403` while one of the
  repo's lots is open), with no autonomy setting needed and no `maxChain`. At the end of a lot with nothing
  planned you are woken with « Objectif pas atteint : relis les critères, planifie et lance la suite ». A
  decision waiting on the user blocks only its branch — the wake lists them; move on with the rest. Do
  **not** propose phases for validation: validating the objective closes them.
- **A bound** (`maxLots` lots launched, the week's quota at `quotaPct`, the deadline passed, or a red lot with
  `stopOnRed`) pauses it; the user hears it once. Paused, the ordinary autonomy applies.
- **Claim it reached** — `POST /api/goals/<id>/claim` with your `x-collie-pane`, only from `active`, once
  every criterion holds, with `{proofs: ["…", …]}` — one non-empty proof per criterion, in their order
  (`400` otherwise). The goal then carries `claim: {ts, proofs}`, shown to the user beside each criterion;
  the user validates. **Claimed is a full
  stop**: no lot planned or launched (`403`), no end-of-lot wake, until the user answers. A refusal comes
  back as a wake carrying the user's comment.
- **The user's only** (`403` to your pane): `POST /api/goals` `{repoPath, text, criteria: [..], budget?}`
  (`409` if one is already open), `PATCH /api/goals/<id>` (text, criteria, budget), and
  `POST /api/goals/<id>/pause` · `/resume` (rejecting a claim needs `{comment}`, `400` without) ·
  `/achieve` (validates, closes the phases created during it, and starts the next objective if one is
  queued) · `/abandon`. The user may also prepare ONE next objective while one is open — `POST /api/goals`
  with `next: true` (status `queued`, ignored by you until it starts), edited by `PATCH`, deleted by
  `DELETE /api/goals/<id>`, started by hand with `/activate` when nothing is open. A started one wakes you
  like a new objective.
  Propose an objective or an edit to the user; never try to write it.
- **Goal mode** — while it is open, the user is not called at each lot's end. Each goal also carries
  `progress` (`lotsDone`, `cardsDone`, `cardsBlocked`, `recettes`) and `journal` (newest first: lot reports
  and checkpoints). The repo's orchestrator posting `POST /api/board/notify {kind:"done"}` lands in that
  journal, **not** on the phone (`202 {journaled:"goal"}`); a `question` still rings and leaves a
  `decision` checkpoint there. The bridge itself pushes ONE grouped checkpoint at half budget, budget
  spent (or deadline passed) and claimed reached.

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

### Flows (ADR 0031, 0032)

A **flow** is a named pipeline: an ordered list of templates (roles) a card goes through, each a fresh agent on
the same branch that is told what the one before reported. The user defines them once in Settings; three ship —
`code` (implementer then reviewer), `doc`, `explore`. You read them and attach one by id.

```bash
curl -s "$B/api/flows"                                                       # {flows:[{id,key,name,description,steps:[template ids],builtin}]}
curl -s -X PATCH "$B/api/phases/<id>" "${H[@]}" -d '{"pipelineId":"<flow id>"}'   # every card of the phase without its own; null clears
curl -s -X PATCH "$B/api/cards/<id>" "${H[@]}" -d '{"pipelineId":"<flow id>"}'    # its own wins over the phase's
```

A template with `"worker": true` writes the code: in a run, a red check or a correction asked after a later role
(the reviewer) goes back to the nearest worker, so put a worker role before any reviewer. A card resolves, most specific first: its flow, its single template, its phase's flow, its phase's template, then
the **repo's default flow** (the user's setting; you do not set it). Only a **launched lot** chains the steps; a card
the user starts by hand stops after its first role. Attach the flow to the **phase**, not card by card: `code` for
code work; a `doc` or `explore` card takes that flow or none. Do not create or edit flows unasked, and do not
replace one the user set — they are the user's roles, like templates.

### Gate and facts (ADR 0020) — read, don't set

A repo may have a **gate**: a command the user set (build, tests, lint) that the board runs in a worker's checkout
every time it lands, before the lead judges it. Red goes straight back to the worker. It is the user's alone — do
not set or change it (`POST /api/repos/gate` and `/suggest` are their screens); but know it exists, because a card in a
gated repo is checked by a machine first.

A repo may also be set to **merge direct** (ADR 0043) — the user's setting too, never yours (`POST
/api/repos/integration` is refused from a pane). Then a run opens no PR: once the gate is green and the lead says
finished, the card's branch is merged into the base in the repo's own checkout and pushed if there is an origin. A
dirty checkout, or one not on the base, halts the card with the reason — tell the user, do not clean it yourself.

At the **end of every lot**, the board opens one **« docs(plan) » PR** that writes `docs/plan/roadmap.md` (= the
`format=md` roadmap), `docs/plan/etapes.md` (= `format=steps`) and `docs/plan/lots/<lot>.md` (the lot's bilan) on
the base. The user merges it; the board never pushes the base. Do not open that PR yourself, nor commit `docs/plan/`
in a card's work. The export is on by default and the user's switch alone (`POST /api/repos/plan-export` with
`{path, enabled}` is refused from a pane). A lot another pair launched is exported by that pair, not here.

```bash
curl -s "$B/api/repos" | jq '.repos[] | {path, gate}'        # gate = the command, or absent
curl -s "$B/api/repos/integration?repo=/abs/repo"           # {"integration":"pr"|"direct"}
curl -s "$B/api/repos/plan-export?repo=/abs/repo"           # {"enabled":true|false} — the end-of-lot plan PR
curl -s "$B/api/project/facts[?repo=/abs/repo]"                # per card, read off its journal: gate result, the lead's
                                                              # verdict and reason, review verdict, PR + auto-merge,
                                                              # times sent back, template, start/end
```

Use the facts to say *why* a card is stuck or sent back before proposing a next step, instead of guessing.
