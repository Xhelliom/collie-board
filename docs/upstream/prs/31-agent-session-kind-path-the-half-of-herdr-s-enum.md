# 31. 🔵 `agent_session.kind === "path"` — the half of herdr's enum Collie drops

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `55089e4` *feat(transcript): un pane dont la session est un CHEMIN a son historique* |
| Files | `bridge/state-engine.ts`, `bridge/types.ts`, `bridge/transcript.ts` (`confinedSessionPath`), `bridge/server.ts` (`paneHistory`) |
| Extraction | **Clean cherry-pick**, four small hunks, none board-aware. The one fork-specific line is the adapter guard in `paneHistory` — upstream's equivalent check there is "is this a Claude pane". |

Herdr's `AgentSessionRefKind` is the enum `["id","path"]` and `herdr pane report-agent` exposes both
(`--agent-session-id` / `--agent-session-path`). Collie kept only `"id"`, so an agent whose
integration reports a PATH had its pane↔transcript link dropped without a word and fell through to
the by-cwd resolution of brick 3 — which is exactly the resolution that cannot serve it: an agent
reports a path precisely when its sessions aren't filed by cwd. A Codex rollout is
`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, filed by DATE, with the cwd buried inside
the file.

The fix is the cheapest kind: carry the value to `pageAt()`, which already exists and already takes a
path. `confinedSessionPath()` is the only new code — realpath on both sides then containment, the same
rule as `contained()` and gallery's `resolveImage()`, rooted at the home directory because no such
session lives under `~/.claude/projects`. The value comes from herdr and never from a client; the
containment is the belt for a misreporting integration, and a refusal is logged so a session store
moved out of home (`CODEX_HOME`) doesn't make the feature quietly inert.

**Plumbing, not format.** `parseTranscript` still requires Claude Code's row shape, so a Codex rollout
reached this way pages as an empty transcript. That is a second, larger brick (a row adapter — see
`AGENT_COMPAT.md` §4); this one just stops the link being thrown away before anything can use it.

---
