# Upstream PR ledger

The work in this fork that belongs to [`AltanS/collie`](https://github.com/AltanS/collie) rather
than to the board, with the commits that carry it. Strategy and posture live in
[`UPSTREAM.md`](./UPSTREAM.md); this file is the queue.

**Keep it current.** A brick lands here in the same commit that introduces it — see
[`CLAUDE.md`](./CLAUDE.md) → *The board*. A ledger updated afterwards is a ledger nobody trusts.

> ⚠️ **This repo is a standalone fork, not a GitHub fork object**, so a PR cannot be opened from it
> (GitHub requires the head repo to be a fork of the base). To submit: fork `AltanS/collie` on
> GitHub, add it as a third remote, cherry-pick onto a branch there, open the PR. That is why the
> **Extraction** column below matters — it says whether a brick is one `git cherry-pick` or a
> re-assembly.

Status: 🔵 ready · 🟡 needs extraction · ⚪ not started · 🟢 submitted · ✅ merged

---

## 1. 🔵 `collie-ctl.sh` — three ways `start` breaks on a standard install

**The first PR to offer.** Pure bug fix, no board dependency, hits every user, and it is one commit.

| | |
|---|---|
| Commit | `1952610` *fix(ctl): three ways `start` broke on a completely standard install* |
| Files | `scripts/collie-ctl.sh`, `scripts/collie-ctl.test.sh` |
| Extraction | **Clean cherry-pick.** Only the filename differs (`collie-board-ctl.sh`), so the pick needs `-X rename-threshold` or a manual path fix. |

What it fixes, all live-reproduced:

1. **`start` dies with "bun not found" while `bun --version` works.** Herdr runs plugin actions in a
   non-interactive shell, which sources no `~/.zshrc` — so the `~/.bun/bin` entry bun's own
   installer writes there isn't in scope. Resolution now also checks `$BUN_INSTALL/bin`,
   `~/.bun/bin`, `/usr/local/bin`, `/opt/homebrew/bin`.
2. **`BUN="$(resolve_bun)"` under `set -e`** — a command substitution returning non-zero in an
   assignment kills the script, so a machine with no bun exited silently before reaching the message
   explaining what to do.
3. **`tailscale status --json | bun` under `pipefail`** — the pipeline inherits *tailscale's* exit
   code, so a tailscale that is installed but not connected took the whole script down instead of
   degrading to "unknown".

Plus: the `serve` failure now reports what tailscale actually said. It used to blame a missing
certificate unconditionally, which sends someone hitting the `--operator` permission to exactly the
wrong fix.

---

## 2. 🟡 Context gauge, and `$ctx` in herdr's own sidebar

The cheapest genuinely-new capability, and it grafts onto a file that already exists.

| | |
|---|---|
| Commits | `6bce9cc` (the gauge, `latestUsage`, `pane.report_metadata`) · `c0bca59` (adapter gating) |
| Files | `bridge/transcript.ts` (`latestUsage`), `bridge/context.ts`, `bridge/herdr-client.ts` (`reportPaneMetadata`), `web/src/components/context-gauge.tsx` |
| Extraction | **Needs splitting.** `6bce9cc` also carries the card diff and board wiring. Take `latestUsage()` + `context.ts` + the client method; `ContextTracker` currently walks the board's sessions and would need to walk agent panes instead. |

`latestUsage()` sums `input + cache_creation + cache_read` of the newest **non-sidechain** assistant
turn — both filters load-bearing: a subagent's small window makes a full session read as empty, and
taking the largest rather than the newest would pin the gauge at the pre-`/compact` figure forever.

Pushing it back with `pane.report_metadata` renders it as `$ctx` in herdr's Agents sidebar, so the
number is visible in the TUI, not only in the phone app. ~30 lines, zero coupling.

**Needs a context-window size** (`COLLIE_BOARD_CTX_WINDOW`); herdr doesn't know it and the transcript
doesn't state it.

---

## 3. 🟡 Find a pane's transcript without the integration — **fixes History for most users**

Probably the highest-value brick here, because it repairs an *upstream* feature that is inert by
default.

| | |
|---|---|
| Commits | `6bce9cc` (`resolveByCwd`) · `7007e29` (`resolveForProcess`, `bridge/proc.ts`, `paneProcess`) |
| Files | `bridge/transcript.ts`, `bridge/proc.ts`, `bridge/herdr-client.ts` |
| Extraction | **Needs splitting**, but the pieces are self-contained. The consumer change is `paneHistory()` in `server.ts`, which currently requires `pane.agentSessionId`. |

Herdr reports `agent_session` **only** once `herdr integration install claude` has planted its hook.
A plain install has none — verified live: not one agent pane in a four-agent herd carried it. So
Collie's own pane History answers `no-session` for anyone who hasn't run that command, and the
History affordance is never even rendered (`agent-chat.tsx` gates on `agentSessionId`).

Two resolutions, in order:

- `resolveForProcess(cwd, startedAt)` — `pane.process_info` gives the pane's foreground PID,
  `/proc/<pid>/stat` its start time, and the log born closest after it is that process's. Measured
  gap: 7 s. Exact even with two agents live in one directory.
- `resolveByCwd(cwd)` — newest log in the mangled project directory. The fallback when neither start
  time nor birth times are available.

Both platforms Collie targets are covered: `/proc/<pid>/stat` on Linux, `ps -o etime=` on macOS
(`lstart` is locale-dependent — it prints "mar. juil. 28 …" on a French machine). Verified against
each other on one process: 1.3 s apart. Windows has neither and falls back.

A wrong `USER_HZ` can only push the computed start into the future, which the guard rejects → the
fallback answers. It cannot produce a wrong-but-plausible file.

---

## 4. 🟡 Two herdr races every agent launcher hits

Not a feature — three findings that are simply true of herdr 0.7.5, packaged as helpers.

| | |
|---|---|
| Commits | `dcf7f37` (`launchAgent`, `agent_pane_busy` retry, readiness poll) · `09fb97a` (`promptAndConfirm` re-send) |
| Files | `bridge/cards.ts` (the four exported helpers) |
| Extraction | **Needs splitting** — both commits also carry board logic. The helpers themselves have no board dependency. |

1. **`agent.start` does not wait.** The CLI help says success means the agent "is ready for input",
   but that is the CLI polling afterwards: the socket method returns in ~2 ms with
   `agent_status: "unknown"` and `launch_pending: true`. Poll `agent.get` for `interactive_ready`.
2. **`agent.start` right after `worktree.create`** fails `agent_pane_busy` while the pane's shell is
   still sourcing its rc. Retry on that code, and only that code.
3. **`agent.prompt` does not reliably deliver.** A multi-line prompt lands as `[Pasted text #N]` and
   sits there; and Claude Code's first-run trust dialog eats the prompt whole while herdr reports
   `interactive_ready: true`. Read the state back and look — the rule Collie already applies to
   replies in `web/src/lib/reply-action.ts`.

Collie doesn't launch agents today, so this is only useful to upstream **if** it ever does. Offer it
as documentation of the socket's real behaviour if not as code — `HERDR_API.md` is the natural home.

---

## 5. 🔵 Wrap the pane mirror by default on a phone

Tiny, one file, and it fixes the primary screen of a phone-first app.

| | |
|---|---|
| Commit | `9fa4248` *fix(web): wrap the mirror by default on a phone* |
| Files | `web/src/hooks/use-display-prefs.ts` |
| Extraction | **Clean cherry-pick.** |

`DEFAULTS.wrap` is `false`, so the mirror pans horizontally out of the box. Measured on a real herd:
panes run a **median of 81 columns and a max of 233**, while a phone shows about 50 at 12px
monospace — so most lines run off the edge, on the one screen Collie exists for.

Not wrap-always: the no-wrap default is *right* on a wide screen, where preserving column alignment
is what makes a TUI's boxes and tables readable at all. So the default follows the viewport
(`wrapDefaultFor`, < 640px = the app's own `max-w-screen-sm`), and the instant the user touches the
existing toggle their choice is stored and wins forever. Nothing else changes.

---

## 6. 🔵 The frontend test suite is broken by Node 24+

The smallest brick here and the most annoying to diagnose, which is exactly why it is worth sending.

| | |
|---|---|
| Commit | `e52a993` *feat(board): a split makes real cards…* (the fix is the one file below) |
| Files | `web/src/test/setup.ts` |
| Extraction | **Clean cherry-pick.** |

Node 24+ defines its own `localStorage` global that stays **undefined** unless the process was
started with `--localstorage-file`, and it takes precedence over the one jsdom installs. So
`localStorage.clear()` in a `beforeEach` throws, and every display-preference test fails — here, 17
of them — on the day the machine's Node is upgraded, with nothing in the repository having changed
and nothing in the error naming Node as the cause.

Reproduced on Node v26.5.0, vitest 4.1.9, `environment: "jsdom"`. The fix installs a Map-backed
`Storage` when the global is missing, next to the existing `matchMedia` / `scrollIntoView` gap-fills.
Inert on a Node that behaves.

---

## 7. ⚪ Diff view on the focused pane's `cwd`

| | |
|---|---|
| Commit | `6bce9cc` |
| Files | `bridge/git.ts`, `web/src/components/card-diff.tsx` |
| Extraction | **Needs splitting and rewriting.** `git.ts` is scoped by a card's branch; upstream would scope it by the focused pane's `cwd` + its current branch. The parsers (`parseNumstat`, `parseUntracked`, `isSafeDiffPath`) transfer as-is. |

Reading a diff on a phone is missing for everyone, and needs no card. Worth noting the two choices:
diff the **working tree** against the merge base (agents routinely leave nothing committed, so
`base...HEAD` reads empty), and list untracked files separately (`git diff` cannot see them, and a
new file is the most common thing an agent produces).

Check `persiyanov/herdr-reviewr` before proposing — it may already cover this.

---

## 8. ⚪ TOML agent adapters

| | |
|---|---|
| Commit | `c0bca59` |
| Files | `bridge/adapters.ts`, `adapters/agents.toml` |
| Extraction | **Nearly clean.** The module has no board dependency; only its consumers do. |

Four fields — launch kind, context-reset command, whether the transcript is readable, whether a
native session id is reported — merged **per field** from a user file. Only useful to upstream
alongside brick 2 or 4; on its own it configures nothing.

---

## Never offer as one PR

Cards, the board, SQLite, worktree-per-card, session chaining, the copilot. Collie is deliberately
stateless — an ephemeral, single-operator mirror. Grafting a database onto it is a change of kind,
not an extension, and a refusal would be entirely reasonable.
