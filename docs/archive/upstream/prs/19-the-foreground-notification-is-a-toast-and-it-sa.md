# 19. 🔵 The foreground notification is a toast, and it says which pane

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Brick 18 gave the *missed* ping a home. This one is about the ping that arrives while you are
looking at the app: the service worker suppresses the system banner whenever a Collie tab is visible
(`decidePush` → `suppress`, on the grounds that "the in-app status already surfaces it"), and what
surfaced it was a line in the shared status bar. That bar is latest-wins and shared with every
"Sent ✓" — so a ping landing a second after a send was overwritten before it could be read — and the
line said `claude · webapp`, which is the same sentence for every claude in the herd.

| | |
|---|---|
| Commit | `57d538d` *feat(notify): a ping that lands while you're in the app is a toast you can tap* |
| Files | `web/src/components/agent-toasts.tsx` (new, + test), `web/src/hooks/use-transitions.ts` (returns toasts instead of calling `setStatus`), `web/src/routes/root.tsx` (one mount) |
| Extraction | **Clean cherry-pick**, minus one expression: the detail line prefers the pane's `cardTitle` and falls back to its cwd. Upstream has no cards — drop the `??` and the line is upstream-shaped. |

**Names the pane, not the agent.** `paneDisplayName` — your own pane label, else Claude's `/rename`
session name, else the agent name. Three claudes stop producing three identical notices, and the
name in the toast is the name on the tile you're about to tap.

**Says where.** The herd session (only when it isn't the primary one — that is the one on screen),
the workspace, and the working directory. All read off the snapshot's `AgentView`, so a richer toast
costs no extra fetch.

**Its own channel, not the status line.** Lifecycle pings and action confirmations have different
lifetimes and different worth; one latest-wins slot cannot hold both. The status line keeps every
`setStatus` caller it had.

**Under the header, floating.** The header is how you leave a screen, so a notice that covered the
back chevron and the bell would be the one overlay you can't get past; bottom was already ruled out
upstream (it covers the terminal tail and the composer, which is why the old toasts left it). The
stack is `pointer-events-none` and nothing in the layout moves — the screen stays usable, which is
the property that makes a toast acceptable here at all.

> **Superseded by brick 42's Sonner move.** The pings now go through the app's one Sonner
> `<Toaster/>` (`toast()` with an *Open* action, one id per pane so a blocked→done flip replaces its
> own notice); `agent-toasts.tsx` and its hand-rolled swipe are gone — Sonner stacks, which removes
> the reason for a second channel.

---
