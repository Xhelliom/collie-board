# 4. 🟡 Two herdr races every agent launcher hits

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

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
