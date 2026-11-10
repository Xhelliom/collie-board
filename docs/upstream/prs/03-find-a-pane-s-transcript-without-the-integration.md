# 3. 🟡 Find a pane's transcript without the integration — **fixes History for most users**

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

Probably the highest-value brick here, because it repairs an *upstream* feature that is inert by
default.

| | |
|---|---|
| Commits | `6bce9cc` (`resolveByCwd`) · `7007e29` (`resolveForProcess`, `bridge/proc.ts`, `paneProcess`) · `9fd958e` (the consumer change + the resume fix) · `5182d61` (the client gate) |
| Files | `bridge/transcript.ts`, `bridge/proc.ts`, `bridge/herdr-client.ts`, `bridge/server.ts` (`paneHistory`), `bridge/context.ts` (now shares the resolution), `web/src/components/agent-chat.tsx` (the gate) |
| Extraction | **Needs splitting**, but the pieces are self-contained. `resolveWithoutSession()` is the whole rule in one exported function, and both consumers call it. |

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

**The consumer change is now made** (it was the missing half): `paneHistory()` falls back to the same
resolution when herdr reports no session, so History — and the reading mode of brick 15 — work on a
plain install. Two guards, because resolution is BY DIRECTORY and a wrong transcript is worse than
none: never a shell pane, and never an agent whose adapter doesn't claim a readable transcript format
(upstream has no adapter table; there the check is "is this a Claude pane").

**And a correction to the rule itself, which upstream should take with it.** "The log born closest
after the process started" is wrong for a **resumed** conversation, which in a long-running herd is
most of them. Live case (2026-08-03): a pane's claude started 09:54:48, Claude Code created a log 17 s
later, then resumed a conversation from four days earlier and wrote everything into THAT file. The
startup log died at 31 entries while the real one reached 20 MB — and the "exact" rule served the dead
one: a stale conversation as the pane's history, and **another session's occupancy on the context
gauge** (brick 2 inherits the fix). The rule is now *the log this process has been WRITING to*, with
birth time kept only as the tie-break for a pane that hasn't written yet. What that gives up: two
agents live in one directory, both writing, is a coin flip again — rare when each agent gets its own
worktree, and far less damaging than confidently serving a dead conversation.

---
