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
| `web/src/lib/api.ts` | `apiRequest` re-export; `ApiError` exported so a custom fetch can raise one |
| `web/src/router.tsx` | two routes |
| `web/src/routes/home.tsx` | a Board row |
| `web/src/hooks/use-display-prefs.ts` | wrap defaults ON below 640px (`wrapDefaultFor`) |
| `web/src/test/setup.ts` | put `localStorage` back when Node 24+ shadows jsdom's |

Rebasing means resolving those nine, not the whole tree. Keep it that way: if a change wants to
spread, it usually wants to be a new module with a hook instead. The last two are pure bug fixes
that belong upstream — they are in the ledger, and once merged they leave this list again.

## What is PR-able, and what isn't

**PR-able** — generic, stateless, in the spirit of a mobile remote control. The list, with the
commits that carry each brick and whether it is a clean cherry-pick, is maintained in
**[`UPSTREAM_PRS.md`](./UPSTREAM_PRS.md)**. Start with the `collie-ctl.sh` fixes: one commit, pure
bug fix, hits every user.

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

## Marketplace — decided

**Decision (2026-07-28): a real GitHub fork**, [`Xhelliom/collie-board`](https://github.com/Xhelliom/collie-board),
public. Contributing back won over discoverability, because **GitHub only accepts a pull request
whose head repository is a fork of the base** — from a standalone repo, every brick in the PR-able
list above would need a second repo and a cherry-pick before it could even be offered. The whole
upstream strategy hangs on that one mechanic, so it decided the question.

The cost, and it is real: the herdr marketplace index reads GitHub repository search, and **GitHub
excludes forks from search results by default**. This repo may therefore never appear in the
listing, even with the `herdr-plugin` topic. If that turns out to matter more than expected, a
standalone mirror can be pushed alongside later — the reverse (turning a plain repo into a fork) is
not possible at all, which is the other half of why this way round is the safer bet.

| Option | Gain | Cost |
|---|---|---|
| **GitHub fork** ← chosen | PRs upstream are trivial; lineage visible | listing uncertain |
| Standalone repo | indexed normally | no PR to upstream without a second repo |

## Open questions

- [x] Public or private at first → **public**, 2026-07-28.
- [x] Fork vs standalone → **fork** (above).
- [ ] Confirm whether the `herdr-plugin` topic gets the fork listed anyway (~30 min refresh). If
      not, decide whether a standalone mirror is worth maintaining.
- [ ] Set `COLLIE_BOARD_UPDATE_REPO=Xhelliom/collie-board` in the plugin `.env` so the in-app update
      banner works. It is opt-in precisely because pointing it at upstream would nag about versions
      this tree isn't.
