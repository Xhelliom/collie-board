# 2. 🟡 Context gauge, and `$ctx` in herdr's own sidebar

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

The cheapest genuinely-new capability, and it grafts onto a file that already exists.

| | |
|---|---|
| Commits | `6bce9cc` (the gauge, `latestUsage`, `pane.report_metadata`) · `c0bca59` (adapter gating) · `106b723` (walks agent panes, figure held in memory) |
| Files | `bridge/transcript.ts` (`latestUsage`), `bridge/context.ts`, `bridge/herdr-client.ts` (`reportPaneMetadata`), `web/src/components/context-gauge.tsx` |
| Extraction | **Needs splitting.** `6bce9cc` also carries the card diff and board wiring. Take `latestUsage()` + `context.ts` + the client method. `106b723` removed the one card coupling that stood in the way: `ContextTracker` now walks the snapshot's agent panes and holds the figure in memory, so the board arguments are droppable and the gauge works with no card in sight. |

`latestUsage()` sums `input + cache_creation + cache_read` of the newest **non-sidechain** assistant
turn — both filters load-bearing: a subagent's small window makes a full session read as empty, and
taking the largest rather than the newest would pin the gauge at the pre-`/compact` figure forever.

Pushing it back with `pane.report_metadata` renders it as `$ctx` in herdr's Agents sidebar, so the
number is visible in the TUI, not only in the phone app. ~30 lines, zero coupling.

**Needs a context-window size** (`COLLIE_BOARD_CTX_WINDOW`); herdr doesn't know it and the transcript
doesn't state it.

**Cost, measured** (378 logs, 0.3–18 MB): median 10–23 ms per pane per 30 s refresh, worst 110 ms on
an 18 MB log — ~1 % of one core for a twelve-agent herd. Worth stating in the PR: it reads every live
agent's transcript, throttled per pane, on the existing poll rather than a timer of its own.

---
