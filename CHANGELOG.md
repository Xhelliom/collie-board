# Changelog

All notable changes to Collie Board are recorded here. Entries at 0.17.0 and below are
inherited from upstream Collie (AltanS/collie); the fork starts at 0.18.0. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). The newest `## [x.y.z]` heading **must** match the
`version` in `herdr-plugin.toml`, `package.json`, and `web/package.json` (enforced by
`scripts/check-version.sh`). See [`CLAUDE.md`](./CLAUDE.md) → *Versioning* for the bump policy.

## [0.38.1] - 2026-07-29

### Fixed
- **The reformulate confirmation followed you to the next card.** One `<CardRoute />` serves every `/card/:cardId`, so the component is not remounted when you move between cards — an armed confirmation stayed armed and would have fired on the next card's first tap. The exact opposite of a guard. Reset on card id. (f5b9668)
- **A rejected save said nothing.** Linking two cards can now fail for a reason you can act on ("that would make a loop"), where before a patch only failed if the bridge was unreachable — and neither `save()` had a `catch`, so the sheet just sat there looking saved. It surfaces the bridge's message and keeps the sheet open.
- The editor re-seeded its fields from `card`, which is a new object on every poll that changes anything — typing into the spec while an agent moved the card would have been wiped. Keyed on `card.id`: opening the sheet is the moment to read the card.

### Changed
- `card-journal.tsx` exported a function called `describe`, which collides with the test runner's own — the test had to alias it on import, which was the smell. It is `describeEvent`.

## [0.38.0] - 2026-07-29

### Added
- **Link two cards by hand.** The editor gains *Part of* and *After*, each collapsed to its current value until tapped — the same inline scrolling list as the repo picker, not a nested sheet, which on a phone is a back-button trap. No client-side cycle filter: the bridge already refuses a loop with a message that says so, and reproducing that graph walk here would put one rule in two places for a mistake that is one tap to undo.
- **Reformulate asks before it replaces a hand edit.** It works from the original dictation, so it discards what you typed — right when the copilot's draft disappointed you, wrong when you just spent five minutes on the spec. `editedByHandSince()` reads the journal to tell the two apart, and the button becomes *Replace my edits?* rather than raising a browser dialog, which on a PWA is both ugly and dismissed by reflex. A restore counts as a hand edit — it is one.

### Notes
- Validated on real data rather than fixtures: pressing Reformulate on the container that started all this produced three linked sub-tasks carrying **361–612 characters of spec and 159–377 of acceptance criteria each**, where the first version of the split had emitted three bare titles. That defect, on the cards that exposed it, is closed.

## [0.37.0] - 2026-07-29

### Added
- **The journal is readable, and an overwritten spec has a Restore button.** It rendered `card.edited {"reason":"copilot",…}` in monospace — a developer's view of a database table, and nobody restores anything from that. Each entry is a sentence now; an edit expands to the text it replaced with **Restore this version** beside it. An unrecognised event type still shows raw: a journal with holes in it is worse than one with a bit of jargon.
- The replaced text is **truncated to 160 characters in the polled card response**. The journal rides `GET /api/cards/:id`, so carrying every past spec whole would grow that response without bound with the number of rewrites. A preview is enough to *decide* — you recognise your own paragraph from its opening — and `revert` restores from the row, so the whole text is what comes back. Verified end to end.

### Fixed
- The board's conditional GET had **no timeout**, while every other fetch in the app wraps its signal in `withTimeout`. The poller only fires again once the revalidator is idle, so one fetch left pending by a black-holed link — a phone waking up, a Tailscale route gone dark — would have stopped the app polling silently and for good. (e669eab)
- 0.36.0 shipped that cache with no tests at all; six now cover the tag round-trip, the 304-returns-cached-body path, per-URL keying, and the `ApiError` status that keeps a 403 reading as an auth failure.

### Changed
- The ETag cache comment no longer restates `fetchPane`'s two invariants — it points at them. Two copies of a subtle rule is one too many.

## [0.36.0] - 2026-07-29

### Added
- **Conditional GET on the two board reads that poll.** `/api/cards` and `/api/cards/:id` carry an ETag, and an unchanged poll costs a 304 with an empty body — measured on the live board: **4718 bytes → 0**, every 1.5 s, on whichever screen is open. Same client-managed scheme as the pane mirror (`cache-control: no-store` stands for privacy, so the browser keeps nothing and the client holds the `(etag, body)` pair itself), including both of that cache's invariants: the tag is stored only *with* its body, and only *after* the body parses.

### Changed
- `ApiError` is exported from `web/src/lib/api.ts`. The loaders detect an auth failure with an `instanceof` check, so the board's own fetch had to be able to raise one — a plain `Error` would have turned a 403 from the same-origin gate into a generic "can't reach the board". (bda33bb)

### Notes
- No cache-invalidation hook, deliberately: the ETag is computed from the bridge's current data, so after a write the next poll sends a stale `If-None-Match`, the server computes a different tag, and the fresh body comes back. Verified — a `PATCH` turns the next conditional GET from 304 into 200.

## [0.35.1] - 2026-07-29

### Changed
- Review of 0.35.0's own code. `waitingOn()` had been written twice, byte for byte, in `board.tsx` and `card-group.tsx` — it lives in `board-groups.ts` beside `dependencyMet()`, where both callers already look. (34fce8e)
- The status-chip class string had been copied to four call sites and had already drifted (`px-2` here, `px-1.5` there); it is a `<CardStatusChip>`, sibling to the existing `<StatusBadge>`. `children` covers the one real variation — the collapsed group summary shows a count in the same shell.
- Two route-test suites had grown identical `ctx()` and `post()` helpers; hoisted to `routeCtx()` / `actionPost()`.

## [0.35.0] - 2026-07-28

### Added
- **The board shows a split as one entry.** A container card and its sub-tasks render together, placed in the container's derived column — which is what that derivation was for. The alternative (children scattered into their own columns with a breadcrumb) loses the fact that they are one piece of work.
- **A group's collapsed state follows its column's job**, not a stored preference: open in Blocked/Review/Working/Starting/Orphaned, where you act — hiding a blocked sub-task behind a chevron would put an extra tap on the most urgent thing on the board — and closed in Backlog/Ready/Done, where five rows for one dictation is the mess this feature exists to clean up. A tap overrides it for the session.
- **A card held back by a predecessor says so on the tile** (`after "…"`, dashed, a lock instead of a status chip) and on its own page, instead of letting Start return a 409. `dependencyMet()` mirrors the bridge's gate exactly.
- `GET /api/cards/:id` resolves `parent`, `blockedBy` and `children` — the detail page holds one card, so without them it could not name what it waits on or know it is a container. Detail only: doing it in the list would be N+1 on every poll.
- Navigation both ways — a sub-task links back to the dictation it came from, a container lists its sub-tasks. (143b314)
- A container hides its branch name: it is never checked out, so naming one is a promise nothing keeps. Clearing it in the database would not be safe — a card that became a container by hand-linking may name a real worktree from before.

## [0.34.1] - 2026-07-28

### Fixed
- `reconcileParents` listed and decoded **every card on the board, archived included, on every poll tick** to answer a question about two columns. It is one narrow `SELECT parent_id, status` now. (560df7b)
- `revert` searched `listEvents`, which is capped at 100 for the card view — so a named entry older than that answered "nothing to restore" for something the user could still see. A named entry is fetched by id, and checked to belong to this card and to be an edit. (560df7b)

## [0.34.0] - 2026-07-28

### Added
- **Every overwrite of a card's written fields is journalled with what it replaced**, and `POST /api/cards/:id/revert` (optional `{eventId}`) puts one back. No version table and no undo stack — the journal is append-only, so it already *is* the history; this only reads an entry back out. Taking an event id rather than only undoing the last change is not extra code, and it beats a stack that makes you undo three things to reach the one you meant. A revert journals as an edit too, so it can be undone in turn.

### Changed
- The "what was replaced" record moved from the copilot into **`patchCard`** — the one choke point every writer routes through. In 0.33.0 it only covered the copilot's re-run, which left a hand edit through `PATCH /api/cards/:id` silently unrecoverable; one mechanism is also the only way both stay in step. Only fields that actually changed are recorded, so `startCard` patching a branch on every launch doesn't fill the journal with "nothing was edited". (90cb727)

## [0.33.0] - 2026-07-28

### Added
- **Re-running the copilot on a container now replaces its split**, instead of silently declining to touch it. That button exists *because* the split came out wrong, so refusing the split was refusing the only thing it is for. Guarded on the state that matters rather than on a flag: the old sub-tasks are replaced only while every one of them is still untouched (backlog/ready, no branch, no workspace, no session, no children of its own). One started sub-task and the whole split is kept — a card with a worktree behind it is not something a second opinion gets to delete — and `copilot.split_kept` says so in the journal. (e52a993)

### Changed
- `copilot.reformulated` now records the title, spec and acceptance it **replaced**. A re-run overwrites a spec you may have edited by hand, and the card view already renders the journal, so the previous text is one tap away rather than gone.
- `CopilotCoordinator.reformulate`'s doc claimed it "never overwrites what a human typed". It always did, and only the branch was ever held back. The comment now describes the code.

## [0.32.0] - 2026-07-28

### Added
- **A split now produces real cards, linked.** The copilot's `split_suggestion` was a list of *titles*, so a dictated note naming three tasks became three context-free stubs that had to be rewritten by hand — while the dump they came from, the only place that context existed, sat open in front of the copilot. Each entry is now a whole card (spec + acceptance), and `split` replaces `split_suggestion` (the old name still parses).
- **`card.parent_id` and `card.depends_on`** — provenance and ordering, kept apart on purpose. A card with children is a **container**: it holds the original dictation, isn't startable, and derives its status from its children (urgency first, so one blocked child outranks three that are working).
- **The dependency is a gate, never a trigger.** A card that declares a predecessor refuses to start until it is `done` and names what it waits on; a finished predecessor makes its successor start*able*, and you start it. Nothing here ever launches an agent on its own.
- **A dependent card forks from its predecessor's branch**, not from the repo's base — a serial task needs the previous one's code, not a summary of it — and its prompt says so, with the predecessor's review notes. The resolved base is persisted, so the card's diff still shows only its own work.

### Changed
- The reformulation prompt decides one-task-vs-several first, and on "several" puts *every* task in `split` with the top-level card as their container. It used to keep one task at the top level, which is how the same work ended up on two cards.
- `depends_on` is an index pointing **backward** in the split list, so a dependency cycle is unrepresentable rather than merely unlikely. Hand edits go through an explicit cycle check (`PATCH /api/cards/<id>` → 400).

### Fixed
- Node 24+ defines a `localStorage` global that stays undefined without `--localstorage-file` and shadows jsdom's, so 17 frontend tests broke the day the machine's Node was upgraded, with nothing in the repo having changed. The test setup installs a real one when it's missing.

## [0.31.0] - 2026-07-28

### Changed
- **Line wrap now defaults ON below 640px.** The pane mirror shipped with `wrap: false`, so on a phone most lines ran off the edge and reading it meant panning horizontally — measured on a real herd, panes run a median of 81 columns and a max of 233 against the ~50 a phone shows. The default follows the viewport rather than flipping globally: no-wrap is right on a wide screen, where column alignment is what makes a TUI's boxes readable. The existing toggle still wins the moment it is touched.
- The card's file-diff sheet wraps on a phone too, in pure CSS (`sm:` breakpoint), so it follows a rotation with no re-render.

## [0.30.2] - 2026-07-28

### Fixed
- An unexpected throw in a board route reached `Bun.serve` and came back as a 500 **HTML** page to a client polling JSON, with the cause visible only in `journalctl`. `handleBoardRoute` now nets those into `{ok:false, kind:"internal"}` and logs them.

### Notes
- A repository under `/tmp` is invisible to the service: the unit sets `PrivateTmp=yes`, so git fails with `ENOENT … posix_spawn 'git'` — which reads as "git is missing" when it is the working directory that is. Documented in the README.

## [0.30.1] - 2026-07-28

### Fixed
- Two GNU-only commands in the fork's own additions, both of which would have failed on macOS — a platform this plugin declares support for: `date -Iseconds` in `setup` (BSD `date` has no `-I`) and `stat -c '%a'` in the control-script tests (BSD wants `stat -f '%A'`).

## [0.30.0] - 2026-07-28

### Added
- **macOS gets the exact transcript resolution too.** `processStartedAt()` falls back from `/proc/<pid>/stat` to `ps -o etime=`, so the PID→transcript match works on both platforms Collie targets rather than degrading on one of them — macOS's `birthtime` support is native on APFS/HFS+, so giving up there for want of a start time would have been perverse. `etime` rather than `lstart`: the latter is locale-dependent (it prints `mar. juil. 28 …` here). Verified against `/proc` on the same process: 1.3 s apart.

### Fixed
- `parseEtime("-1:00")` returned 60 seconds — an empty days field parsed as 0. It matches a strict grammar now.

## [0.29.1] - 2026-07-28

### Added
- `UPSTREAM_PRS.md` — the upstream PR ledger: each generic brick with the commits that carry it, the files, and whether it is a clean cherry-pick or needs extraction. `CLAUDE.md` now requires updating it in the same commit that introduces a PR-able change.

### Fixed
- `processStartedAt()` rejects a computed start time in the future or before boot — the only way a wrong `USER_HZ` could manifest, and it now degrades to the by-directory fallback instead of returning a confident bad number.

## [0.29.0] - 2026-07-28

### Added
- **Exact transcript resolution without herdr's integration** (`bridge/proc.ts`, `TranscriptSource.resolveForProcess`). `pane.process_info` gives a pane's foreground PID, `/proc/<pid>/stat` its start time, and the session log born closest after it is that process's — measured gap on this machine: 7 s. This removes the one place the cwd fallback could be WRONG rather than merely absent: two agents live in one directory made "newest file in the folder" a coin flip, and a coin flip there means reporting another session's context. Degrades to the cwd guess with no `/proc` (macOS/Windows) or no birth times.
- **`POST /api/cards/:id/reformulate`** + a Reformulate button: hand a card back to the copilot. Creation already does this, so it covers the two cases it can't — a card written while the copilot was off, and a reformulation you didn't like.
- **Card editing** (`web/src/components/card-editor.tsx`): title, spec, acceptance criteria (as a list, not a newline blob) and base ref. Until now the only way to change a spec was to delete the card, which also threw away its sessions and journal. The branch is deliberately not editable — a worktree may exist at it.

## [0.28.0] - 2026-07-28

### Fixed
- **Every card's first prompt could be silently swallowed.** Claude Code shows a "Is this a project you trust?" dialog the first time it runs in a directory — and herdr reports `interactive_ready: true` while it is up, so there is no state to wait for. The prompt text is eaten by the select and its Enter answers the dialog: nothing typed, nothing runs, pane looks normal. **Every card gets a brand-new worktree directory**, so this hit every card. `promptAndConfirm(..., { firstAfterLaunch: true })` now verifies the agent actually started working and re-sends once.
- **The copilot never adopted its existing pane.** `ensurePane()` always created a new workspace, so after any bridge restart `agent.start` failed with `agent_name_taken` (herdr agent names are globally unique) — leaving an orphan `board` workspace behind each time. It now adopts a running agent in its work dir, or relaunches into a leftover shell.
- **The copilot swallowed every error silently.** `catch { return null }` with no output is why the two bugs above took an hour to find. Failures are logged, and a failed request drops the pane so the next one rebuilds.
- **State dir was still upstream Collie's** — `~/.local/state/collie` instead of `~/.local/state/collie-board`. A fork-rename miss (the path is built from separate segments, so the rename pass didn't match it). Move an existing one by hand: `mv ~/.local/state/collie ~/.local/state/collie-board` **with the service stopped** — a running agent caches its cwd as a string and will keep writing to the old path.

### Changed
- `Copilot` takes a snapshot accessor (for adoption) and injectable request timings (so the tests don't wait five minutes).

## [0.27.0] - 2026-07-28

### Added
- **Cold start for the repo picker**: with no cards and an empty herd the list used to be blank. The scan now falls back to conventional locations (`~/git`, `~/code`, `~/dev`, `~/src`, `~/projects`, `~/work`, `~/repos`, `~/Documents/GitHub`) when `COLLIE_BOARD_REPO_ROOTS` isn't set. Measured at 12 ms for 27 repos. Explicit config REPLACES the defaults.
- **Hide a repo** — long-press in the picker; `repo_pref` table, `POST /api/repos/hide`, `GET /api/repos?all=1`, and an "*N* hidden — show" toggle. This is the only thing the board stores about a repo, because it's the only thing it can't derive: a scan finds every repo you own and has no idea which ones you card.
- The sheet drops straight into manual path entry when nothing is found at all, instead of showing a lone "type a path instead" link.

### Fixed
- `listRepos()` reached for `homedir()` / `existsSync` internally, so its own tests found the machine's real repositories. Scan roots are resolved by the caller.
- A hidden repo no longer costs a `git symbolic-ref` to resolve a default branch that will never be shown.

## [0.26.0] - 2026-07-28

### Added
- **Repo picker on the new-card sheet** (`bridge/repos.ts`, `GET /api/repos`). Typing a path on a phone was the worst part of creating a card. The list is DERIVED, not stored: repos you have carded (`card.repo_path`, newest first) + repos open in the herd (pane `cwd` → `git rev-parse`) + an opt-in scan root (`COLLIE_BOARD_REPO_ROOTS`).
- The repo's default branch pre-fills the base ref — `origin/HEAD` first, so a repo sitting on a previous card's branch doesn't fork the next card off it.
- A card's own worktree collapses onto its source repo via `--git-common-dir`, so "start a card in another card's worktree" is never offered.
- Manual path entry stays available for a repo the bridge cannot know about.

### Notes
- No `repo` table on purpose: it would be a second copy of `card.repo_path` with nothing to invalidate it, so a moved or deleted repo would sit in the picker forever.
- `workspace.worktree.repo_root` is NOT a usable source — live-verified on herdr 0.7.5, it is populated for some workspaces and not others (one of four, all git repos). Pane `cwd` is the field that is always there.

## [0.25.1] - 2026-07-28

### Fixed
- **`start` failed with "bun not found" on a completely standard install.** Herdr runs plugin actions in a non-interactive shell, so the `~/.bun/bin` entry bun's installer adds to your shell rc doesn't apply. `resolve_bun()` now also checks `$BUN_INSTALL/bin`, `~/.bun/bin`, `/usr/local/bin` and `/opt/homebrew/bin`, and the error message names the real cause.
- `tailscale status --json | bun` ran under `pipefail`, so a tailscale that is installed but not connected killed the whole script through `set -e` instead of degrading to "unknown". Output is captured before it is piped.
- `self_dnsname` / the setup helpers called bare `bun`, so they degraded silently (empty URL, no derived config) in exactly the environment that couldn't find bun on PATH. They use the resolved path.
- `tailscale serve` failures are now diagnosed from what tailscale actually said: "serve config denied" is a permission (`sudo tailscale set --operator=$USER`), not the missing-certificate case the https branch used to blame unconditionally.

## [0.25.0] - 2026-07-28

### Added
- `collie-board-ctl.sh setup` (+ a `setup` plugin action): first-run bootstrap. Preflight (bun / herdr / socket / tailscale), links the plugin, and **derives `COLLIE_BOARD_TRUSTED_USER` and `COLLIE_BOARD_PUBLIC_HOSTS` from `tailscale status`** — the two security settings people skip. Detects a tailnet with no HTTPS certificate and writes the `SERVE_MODE=http` fallback instead of letting `serve` fail.
- Refuses to touch an existing `.env`: it reports what's missing and prints the exact lines. Starts nothing, publishes nothing.

## [0.24.0] - 2026-07-28

### Added
- **Agent adapters** (`bridge/adapters.ts`, `adapters/agents.toml`): the four points where agents diverge — launch kind, context-reset command, whether the transcript is readable, whether a native session id is reported. Merged per FIELD from `~/.config/collie-board/agents.toml`, so overriding one line doesn't restate the table.
- The context tracker skips agents whose transcript format isn't readable (level 3 by construction), and the copilot takes its reset command from the table.
- `UPSTREAM.md` — what is PR-able, what is fork-only, and the (short) list of upstream files this fork touches.
- README: a board section with configuration, endpoints and what is deliberately not built. `ARCHITECTURE.md` §9 and the fork's rules in `CLAUDE.md`.

## [0.23.0] - 2026-07-28

### Added
- **Copilot** (`bridge/copilot.ts`) — one long-lived agent in a dedicated `board` workspace, driven through the same `agent.prompt` the cards use. No API key, no SDK; the session is openable in the TUI when an answer goes wrong.
- Output contract is a FILE, never terminal scraping: each prompt ends with "write the JSON to `.board/out/<id>.json`", and the file appearing is the completion signal.
- **Reformulation** — a dictated brain dump becomes title + spec + acceptance criteria + branch name, in the background (creating a card stays instant). `split_suggestion` becomes extra backlog cards.
- **Post-`done` review** — verdict + notes + todos from `git diff --stat` and the handoff note, never the full diff. The todos become cards, which is what refills the board from what agents left undone.
- Serialised to one request at a time (one pane is one queue), `/clear` every 8 requests, and **off by default**: `COLLIE_BOARD_COPILOT=on`. Also `COLLIE_BOARD_COPILOT_KIND`, `COLLIE_BOARD_COPILOT_CLEAR`.

### Fixed
- `launchAgent()` is now the single path for starting an agent (retry on `agent_pane_busy`, then wait for `interactive_ready`). Calling `agent.start` directly is how you get a pane with a shell prompt and no agent in it — which is exactly what the copilot did on its first run.

## [0.22.0] - 2026-07-28

### Added
- **Handoff** (`bridge/handoff.ts`, `POST /api/cards/:id/handoff`): the outgoing agent writes `.board/handoff.md`, the pane is replaced in the SAME workspace (same worktree, same branch), and the incoming agent opens on the note plus the original spec. Sessions chain on the card.
- Asynchronous by design — the request only prompts; the poll loop completes the swap once the note lands. The marker is a database column (`session.handoff_requested_at`), so a pending handoff survives a bridge restart.
- Additive schema migrations in `BoardDb.migrate()`.
- PWA: Hand-off button (prominent past `COLLIE_BOARD_HANDOFF_PCT`), pending state, and each session's note readable inline on the card.

### Fixed
- **`agent.prompt` does not reliably submit.** Live-verified on herdr 0.7.5: a multi-line prompt lands in Claude Code's box as `[Pasted text #N]` and just sits there; one `Enter` afterwards submits it untouched. `promptAndConfirm()` now checks the agent actually started working and nudges with `Enter` when it didn't — the same "read it back and look" rule Collie already applies to replies.
- `.board/` is excluded from a card's diff — it's board plumbing, not the card's work.

## [0.21.0] - 2026-07-28

### Added
- **Card diff** (`bridge/git.ts`, `GET /api/cards/:id/diff?mode=stat|file&path=`): the card's checkout against its fork point, so committed AND uncommitted work show up, plus untracked files (which `git diff` cannot see). `--stat` first on mobile, tap for the unified patch.
- **Context gauge** (`bridge/context.ts`, `latestUsage()` in `bridge/transcript.ts`): input + cache_creation + cache_read of the newest non-sidechain assistant turn, refreshed per pane every 30 s off the existing poll.
- The gauge is pushed to herdr with `pane.report_metadata`, so it renders as `$ctx` in the TUI's Agents sidebar too. TTL'd (90 s) so a stopped bridge leaves no stale figure.
- `TranscriptSource.resolveByCwd()` — finds an agent's log from the directory it was launched in, for the (default) case where herdr reports no `agent_session`.
- Config: `COLLIE_BOARD_CTX_WINDOW` (default 200000; set 1000000 for a 1M-context model).

### Notes
- Level 2 of the telemetry design (a transitions/output heuristic) is **deliberately not built** — see the header of `bridge/context.ts`. Level 3 (no gauge, Handoff always available) is the degradation.
- herdr reports `agent_session` only once `herdr integration install claude` has run; without it, Collie's own pane History is unavailable too. The gauge works either way thanks to the cwd fallback.

## [0.20.0] - 2026-07-28

### Added
- **Start a card from the phone**: `POST /api/cards/:id/start` runs `worktree.create` → `agent.start` → readiness poll → `agent.prompt` (spec + acceptance criteria) and opens a session. 1 card = 1 branch = 1 workspace.
- `POST /api/cards/:id/prompt` — a follow-up instruction to the card's running agent.
- Concurrency semaphore (`COLLIE_BOARD_MAX_AGENTS`, default 3), counted from the database so a restart doesn't forget.
- Config: `COLLIE_BOARD_AGENT_KIND`, `COLLIE_BOARD_MAX_AGENTS`, `COLLIE_BOARD_BRANCH_PREFIX`, `COLLIE_BOARD_HANDOFF_PCT`.
- PWA: Start / Relaunch button and a prompt box on the card page.

### Fixed
- `bridge/herdr-client.ts`: per-request timeout, so `agent.start` isn't judged by the 5 s RPC budget.

### Notes — herdr 0.7.5, live-probed 2026-07-28
- `agent.start` does **not** wait for readiness (returns in ~2 ms, `launch_pending: true`); prompting in that window fails `agent_not_ready`. The bridge polls `agent.get` for `interactive_ready` instead.
- `agent.start` right after `worktree.create` fails `agent_pane_busy` while the shell sources its rc — retried, and only on that code.
- `agent.start` names must match `^[a-z][a-z0-9_-]{0,31}$`, so a branch name can't be used as-is.
- `worktree.create` reuses an existing BRANCH, but fails if the checkout DIRECTORY exists; `worktree.open` is idempotent and returns `already_open` — that pair is the relaunch path.

## [0.19.0] - 2026-07-28

### Added
- **Cards** — a durable board on top of the ephemeral herd: `bridge/db.ts` (bun:sqlite, raw SQL, no ORM), `bridge/cards.ts`, `bridge/board-routes.ts`.
- Card reconciliation rides the existing `session.snapshot` poll: a pane that vanishes moves its card to `orphaned` (never an error) and closes its session as `lost`; a live pane drives the card's column from `agent_status`.
- REST: `GET/POST /api/cards`, `GET/PATCH/DELETE /api/cards/:id`, `GET /api/cards/:id/{sessions,events}` — all behind the existing `guard()`, all audited.
- PWA: `/board` (columns, urgency first) and `/card/:id` (spec, acceptance, session chain, journal), plus a Board row on the dashboard.

## [0.18.0] - 2026-07-28

### Changed
- Forked upstream Collie as **Collie Board**: plugin id `herdr.collie-board`, systemd unit `collie-board`, env prefix `COLLIE_BOARD_*`, default port 8788, config/state dirs `~/.config/collie-board` / `~/.local/state/collie-board`, control script `scripts/collie-board-ctl.sh` — so both plugins can be installed on one machine.
- Upstream release check is opt-in via `COLLIE_BOARD_UPDATE_REPO`; the local `bridgeStale` detector is unchanged.
- `LICENSE` keeps Collie's MIT copyright and adds the fork's.

## [0.17.0] - 2026-07-27

### Fixed
- **A reply sent while an agent dialog was focused answered the dialog instead.** The submit key approved whatever option was highlighted (Claude defaults to "Yes") and the message was destroyed, while the bridge reported success. Sending now refuses outright while a dialog is up, and otherwise types first and only submits once the text is verified in the input box (#34) — thanks @maikschuheida-spec

### Changed
- Free-text replies on harnesses with a block grammar (Claude) are two steps — type, verify, submit — so "Sent ✓" now means the text was seen in the input box. Harnesses without an adapter keep the previous one-shot send

## [0.16.1] - 2026-07-27

### Fixed
- `/api/config` is now gated like every other endpoint — it was the one route that skipped the same-origin check and `COLLIE_PUBLIC_HOSTS`, noted by @Optic00 in #32 (a54afd9)

## [0.16.0] - 2026-07-27

### Added
- Bring-your-own-tunnel deployment path documented as **Variant E** — NetBird, ZeroTier, Cloudflare Tunnel (6550041)
- `scripts/collie-ctl.test.sh` — first lifecycle coverage for the control script, wired into the pre-push hook (a004449, 65889da)

### Fixed
- `unserve`/`uninstall` no longer remove a `tailscale serve` mapping Collie didn't create, and `start` no longer replaces one (a004449, thanks @iamtimmy)
- A front door that fails to publish no longer aborts `start` before the status banner (65889da)

## [0.15.0] - 2026-07-26

### Added
- Pane conversation history read from the agent's own transcript — scroll back past the live mirror (77dff7c)
- Windows support for the bridge: dials herdr's named pipe through `node:net`, one code path for both platforms (#25, #27) — thanks @mikebenner and @bwright2810 (dd6610d)
- `COLLIE_HERDR_DIAL=auto|net|bun` forces the dialer; `net` exercises the Windows path on Linux/macOS (f662834)

### Changed
- **Breaking, only if `COLLIE_DEVICE_HEADER` is set:** a request arriving *without* the device header is now read-only. It previously got full write access, which let any tailnet client reach the bridge's own URL and skip the proxy that injects the header. Front doors that inject it on every request are unaffected; direct loopback/MagicDNS access now needs the header sent by hand (#28) — thanks @Optic00 (8ed715d)

### Fixed
- A 401/403 no longer renders as an endless "reconnecting" banner — an access refusal now says so and offers Reload (#30) — thanks @Optic00 (7bdcbfb)

## [0.14.2] - 2026-07-23

### Added
- Paste an image straight from the clipboard into the composer, same upload path as the picker (#24) (ad6957b)

## [0.14.1] - 2026-07-22

### Fixed
- `collie-ctl.sh self_dnsname` shelled out to `node`, which Collie never requires — now uses `bun` (#22) — thanks @jz-wilson (a61f3d1)

## [0.14.0] - 2026-07-21

### Added
- Alt modifier in the nav tray — `alt+<key>` chords now reachable from the phone (#19) — thanks @bnivanov (d1dc947)
- Modifiers combine (checkbox, not radio): `ctrl+shift+p`, `alt+shift+p`, even triple chords (#20) (d1dc947)
- Modifier lock — tap an armed modifier again to keep it armed across presses and Sends; Clear or a third tap releases (#20) (d1dc947)

### Changed
- HERDR_API.md: multi-modifier chords live-verified in any order against Herdr 0.7.3, cross-confirmed on 0.7.4 by @bnivanov (b505c4e)

## [0.13.2] - 2026-07-20

### Fixed
- Tabs render in Herdr's reported order instead of stable-number order, so a reorder in Herdr survives to the screen — thanks @iFwu (a16478f)
- Tapping raw terminal output focuses the composer synchronously, keeping iOS's user-activation window so the software keyboard opens — thanks @iFwu (a78ccfd)

## [0.13.1] - 2026-07-20

### Fixed
- Taking over or sending a draft no longer permanently mutes the preview for that same text — the handled key resets once the host line clears (7153639)
- Send's pre-clear sweep overshoot widened 8 → 32 so host typing inside the poll gap can't leave a remnant (7153639)
- A scrollback line starting with `❯` can no longer pin a bogus session name — only the live (bottommost) prompt decides (808cce7)

## [0.13.0] - 2026-07-19

### Added
- Long-press a pane pill for a pane actions sheet — rename + two-tap close (5b50941, c713551, 90210ce, ea20df0)
- Pane rename end-to-end: `pane.rename` RPC, bridge route, label threading (99c8808)
- Tab rename + tab close (blast-radius confirm) via the same long-press sheet on tab chips (a9664b5, 37a470e)
- Claude's own `/rename` session name surfaced on cards, headers, and the switcher (d22fdd7)
- Read-only "Draft in terminal" preview with explicit Take over — the composer input is exclusively phone-owned (4b6f0ac, 10fa28d)
- Self-update without the service worker: `X-Collie-Build` on polled responses, auto-reload or tap-to-update banner (8d13622)
- Instant offline navigation — during a known outage, routes serve the last good snapshot instead of hanging on a dead fetch (b756edd)
- Busy strip on genuinely hung loads: navigations >500ms, background polls >6s (e886541, 3bfaa1c, 06516c4)
- `-dev` marker in the build stamp for non-release builds (3e785f4)

### Changed
- One shared `AppHeader` for dashboard, space, and pane — same components underneath, stale status badges dim during outages (29432c2)
- Connection status is a single animated top bar — amber "reconnecting…" after 4s of trouble, red with Retry at 15s, green flash on recovery; no header pill (394e6fe, b2dd50e)
- Switcher sections carry status-colored bullets; per-row close removed (switching is the only action there) (3918c69)
- `assets/*` served immutable, everything else `no-cache` — proxy caches can no longer starve `/sw.js` updates (8d13622)

### Fixed
- Own in-flight reply no longer flagged as a stranded terminal draft (e8462f9)
- Wrapped multi-line drafts and the new background-agents footer no longer break input-box detection (829fc7e, d9521e3)
- `navigator.onLine` never gates polling or liveness — lying flags can't wedge the app or fake outages (d31ffb8, 394e6fe)
- One shared connection-lost clock; escalation survives route changes and app switches until a poll succeeds (1486e07, 5949885)
- Sustained outages escalate everywhere — boot splash, header, banner — with Retry/Reload (0cbbac1, 4d89588, 4494cf5)
- Gallop sprite re-centered; the dog never freezes mid-stride (rest state is the static icon) (3c7174a, 394e6fe)
- Offline banner no longer overlaps the sticky header (bf98a88)

## [0.12.0] - 2026-07-17

### Added
- `COLLIE_SKIP_SERVE=1` env var to disable tailscale serve entirely — bridge stays on loopback only, ideal for deployments behind a reverse proxy (Caddy, Nginx, etc.) — thanks @diogenesc (ad5833a)
- `COLLIE_PUBLIC_URL` — `collie-ctl.sh status` banner shows your real reverse-proxy URL instead of a placeholder (4b043be)
- Bridge startup warning when `COLLIE_TRUSTED_USER` is set under `COLLIE_SKIP_SERVE=1` — the identity gate is inert without tailscale serve injecting `Tailscale-User-Login`; use `COLLIE_DEVICE_HEADER` (4b043be)
- README Variant C — reverse proxy as the only front door (no Tailscale), with Caddy example and required env (76019f7)

### Changed
- `collie-ctl.sh unserve`/`uninstall` always attempt serve teardown, even under `COLLIE_SKIP_SERVE=1` — a stale mapping from before the flag flip would keep publishing the app (4b043be)
- Security posture docs: "tailscale serve is the sole ingress" → "exactly one hardened front door" (tailscale serve or a conforming reverse proxy) across README, ARCHITECTURE, CLAUDE.md (76019f7)

## [0.11.1] - 2026-07-16

### Fixed
- Opening a tab/pane lands on the live tail — terminal `<pre>` no longer steals vertical scroll from the message list; stickiness also re-pins when content grows (04bf6fc)

## [0.11.0] - 2026-07-15

### Added
- Pluggable harness-adapter architecture: a `HarnessAdapter` registry replaces the single Claude-only gate, Claude's detectors move to `lib/harness/claude/`, and a core race-guard engine (`lib/harness/guard.ts`) is the only module that may touch the network — an import fence (enforced by `fence.test.ts` under `bun run test`) + a conformance suite let contributors add codex/pi/opencode (see `HARNESS_CONTRIBUTING.md`)
- multiSelect AskUserQuestion support: checkbox options up-level to tappable checkbox rows (terminal is source of truth), with a closed-loop Submit that navigates the pointer to Submit and verifies before Enter (never blind-sends), plus the review/confirm screen
- Prompt overlay: interactive prompts render in a bordered `bg-card` panel that lifts the whole dialog off the terminal mirror, with elevated option rows, leading key-digit badges, and a family-aware caption
- Update notifications: a footer banner (linking to the GitHub release) and an opt-out web-push when a newer release is published upstream or the running bridge is behind the on-disk code — checks the repo's tags over anonymous HTTPS, stamps its own sources for the restart signal, a Settings "check for updates" button forces an immediate check, an `updates` notify pref is the off-switch, and update/restart are surfaced as location-independent Herdr plugin actions

### Changed
- Keys and Quick menus dock in-flow above the controls row instead of a fixed overlay, so the terminal mirror shrinks and re-pins to the bottom (ResizeObserver) — the prompt/cursor stays visible; both buttons are toggles
- Prompt option rows compacted (tighter padding, snug line-height) so a multi-option dialog fits the phone viewport
- "Sent" status toast moved from a bottom overlay (which covered the terminal tail) to a slim in-flow row below the header
- Build stamp marks a dirty working tree (`<sha>-dirty`), so the footer no longer claims HEAD when the build carries uncommitted work
- multiSelect Submit is ~2s instead of ~15s: the pointer walk re-reads the actual position each step and stops on "Submit", instead of polling for the bottom row after every key (which timed out ~2.8s per step)

### Fixed
- Prompt-select + wizard grammars: a numbered list in a dialog body (e.g. a plan's steps) no longer breaks menu detection — the menu is taken as the trailing `1..m` run, so plan-approval prompts up-level correctly

## [0.10.3] - 2026-07-12

### Fixed
- `collie-ctl.sh build` installs the root dependency tree (not just `web/`) before typechecking, so a fresh Herdr install no longer fails with TS2688 "Cannot find type definition file for 'bun'" (03f409f, #9)

## [0.10.2] - 2026-07-12

### Fixed
- Composer Send clears a stranded draft off the terminal `❯` line (ctrl+k + Backspace) before typing so replies no longer accumulate on the prompt; a clean prompt skips the clear (cd1cc25)
- Bridge settles ~350ms between typing and Enter so the TUI reliably accepts the submit key (cd1cc25)

## [0.10.1] - 2026-07-11

### Fixed
- Terminal mirror defaults to no-wrap for table alignment like desktop Herdr; clearer borders/typography (font 12, muted-foreground box-drawing); pane stays viewport-width — toggle Wrap on in View for prose (85f777b)

## [0.10.0] - 2026-07-10

### Added
- Herdr session switcher: one bridge fronts every named herdr session — `?session=` on the API, `?s=` in the app, a sessions summary in the snapshot, per-session notification slots, and a `COLLIE_MULTI_SESSION` kill-switch (8fa1f20)
- Space detail is a deep-linkable route (`/space/:spaceId`) with a working browser Back button, replacing the in-home drill-in state (0e5f9c8)
- Terminal-draft recovery: a queued-then-recalled message stranded on the "❯" input line surfaces as a composer chip, with "Edit here" to clear the line and adopt the text cleanly (46dcf35)

### Changed
- Dashboard leads with "Needs you" — agents awaiting your input sit at the top, above the spaces overview (1d92592)
- Dashboard, space, and settings scroll inside a viewport-clipped region instead of the whole document (2aa9272)
- Session switcher and the session chip are dashboard-only, keeping the in-space and pane headers clean (bb0048d, ba56ba9)
- Header polish: consistent compact height across the dashboard and inside a space, zinc-800 nav chrome, a ringed Collie mark, a smaller pane-header agent logo, and the keyboard-only quick-keys strip removed (6250e0c, 9da7195, 35db0e5, ba56ba9)
- Security posture documents that `COLLIE_MULTI_SESSION` (default on) fronts every named session under the config root (fcb0b7d)

### Fixed
- Deep-linking a space that never existed shows "Space not found" rather than "Space closed" (fcb0b7d)

## [0.9.1] - 2026-07-09

### Security
- Removed one-tap yes/no reply buttons from push notifications — they POSTed to the terminal without opening the app, i.e. approving blind. Notifications now only deep-link to the pane (cb26ee0)

## [0.9.0] - 2026-07-07

### Changed
- Quick keys mimic a physical keyboard on both surfaces: Esc top-left, Tab below it, inverted-T arrows, Enter top-right; Keys sheet gains a full-width spacebar (2f70662)
- Attach image lives in the reply row (usable without the phone keyboard open); digits leave the inline strip — the 123 tab remains (2f70662)
- Header collie logo is transparent like the gallop sprite — removed favicon.svg's baked-in gray backing rect (3f05da8)

## [0.8.0] - 2026-07-07

### Added
- Poll herdr 0.7.2's `session.snapshot` — one RPC per tick instead of three list calls; permanent fallback to the list trio on older servers (5687bbf)
- Event-poked polling: `events.subscribe` stream triggers immediate debounced re-polls; interval relaxes to `COLLIE_POLL_IDLE_MS` (default 12s) while the stream is healthy (5687bbf)

### Changed
- HERDR_API.md re-verified against herdr 0.7.2 / protocol 16; terminal observe/control filed under ARCHITECTURE.md Future ideas (aad94b3)

## [0.7.0] - 2026-07-06

### Added
- Notification type prefs: Settings "Notify when" toggles per agent status, bridge-wide; default pushes only "Needs input" (blocked) — "Finished" (done) is off (98cf5d2)

### Changed
- Push sends carry a `collie-herd` topic + 6h TTL: an offline device now gets one current summary on reconnect instead of replaying every queued update (98cf5d2)
- Disabling a notification kind retracts its pending/outstanding alerts immediately (98cf5d2)

## [0.6.0] - 2026-07-06

### Added
- First-paint PWA splash: the galloping collie shows before React mounts (299f632)
- Keys sheet: `Ctrl` modifier + visible key queue — compose chords/sequences, review, Send as one call; dialer-size digits on a `123` tab (515f795)

### Changed
- Header Collie mark matches the agent logo (2rem, aligned across screens); Find lives in the composer View row; placeholder is just "Type a reply…" (11385ee)

### Fixed
- Option taps no longer pop the phone keyboard or steal the note editor's focus (11385ee)
- Stalled connections no longer zombify the app: fetch timeouts (10s/20s/60s), polls supersede a wedged revalidation at 12s, and the collie gallops within 2.5s of a stalled load or pane-tap navigation (e6ad939)

## [0.5.0] - 2026-07-05

### Added
- **Preview-variant question notes.** Claude Code's *preview* AskUserQuestion — a single-select
  question whose options carry a `preview` field (the mockup/snippet pane, footer hint
  `n to add notes`) — is lifted into a native block that surfaces the per-question note affordance.
  A note (attach / edit / remove) is driven from the native option UI and applies **per question**,
  not per option row. Delivery uses the verified staged keystroke choreography
  (`n` → confirm the input focused → clear → paste the text via the reply path → `Escape` to blur,
  each stage verified rendered before the next fires; `Enter` is never sent, since it would submit
  the dialog — see `web/src/lib/grammar/NOTES_NOTES.md`), and option selection is the two-step
  digit → verify-pointer → `Enter` recipe. Race-guarded like the other dialog blocks (a stale tap on
  a drifted dialog aborts before anything irreversible is sent). Claude-scoped (`hasBlockGrammar`)
  and web-only; the standard non-preview select and wizard steps are unaffected (pressing `n` there
  is a no-op, so no notes UI is shown).

### Security
- **Preview-note tap guard hardened to region-signature parity.** The preview dialog's race guard now
  carries a pointer- and note-independent **core signature** (the subject/question/stepper above the
  options joined with the option rows' left column, `❯` normalised) — matching the 0.4.0 `signature`
  parity the prompt/wizard guards already had. It is enforced at entry AND on **every** mid-flight
  acceptance/drift check, so a same-shaped successor dialog (identical question + labels, different
  subject) can no longer be answered by a stale tap: no digit-then-`Enter` or `Enter` is sent unless
  the fresh read's core signature byte-matches what the user saw. The blur poll is now three-valued
  (ok / drifted / timeout) so the Escape-retry fires only on a genuine swallowed key — never after the
  dialog drifted or vanished (which a blind second Escape could cancel / interrupt). Pasted note text
  is stripped of C0/C1 control bytes (ESC, BEL, …) before it can reach the focused input.

## [0.4.0] - 2026-07-05

### Added
- **Block-based terminal renderer.** Pane rendering now flows through a semantic Block AST (styled
  lines → typed blocks → React components) instead of a flat span mirror. The raw-block foundation is
  byte-for-byte identical to the old mirror, but it's the seam every feature below builds on —
  detected regions are lifted into native blocks in place, and anything unrecognized falls back to
  the raw mirror. Scoped to Claude Code (`hasBlockGrammar`); every other agent renders the plain
  mirror, since their TUIs are unverified.
- **Native prompt buttons.** A Claude single-choice dialog at the buffer tail (select, permission,
  trust, plan approval) is lifted out of the mirror and rendered as tappable buttons; a tap sends the
  per-family keystrokes (digit, or digit+Enter for AskUserQuestion), guarded so a stale tap on a
  scrolled-up menu can't fire. The agent's own input box/statusline are stripped so they don't
  duplicate the composer.
- **Status strip.** The stripped statusline (model · ctx% · cwd · branch · tokens) is re-surfaced as
  a slim line above the composer, so the branch/context stays visible instead of vanishing with the
  input-box chrome.
- **Submission progress bar.** A slim indeterminate bar across the top of the app while any mutation
  (reply, keys, prompt tap, upload, tab/space create, close, snooze) is in flight; background polling
  never triggers it, and a 120ms delay means a fast action never flashes it.
- **Raw-terminal escape hatch.** A View toggle (terminal icon) that turns off the block renderer —
  native prompt buttons, chrome stripping, status strip — and shows the plain mirror, so a
  mis-detected/mis-rendered dialog can always be driven by hand with the keys pad. Persisted.
- **Multi-question wizard.** A multi-question AskUserQuestion (the `☒ Focus area ☐ Scope ✔ Submit`
  stepper) now renders as a native step-by-step wizard instead of bailing to the raw mirror: the
  stepper chips (answered/current per question), the current question's options as tappable buttons
  (one digit each — verified: a wizard digit instant-selects and advances), back/next step
  navigation, and the final Submit review step (answers echoed, submit/cancel). Incremental
  round-trip: every tap is a single race-guarded keystroke re-derived against a fresh read; the TUI
  stays the source of truth. Choreography + fixtures documented in
  `web/src/lib/grammar/WIZARD_NOTES.md`.
- **Galloping Collie loader.** The mascot now doubles as the app's activity indicator: a 6-frame
  gallop sprite (`web/public/dog-gallop.png`, a 768×128 transparent strip) stepped through with a
  pure-CSS `steps(6)` animation (no JS timers). At rest it's the familiar static app icon
  (`favicon.svg`); it springs into the gallop on the boot splash while the first snapshot loads and
  whenever the connection isn't live (connecting / reconnecting / offline), settling back to the
  static icon once live. Honours `prefers-reduced-motion`. New `DogGallop` component; rough
  first-pass art to be replaced with higher-quality frames.

### Changed
- **One consistent top-left mark on every screen.** The Collie is now the brand + home button +
  connection loader in a single shared `CollieHome` component, rendered identically on the dashboard
  and inside a pane — so the header's top-left always means the same thing (previously a "stacks"
  icon inside a pane vs. the Collie logo on the dashboard). Inside a pane the Collie gallops on
  reconnect from the same global connection state as the dashboard (shared `isConnecting` predicate).

### Removed
- **The pane's Nav-hub drawer** (the left "stacks" drawer). It was redundant now that the Collie
  handles Home, the swipe-up switcher already covers pane switching/closing, and the breadcrumb
  covers cross-space jumps — removed along with its `SpaceList` component. The swipe-up switcher now
  appears whenever a pane is open, so even the last pane stays closable.

### Fixed
- **Multi-question AskUserQuestion no longer mis-parsed.** A multi-step AskUserQuestion (the
  `☒ Focus area  ☐ Scope  ✔ Submit` stepper) was detected as a single-question select and answered
  with one digit+Enter — submitting a half-filled form. It's now recognized as a wizard and left as
  the raw mirror (drive it with the keys pad, or via the new escape hatch) rather than mis-sending.

### Security
- **Prompt/wizard taps are guarded against same-shaped successor dialogs.** The tap race guard now
  compares a byte-signature of the whole dialog region — including the subject above the options (the
  diff/command being approved), not just the question and option labels. So a tap on a frozen mirror
  can no longer approve a *different* action that happens to render an identical-looking prompt (e.g.
  a second edit to the same file after the first was answered elsewhere). Herdr's `revision` is a
  stub, so this content signature is the load-bearing freshness check.

## [0.3.0] - 2026-07-03

A full-codebase review pass: four audit agents (backend, frontend, security, ops/product) swept the
tree; everything they found was verified, fixed, and the top feature gaps were built.

### Added
- **Reply from the notification.** Needs-you pushes now carry up to two quick-reply action buttons
  (agent-aware: codex gets `yes`/`no`, others `yes`/`continue`; bridge sends `quickReplies` in the
  payload). Tapping one POSTs the reply straight from the service worker and confirms with a silent
  "Sent ✓" — no app open needed. Body tap still deep-links as before.
- **Find in output.** A magnifier in the pane header opens a find bar: case-insensitive match over
  the visible buffer, match count, prev/next that cooperates with the scroll-freeze, highlights
  rendered through the same React-text-node path (XSS boundary untouched).
- **Load older scrollback.** A "load older" row at the top of the mirror grows the fetched window
  600 lines at a time (up to 5000; the bridge clamps reads at 10000), preserving your scroll
  position across the refetch.
- **Destructive-input confirm.** Replies matching a reviewed pattern list (`rm -rf`, `sudo`,
  `git push --force`, `dd if=`, `mkfs`, redirects to system paths, …) flip Send into a two-tap
  "Really send?" state for ~3s — same pattern the `/clear` palette action already used.
- **Audit log.** Every write action (reply, keys, upload, tab/workspace create, pane close) appends
  a single JSONL line — timestamp, action, pane, device, truncated params — to
  `<state-dir>/audit.log` (mode 0600). Audit failures never block the action itself.
- `COLLIE_PUBLIC_HOSTS` env var — an explicit Host-header allowlist. When set, requests addressed
  to any other Host are rejected before origin logic, defeating DNS rebinding. Strongly
  recommended (set it to your MagicDNS name); effectively mandatory with `COLLIE_SERVE_MODE=http`.
- Startup warnings when `COLLIE_TRUSTED_USER` or `COLLIE_PUBLIC_HOSTS` is unset — parity with the
  existing bind/allowlist warnings, since an empty trusted-user means any tailnet device has write
  access.
- Uploaded images are now swept after 48h (was: kept forever).

### Changed
- **Builds are gated.** `bun run build` (root) and `collie-ctl.sh build` now typecheck bridge and
  web before building, and build into `dist-staging` with an atomic swap — a failed build can no
  longer leave an empty `web/dist` serving 503s. The pre-push hook typechecks both sides too
  (`SKIP_TYPECHECK=1` to bypass once). Root tsconfig now enforces `noUnusedLocals/Parameters`.
- **Write requests without an `Origin` header are rejected** unless they arrive on loopback
  (browsers always send Origin on POST; curl-on-host keeps working).
- Idle lock is now timestamp-based: backgrounding/foregrounding the app no longer resets the
  countdown, and returning past the deadline locks immediately.
- The composer moved into its own `<Composer>` component; `agent-chat.tsx` slimmed by ~230 lines.
- A reply whose text lands but whose submit keystroke fails now reports "typed into the pane but
  not submitted — check the pane before resending" (and `textDelivered: true`) instead of a generic
  error that invited double-sends.
- systemd unit hardened (`NoNewPrivileges`, `PrivateTmp`) and made persistent
  (`StartLimitIntervalSec=0`, `RestartSec=5`) so a crash-loop can't leave the service permanently
  down while you're phone-only.
- Notification deep links URL-encode the pane id; sheets manage focus (focus in on open, restore on
  close, `aria-labelledby`); space status dots gained screen-reader text; pinch-zoom re-enabled
  (removed `maximum-scale=1`).

### Fixed
- **Socket leak on RPC timeout** — a stalled Herdr left the Unix-socket FD open on every timed-out
  request; under the 1.5s poll cadence this exhausted file descriptors and wedged the bridge. Every
  terminal path now closes the socket.
- **UTF-8 corruption across socket chunks** — multi-byte characters (box drawing, emoji) straddling
  a socket-read boundary rendered as `�`; replies are now stream-decoded.
- **Overlapping polls** — a slow Herdr let 1.5s ticks pile up 3-4 concurrent polls; a tick is now
  skipped while the previous poll is in flight.
- **Upload buffering** — a too-large upload was buffered fully into RAM before the 10MB check;
  oversized `Content-Length` is now rejected up front and `Bun.serve` caps request bodies at 12MB.
- Push subscription saves are serialized and written atomically (temp+rename); concurrent
  add/prune can no longer drop a subscription. State files are written 0600 in 0700 dirs.
- First PWA load no longer flashes an immediate reload (service-worker `controllerchange` on
  initial claim was treated as an update).
- A rotated VAPID key now unsubscribes the stale push subscription and re-subscribes fresh instead
  of silently dead-ending pushes.
- Superseded loader revalidations are aborted (`request.signal` threaded through); raw key presses
  debounce their revalidate (one refetch per burst instead of one per keystroke).
- Slash-command insert appends to the draft instead of overwriting it; tap-to-focus no longer
  collapses an active text selection (copying pane output works now).
- `envInt` config parsing rejects garbage and out-of-range values (negative poll/debounce
  intervals, invalid ports) with a warning instead of silently accepting them.
- Static-file path guard now checks the directory boundary (`dist` vs `dist-*`); `?lines=` is
  clamped; API/static responses carry `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`; graceful shutdown drains in-flight requests.
- Pre-commit version guard now also covers `web/vite.config.ts`, `web/index.html`,
  `web/package.json`, `web/public/`, `systemd/`, and root `package.json`, and requires the new
  version to sort strictly above the old one.

## [0.2.0] - 2026-06-30

### Changed
- **Smarter push notifications.** A blocked/done alert is no longer fire-and-forget. Each one now
  waits a short **debounce window** (`COLLIE_NOTIFY_DELAY_MS`, default 30s) before it sends; an agent
  you clear at your desk within that window never reaches your phone. Alerts that *do* fire are
  **retracted** automatically once the agent resolves (or its pane closes), so handled work stops
  piling up on your lock screen. The service worker also **suppresses** the system notification when a
  Collie tab is already open and visible (the in-app status surfaces it instead).
- **Coalesced into one notification.** The whole herd shares a single notification slot: one agent
  shows the named, deep-linked alert; several collapse into a *"N agents need you"* digest (tap → the
  triage home) that updates in place as agents come and go, instead of stacking N separate alerts.

### Added
- **Do Not Disturb / snooze** (Settings → *Do not disturb*): pause all push for 30m / 1h / 4h, or
  resume early. Server-enforced and self-expiring, so it quiets every device — and it clears whatever
  is already on the lock screen the moment you snooze. The current deadline rides the snapshot, so it
  stays in sync across devices.
- `COLLIE_NOTIFY_DELAY_MS` env var — the push debounce window in ms (default `30000`; `0` notifies on
  the next tick with no debounce).
- `POST /api/notifications/snooze` — set/clear the global snooze (`{ snoozedUntil: number | null }`);
  the active deadline is reported on the snapshot as `notifications.snoozedUntil`.

## [0.1.0] - 2026-06-30

Initial public release of **Collie** — a phone web UI to monitor and reply to your Herdr agent
herd over Tailscale.

### Added
- **Mobile-first PWA** (Vite + React + TypeScript + Tailwind v4 + shadcn): a triage dashboard
  (Spaces overview + Needs-you / Working / Idle agent groups), a per-agent colored terminal mirror,
  an agent-aware slash-command palette (Claude Code, Codex, pi, opencode), a special-keys pad with
  inline arrows/Tab, per-agent brand icons, image upload, and animated view transitions. Installable,
  with an auto-updating service worker and a build-stamp footer.
- **Bun/TypeScript bridge** over Herdr's Unix socket: a polled live snapshot (adaptive cadence,
  gzip + `ETag`/`304`) plus reply / keys / upload endpoints, and space/tab/pane management (create
  shell panes, switch, kill) through a unified nav hub.
- **Runs as a `systemd --user` service** supervised independently of Herdr, with a `tailscale serve`
  launcher (`scripts/collie-ctl.sh`) and a thin Herdr plugin (`herdr.collie`) exposing
  start / stop / restart / status / url / version / update / uninstall actions. One-command update
  (pull → rebuild → restart → re-link) for the linked checkout.
- **Optional Web Push (VAPID) notifications** when an agent needs you, with a custom service-worker
  push handler that renders the real message and deep-links the tap to the agent's pane.
- **Security posture:** loopback-only bind, `tailscale serve` as the sole ingress (never `funnel`),
  a same-origin gate, an optional `COLLIE_TRUSTED_USER` identity check, optional per-device
  authorisation via a trusted upstream header, a strict CSP, and terminal output rendered as React
  text nodes (the XSS boundary).
