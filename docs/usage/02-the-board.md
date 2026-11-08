# The board

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Collie answers **"which agent needs me right now"**. It is deliberately stateless: a mirror of the
herd, wiped every tick. Collie Board answers the other question — **"where is this task, and what
happened in the three sessions before this one"** — and that needs memory Collie doesn't keep.

A **card** is durable. A **session** is not. That one rule is the whole design.

Eight statuses, stacked one under the other on a phone (urgency first) and folded into four lanes
(**To do · Doing · To review · Done**) on a laptop. Most transitions are the board's, not yours.

| | |
|---|---|
| **Card → branch → workspace** | Starting a card runs `worktree.create`: its own checkout, its own herdr workspace, its own agent. It forks from whichever of the local and remote base is more complete ([ADR 0015](../../.adr/0015-a-card-forks-from-the-more-complete-base.md)). One tap, no keyboard. |
| **Cards move themselves** | Reconciliation rides the snapshot poll Collie already runs. `working` → In progress, `blocked` → Needs you, `review` → To review. A pane that vanishes makes its card **orphaned** — relaunchable from its last handoff, never an error. |
| **Tag, and repo scope** | One tag per card, its colour computed from its name and stored nowhere ([ADR 0005](../../.adr/0005-one-tag-per-card-its-colour-derived-from-its-name.md)). Filter by tag and by repo; the repo scope is remembered between visits ([ADR 0006](../../.adr/0006-the-board-scopes-by-repo-and-remembers-it.md)). |
| **Dependencies** | `dependsOn` makes a card start*able* once its predecessor is done — a gate, never a trigger. |
| **Diff, scoped by construction** | 1 card = 1 branch, so the card's diff is its checkout against its fork point. `--stat` first on a phone; tap a file for the patch. Working tree, not just commits — agents often leave nothing committed, and one button sends the card's agent a fixed instruction to commit it (no push). |
| **Merge · PR · resolve · cleanup · discard** | Five taps that end a branch, in `bridge/integrate.ts`. `merge --no-ff` into the base in the main checkout, or push + `gh pr create`; a conflict is handed back to the card's own agent to settle **on its own branch** ([ADR 0014](../../.adr/0014-a-conflicting-pr-does-not-file-the-card.md)). Four of the five refuse before they act. `discard` is the one destructive gesture and is a separate word, never a `force` flag. **Open PRs** lists every card whose PR is still open, and asks GitHub which ones still merge. |
| **Context gauge** | Read from the agent's own session (Claude transcript, OpenCode session db), graded against that model's own window (static table → models.dev → `COLLIE_BOARD_CTX_WINDOW`), and pushed back to herdr with `pane.report_metadata`, so it also shows as `$ctx` in the TUI's Agents sidebar. No verified transcript format, no gauge. |
| **Usage gauge** | How much of your Claude quota is left, from `claude -p "/usage"` — rendered locally, no model turn spent ([ADR 0009](../../.adr/0009-the-usage-gauge-shells-out-to-the-cli-not-the-copilot.md)). |
| **Handoff** | Context running out mid-task: the outgoing agent writes `.board/handoff.md`, the pane is replaced in the same worktree, the incoming agent opens on that note plus the original spec. Sessions chain on the card. With **auto handoff** on, the note is written just before the prompt cache goes cold, and the pane offers a fresh session from it when you come back — replacing the agent is still always a tap. |
| **Wrap-up** | Filing a card Done asks its agent for one last note (`.board/wrapup.md`) — what it did, what it dropped — because the diff shows which lines moved, not which acceptance criterion that satisfied. That note is what the review reads. |
| **Copilot** *(off by default)* | One long-lived agent in a `board` workspace, driven like any other — no API key, no SDK. It turns a dictated brain dump into cards (split, tagged with the board's vocabulary), reviews finished work from `--stat` and the wrap-up into a Markdown verdict ([ADR 0012](../../.adr/0012-the-review-is-markdown-the-app-already-renders.md)), and explains a failed action. A follow-up too small for a card stays an action on the reviewed card, one tap to hand over ([ADR 0018](../../.adr/0018-no-parasite-cards-from-a-review.md)). |
| **Artifacts** | Images, Markdown and HTML an agent leaves in its worktree open from the pane, confined to the card; the **gallery** in Settings lists what agents left in their scratchpads. HTML is scrubbed and sandboxed. |
| **Notifications** | The bell keeps a log of what asked for you. The board raises its own alerts in the herd's slot — a card whose agent vanished, a run that halted or finished — and only ones that retract when the fact stops being true ([ADR 0011](../../.adr/0011-the-board-may-raise-an-alert-that-can-retract.md)). |
| **Provenance** | A card an agent files on its own mid-turn is badged **agent** and linked to the card it came from; one the review files is badged **auto**. Derived from who called, never declared ([ADR 0010](../../.adr/0010-an-agent-filed-card-is-traced-on-the-card.md)). |
| **Journal** | Every overwrite of a card's written fields (title, spec, acceptance) is journalled with what it replaced and by whom; `revert` reads one back. Append-only, so it already is the history. |

## Runs

A **run** is consent given once, over a chosen set of cards
([ADR 0017](../../.adr/0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md)). On a board
scoped to one repo, tap **Select**, choose the cards, tap **Run these**, and pick the order (from `dependsOn`), how many
run at once, the cap on follow-ups it may fold in, and the lead's agent. From then on:

1. the **coordinator** (`bridge/run.ts`, on `engine.onUpdate`, no timer) starts members as slots free up;
2. each time a worker goes idle, the **lead** — a second agent that reads the worker's checkout —
   either sends it back ("commit; criterion 2 isn't met because…") or declares the card finished;
3. the copilot's review lands; the lead keeps, folds in or drops each follow-up, **with its reason**;
4. the coordinator opens the PR through the same route a tap uses, and arms GitHub's auto-merge.

The lead judges and speaks; it never edits, starts, pushes or merges itself. Every decision is in the
card's journal. A run **halts** to you after five rounds on a card, on a conflict the worker couldn't
settle, or on a blocked worker — it never answers a permission prompt — and tells you when it
**finishes**. An `explore` card (brainstorm, design question) is judged on its written conclusion
and the cards it proposes, not on a diff. There is no global autopilot switch: consent is per set.

**Autonomy** (Settings → Autonomy, per repo, off by default —
[ADR 0030](../../.adr/0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md)) lets the project's orchestrator launch
the next planned lot itself. Its launch is a `curl` in its pane, so Claude Code asks you to confirm
each one unless you allow it once, in `permissions.allow` of the repo's `.claude/settings.json` or of
`~/.claude/settings.json` (the setting shows the line, copiable; adjust the port if you set
`COLLIE_BOARD_PORT`):

```
Bash(curl -s -X POST http://127.0.0.1:8788/api/runs/*/launch*)
```

The call must carry `x-collie-pane` — that header is what makes the bridge check the autonomy and
its bounds; a call without it would pass for your own tap. The board never writes your Claude Code
settings.

## Board configuration

| Variable | Default | What it does |
|---|---|---|
| `COLLIE_BOARD_AGENT_KIND` | `claude` | Agent kind launched for a card that doesn't name its own. |
| `COLLIE_BOARD_MAX_AGENTS` | `3` | How many cards may run at once — a **quota** guard, not a performance one. Adjustable in Settings. |
| `COLLIE_BOARD_BRANCH_PREFIX` | `board/` | Prefix for branches the board creates. |
| `COLLIE_BOARD_CTX_WINDOW` | `200000` | Fallback window for the context gauge, when a pane's model doesn't resolve to its own. |
| `COLLIE_BOARD_OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | OpenCode session database, read-only, for the gauge and reading mode of `opencode` panes. Missing file = no gauge, never an error. |
| `COLLIE_BOARD_MODELS_DEV` | `on` | Let per-model window resolution consult models.dev for unknown slugs (cached, best-effort). `off` = static table + default only. |
| `COLLIE_BOARD_HANDOFF_PCT` | `70` | Context percentage past which the Handoff button goes prominent. Advisory only. |
| `COLLIE_BOARD_COPILOT` | `off` | Enable the copilot. **Off by default** — it is a second agent on the same subscription. |
| `COLLIE_BOARD_COPILOT_KIND` | *(same as workers)* | Let the copilot run a cheaper agent. |
| `COLLIE_BOARD_COPILOT_CLEAR` | *(from the adapter)* | Override its context-reset command. |
| `COLLIE_BOARD_COPILOT_WORKSPACE` | `board` | Name of the copilot's workspace. Cosmetic — it is found by directory. |
| `COLLIE_BOARD_REPO_ROOTS` | *(empty)* | Extra directories to scan for repos in the new-card picker. Rarely needed — see below. |
| `COLLIE_BOARD_UPDATE_REPO` | *(empty)* | `owner/name` the in-app update banner checks. Empty = the GitHub `origin` of the plugin checkout (what `herdr plugin install` cloned); `off` = check off. |

Follow-up cards (on/off and which categories), auto handoff and agents-at-once live in **Settings**,
not in `.env`. Per-agent divergence lives in [`adapters/agents.toml`](../../adapters/agents.toml) —
merged per field from `~/.config/collie-board/agents.toml`.

**Picking a repo** is a list, not a text field — typing `/home/you/code/project` on a phone is the
pain this project exists to remove. The list is **derived** from every repo you have carded, every
repo open in the herd, and a scan of `COLLIE_BOARD_REPO_ROOTS` (or the conventional `~/git`,
`~/code`, `~/dev`, …) — that last one is what makes the very first card possible on a fresh install.
The repo's default branch pre-fills the base ref. The one thing stored is what can't be derived:
**long-press a repo to hide it**.

## Board endpoints

```
GET    /api/cards                       list + live herd state merged in
POST   /api/cards                       {title|rawInput, repoPath, baseRef, tag, category?, …}
GET    /api/cards/:id                   card + sessions + reviews + journal
PATCH  /api/cards/:id                   edit / move a column / link (parentId, dependsOn)
DELETE /api/cards/:id
POST   /api/cards/:id/start             worktree + workspace + agent + the spec
POST   /api/cards/:id/prompt            a follow-up instruction to the card's agent
POST   /api/cards/:id/request-commit    ask the card's agent to commit its work (no push)
POST   /api/cards/:id/finish-now        {reviewId, title} — a small follow-up, done by this card's agent
POST   /api/cards/:id/to-action         this card becomes an action on another one
POST   /api/cards/:id/handoff           ask for the note; the poll loop swaps the session
POST   /api/cards/:id/resume            accept (POST) / decline (DELETE) an auto-handoff offer
POST   /api/cards/:id/reformulate       hand the card back to the copilot
POST   /api/cards/:id/refine            {instruction} — correct the card with the copilot
POST   /api/cards/:id/review            re-run the copilot's review
POST   /api/cards/:id/explain           {action, error} — ask the copilot what a failure meant
POST   /api/cards/:id/revert            {eventId?} — put back text an edit overwrote
GET    /api/cards/:id/diff              ?mode=stat|file|read&path=
GET    /api/cards/:id/integration       where the branch stands (ahead/behind, pushed, refusals)
POST   /api/cards/:id/integration       {action: merge|pr|resolve|reopen|cleanup|discard, andDone?, via?}
GET    /api/cards/:id/pr                the card's PR state, from GitHub
GET    /api/cards/:id/sessions          the handoff chain
GET    /api/cards/:id/events            the journal
POST   /api/runs                        {cardIds, foldInCap, leadAgent} — record a run and hand it over
GET    /api/board/prs                   cards whose PR is still open; ?check=1 asks GitHub
GET    /api/board/prefs                 follow-ups, agents at once, auto handoff (POST to change)
GET    /api/board/usage                 Claude quota left; ?refresh=1
GET    /api/repos                       the new-card picker's repo list (derived)
POST   /api/repos/hide                  hide / unhide one repo from that list
GET    /api/notifications/log           what asked for you — also the integration point for any consumer
GET    /api/backup                      everything durable, as one JSON document (see Back up)
POST   /api/backup/restore              read one back — safety-exports the current state first
```

Every write goes through the same `guard()` as typing into a pane, and is audited. The board is
bound to the **primary** herdr session: a pane id means nothing in another server.

**`POST /api/cards` takes one header: `x-collie-pane`.** An agent filing a card mid-turn sends its
own `HERDR_PANE_ID` there, and the card comes back marked `origin: "agent"`, linked to whatever card
that pane is working in. `origin` and `originCardId` are refused in the body, so provenance is
derived, never claimed ([ADR 0010](../../.adr/0010-an-agent-filed-card-is-traced-on-the-card.md)).

Anything that wants what the board knows — a voice assistant, a script — integrates by polling
`/api/notifications/log` and writing back through the card routes — cursor on `ts` (epoch ms), not on
`id`, which restarts at 1 with the bridge. The bridge never calls out to a consumer. `curl` is a client, and so is the MCP server below
([ADR 0013](../../.adr/0013-the-bridge-does-not-know-its-consumers.md)).

## MCP server (stdio)

`bridge/mcp.ts` lets any MCP client read and drive the board — what blocks, a project's state, a card,
reply to an agent, file a card, launch a planned lot. It is a thin translator over the local API: the
board's guards apply as for `curl` ([ADR 0039](../../.adr/0039-the-mcp-server-is-stdio-and-the-callers-pane-header-says-who-it-is.md)).
stdio only: the client launches it **on the bridge's machine**.

```bash
claude mcp add collie-board -- bun run /path/to/collie-board/bridge/mcp.ts
# a deployment with the device gate:
claude mcp add collie-board -e COLLIE_BOARD_DEVICE_HEADER=x-device -e COLLIE_BOARD_DEVICE=laptop -- bun run /path/to/collie-board/bridge/mcp.ts
```

| env | meaning |
|---|---|
| `COLLIE_BOARD_URL` | the bridge, default `http://127.0.0.1:$COLLIE_BOARD_PORT` (8788) |
| `COLLIE_BOARD_DEVICE_HEADER` + `COLLIE_BOARD_DEVICE` | the device header name and value, if the deployment has `COLLIE_BOARD_DEVICE_HEADER` — without it writes answer 403 |
| `HERDR_PANE_ID` | inherited from the client, sent as `x-collie-pane` on every call: a client launched from a herdr pane is an **agent** (lot launch and phase validation refused). Unset (a client outside herdr): the operator's call. A convention, not an authentication |

Read tools: `list_projects`, `project_status`, `get_card`, `whats_blocking`, `recent_notifications`. Action
tools (not read-only): `reply_to_agent`, `create_card`, `launch_lot`, `finish_card` (mode `pr` | `merge` | `done`, the card screen's three finishing taps), `notify` (needs a pane).

## What is deliberately NOT built

- **No headless bridge driven by a central server.** Multi-machine is a central Collie calling
  *nodes* — each a full bridge with its own herdr and its own `tailscale serve` — never a herdr socket
  carried over the network. [ADR 0046](../../.adr/0046-multi-machine-un-collie-central-et-des-noeuds.md).
  Two Collies pair from **Settings → Peers**, never by editing `node.toml`: *Invite a peer* on the
  machine to be driven shows a single-use 10-minute code, *Add a peer* on the other takes its URL and
  that code. The token goes bridge to bridge (hashed in `node.toml`, clear in `peers.toml`, both
  `0600`, both kept out of the backup) and never reaches a browser; *Revoke* takes effect at once.
  A repo is offered to the peers, with its agent and which peer may launch in it, from that
  project's own settings (*Run from another machine*) — never a typed path — live without a
  restart; Settings → Peers keeps a summary; *Test the connection* shows
  the peer's version, panes, environments and how it sees this machine, or why it can't.
  A paired peer reads; it may launch only where it was allowed (`launch = [...]`).
  [ADR 0049](../../.adr/0049-appairage-de-pairs-par-code-depuis-l-ui.md).
- **No event sourcing.** State is the snapshot poll, as in Collie. Nothing to resync.
  A repo's board shared over git (opt-in, [ADR 0048](../../.adr/0048-board-partage-par-git-pair-a-pair-multi-utilisateur.md))
  is the exception: an append-only journal on an orphan `collie-board` branch. **Protect that branch
  on the remote** (GitHub: block deletion and force-pushes) — a force-push to an older state drops
  lines that only *Resend my journal*, in the project settings, puts back.
- **No drag & drop as the primary verb.** Most transitions are automatic, and dragging on a phone is
  miserable. Dragging exists on the wide-screen board, only between the columns a human owns.
- **No heuristic context gauge.** It could only produce a number that looks authoritative and isn't.
  No gauge is the honest answer; Handoff works regardless.
- **No agent that starts itself.** A finished card makes its dependent start*able*, never started.
  The only exception is a run, and a run is a set you chose.
- **No board merging on green.** GitHub's auto-merge is that watcher.
- **No PTY streaming.** Same reasoning as upstream — see `ARCHITECTURE.md` §8.
