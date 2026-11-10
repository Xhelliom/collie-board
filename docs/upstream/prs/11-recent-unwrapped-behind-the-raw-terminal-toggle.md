# 11. 🔵 `recent_unwrapped` behind the raw-terminal toggle (+ the wire name is snake_case)

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `06c1b56` *feat(board): the un-wrapped read source, behind the raw-terminal toggle* |
| Files | `bridge/server.ts`, `bridge/herdr-client.ts`, `web/src/lib/{api,loaders}.ts`, `web/src/hooks/use-display-prefs.ts`, `web/src/components/agent-chat.tsx`, `HERDR_API.md` |
| Extraction | **Clean cherry-pick.** Every file is upstream's; no card is in sight. |

Two things, one of them a plain bug. **The bug:** `ReadSource` declared `"recent-unwrapped"`, which
herdr's socket rejects — the wire name is `recent_unwrapped`, snake_case, even though the CLI
advertises the hyphen in `--source`. The value was unreachable, so the typo had never fired; anyone
who reached for it would have got `invalid_request` on every read. Fixed, and `HERDR_API.md`
corrected (it documented the hyphen too, and was missing `detection`).

**The feature:** `/api/pane/:id?unwrapped=1` reads that source, and `paneLoader` asks for it only
while the raw-terminal pref is on. That pref already bypasses every Claude grammar, so it is the one
mode where dropping the terminal's fixed-width lines can't blind a box-drawing detector; the two
grammar callers (`reply-action`'s verify-before-submit and `harness/guard`) keep reading the wrapped
source through the same `fetchPane`, deliberately. A boolean flag rather than a free-form `source=`,
so a client can't ask for an arbitrary one.

Measured on live panes before shipping (herdr 0.7.x, 236-column host): on **Claude** panes it changes
nothing at all — 129 → 129 lines, zero lines over the terminal width, because Claude's TUI wraps its
own output before the PTY ever sees it. On a **shell** pane it is real: 599 → 501 lines, 96 logical
lines over 236 columns. Upstream gets the honest version of the knob plus the numbers to judge it by.

---
