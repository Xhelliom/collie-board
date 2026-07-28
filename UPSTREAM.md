# Upstream posture

Collie Board is a fork of [`AltanS/collie`](https://github.com/AltanS/collie), not a departure from
it. Collie's bridge, security model, PWA and socket adapter are used as-is and are still the
authority on how any of that works. This file records what that means in practice, so the decision
doesn't have to be re-derived from commit archaeology later.

## Keeping rebaseable

The fork's surface against upstream is deliberately narrow. New behaviour lives in NEW files:

```
bridge/db.ts            cards, sessions, reviews, journal (bun:sqlite)
bridge/cards.ts         lifecycle + reconciliation against the snapshot
bridge/board-routes.ts  the whole /api/cards surface
bridge/git.ts           worktree resolution + diff
bridge/context.ts       the context gauge
bridge/handoff.ts       the handoff sequence
bridge/copilot.ts       the copilot
bridge/adapters.ts      per-agent divergence
web/src/lib/board*.ts   the client half
web/src/routes/{board,card}.tsx
web/src/components/{card-tile,card-diff,context-gauge,new-card-sheet}.tsx
```

What was touched in upstream files, and why — this list is the thing to keep short:

| File | Change |
|---|---|
| `bridge/server.ts` | one import + one dispatch block for `/api/cards`, plus `board`/`copilot` in the options |
| `bridge/index.ts` | construct the board, copilot and adapters; three `engine.onUpdate` hooks |
| `bridge/config.ts` | the `board*` config block |
| `bridge/herdr-client.ts` | per-request timeout, and the worktree / agent / metadata methods |
| `bridge/transcript.ts` | `latestUsage()` and `resolveByCwd()` |
| `web/src/lib/api.ts` | `apiRequest` re-export |
| `web/src/router.tsx` | two routes |
| `web/src/routes/home.tsx` | a Board row |

Rebasing means resolving those eight, not the whole tree. Keep it that way: if a change wants to
spread, it usually wants to be a new module with a hook instead.

## What is PR-able, and what isn't

**PR-able** — generic, stateless, in the spirit of a mobile remote control. Each is independently
useful with no card in sight, and each is one commit here:

| Brick | Why it's generic |
|---|---|
| **Context gauge** | Grafted onto `bridge/transcript.ts`, which already exists. The cheapest and most obvious one to offer first. |
| **`$ctx` → `pane.report_metadata`** | ~30 lines, zero coupling, and it makes the gauge visible in herdr's own TUI. |
| **Diff view on the focused pane's `cwd`** | Needs no card. Reading a diff on a phone is missing for everyone. |
| **`launchAgent()` + `promptAndConfirm()`** | Two herdr races, live-verified and fixed once (`agent_pane_busy`, and `agent.prompt` not reliably submitting). Anything that starts an agent hits both. |
| **`resolveByCwd()`** | Herdr reports no `agent_session` without `herdr integration install claude` — which means Collie's own History feature is unavailable by default. This fixes that. |
| **TOML agent adapters** | Benefits anyone driving more than one agent kind. |

**Fork-only** — these change the nature of the project. Collie is deliberately stateless: an
ephemeral, single-operator mirror. Grafting a database onto it is a change of kind, not an
extension, and a refusal would be entirely reasonable. **Never submit these as one PR:** cards, the
board, SQLite, worktree-per-card, session chaining, the copilot.

## Contact

Issue creation is restricted on `AltanS/collie` and there are no Discussions, so the plan of "open an
introduction issue" doesn't work as written. PRs are not restricted. The order that actually works:

1. Land one small, obviously-useful PR (the context gauge is the natural first). An accepted PR opens
   a conversation better than a message does.
2. Then ask the scope question, with working code to point at.

The project is neither young nor quiet (~143★, 19 forks, ~40 issues). The issue restriction is
probably a response to volume. **Do not build the plan around a reply** — fork, build, and treat the
upstream conversation as a bonus.

## Licence

Collie is MIT and this fork stays MIT. `LICENSE` keeps Altan Sarisin's copyright with the fork's
added below it, which is what MIT requires and also just the right thing to do.

Herdr is AGPL, but nothing here links its binary — a socket client is not a derived work.

## Marketplace

The herdr marketplace index reads GitHub repository search, and **GitHub excludes forks from search
results by default**. A true fork may therefore never appear in the listing, even with the
`herdr-plugin` topic. That is the trade:

| Option | Gain | Cost |
|---|---|---|
| **GitHub fork** | trivial PRs, visible lineage | listing uncertain |
| **Fresh repo** | indexed normally | upstream remote added by hand |

Forking is the right call while contributing back and staying rebaseable is the priority. Moving to
a fresh repo later is easy; the reverse is not.

## Open questions

- [ ] Public or private at first.
- [ ] If public: add the `herdr-plugin` topic (auto-indexed, ~30 min refresh, no review).
- [ ] Set `COLLIE_BOARD_UPDATE_REPO` once the fork is published — the release check is opt-in
      precisely because pointing it at upstream would nag about versions this tree isn't.
