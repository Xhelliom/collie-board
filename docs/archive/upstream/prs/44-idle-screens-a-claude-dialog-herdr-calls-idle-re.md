# 44. 🟡 Idle screens — a Claude dialog herdr calls `idle` reads `blocked`

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Claude Code 2.1.319's « Teach auto mode about your environment? » (`Yes` / `Not now` / `Don't show
again`) holds the agent while herdr says `idle`: no alert, no dot, nobody told. The engine reads the
pane at its passage to idle (the read it already makes for `/rename`), and a tail ending on a known
title turns that `idle` into `blocked` from the next poll — re-read each poll until it goes. The web
grammar lifts the same dialog into buttons (« Not now » = Down, Enter). Generic — no card in sight.

| | |
|---|---|
| Commit | *feat: carte distante — écran « Teach auto mode » bloquant, arrêt sans PR signalé, PR rattachée* |
| Files | `web/src/lib/harness/claude/holding-screens.ts` (new), `markers.ts` (`namesTrustDialog`), `bridge/state-engine.ts` (`heldByScreen`), fixture `claude--v2319-teach-auto-mode.txt` (+ tests) |
| Extraction | **Needs extraction**: the same commit carries the board's remote-card half (`bridge/remote-idle.ts`, `peer-herd.ts`, `remote-launch.ts`); take the four files above. |

---
