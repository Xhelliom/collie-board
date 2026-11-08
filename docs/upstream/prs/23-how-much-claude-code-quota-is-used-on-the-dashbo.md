# 23. 🟡 How much Claude Code quota is used, on the dashboard

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

A herd of Claude sessions burns one shared subscription, and the phone screen that tells you which
agent to look at cannot tell you whether starting another one is affordable. `/usage` knows, and it
is one terminal away — which is the one place a phone is not.

| | |
|---|---|
| Commits | `9cb5d0b` (the gauge) · `0d6816f` (resolve the CLI, PATH is not enough) · `dbf1ba9` (count up, not down) · `e56e817` (one line, then the detail) |
| Files | `bridge/usage.ts` (+ test), `web/src/components/usage-gauge.tsx` (+ test), one route, one line on the dashboard. **In the fork `usage-gauge.tsx` is gone**: the dashboard shows the quota as rings (`home-dashboard.tsx`, fork-only), so cherry-pick the gauge from `e56e817`, not from `main`. |
| Extraction | **Clean cherry-pick.** No card in sight: a subprocess, a regex and a gauge. Only the route's home moves — the fork hangs it off `/api/board/usage` because that prefix is already dispatched; upstream would give it `/api/usage` in `server.ts`. |

**`claude -p "/usage"` prints the panel as plain text in ~1.5 s and spends no model turn** — the
panel is rendered locally. So this is a subprocess and a regex, not an agent request against the
quota it is measuring. The alternatives were checked first and all came up empty:
`~/.claude/stats-cache.json` holds cumulative tokens and no limits (and went five weeks stale on the
machine this was written on); the session transcripts record no limit state; the OAuth endpoint
would mean reading the user's credentials against an undocumented API. See ADR 0009.

**It disappears rather than lie.** No `claude` to be found, a panel that stops looking like this, a
timeout: the endpoint answers `null` and the gauge renders nothing — the context gauge's posture,
for the same reason. The parse is one exported regex with a captured panel in its test.

**Show what's USED, not what's left.** It first rendered the remainder. Correct, and wrong in place:
the context gauge inches away fills with what's consumed, and `/usage` itself says "% used" — so a
right number gets read as a wrong one. Whichever direction upstream picks, both bars must pick it.

**Do not spawn it by name — this cost a release.** A `systemd --user` unit starts with systemd's own
PATH and reads no login shell profile, so `~/.local/bin` isn't on it and `Bun.spawn(["claude", …])`
fails on a machine where the CLI works fine in a terminal. Every other binary the bridge shells out
to (`git`, `gh`, `ps`) lives in `/usr/bin` and so hid the problem. `claudeCandidates()` checks PATH
first, then the install locations — the same shape `resolve_bun()` already uses in the ctl script.
Upstream will meet this the moment it ships any home-installed CLI.

**Cached fifteen minutes, fetched on mount, refreshable by button.** No timer, no poll loop: a
five-hour window does not move fast enough to earn one, and the loader that revalidates every 1.5 s
is exactly the wrong place to hang it.

---
