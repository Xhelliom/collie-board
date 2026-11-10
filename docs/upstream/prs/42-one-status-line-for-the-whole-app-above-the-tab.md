# 42. 🟡 One status line for the whole app, above the tab bar and the composer

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

`setStatus()` is global, but each screen mounted its own `<StatusArea/>` — so a screen that forgot
(settings, here) swallowed its errors, and an error (no TTL) resurfaced on the next screen that did
mount one, far from what failed. The card screen's sat at `bottom-0`, under the mobile tab bar. Now
`root.tsx` mounts the one `<StatusOverlay/>`, pinned above the tab bar; a bottom bar (the composer)
lifts it clear of itself through `useStatusLift()` (a `--status-lift` CSS variable); and a route change
drops a standing error (`clearErrorStatus`). Generic — no card in sight.

| | |
|---|---|
| Commit | *fix(web): une seule ligne de statut, montée dans la racine* |
| Files | `web/src/lib/status.ts`, `web/src/components/status-area.tsx`, `web/src/routes/root.tsx`, `web/src/components/composer.tsx`, the per-screen mounts removed (`home`, `space`, `spaces`, `agent-chat`) |
| Extraction | **Needs extraction** — `prs.tsx`, `card.tsx` and `board.tsx` (the run button's lift) are the fork's. |

> **Then replaced by Sonner, shadcn's toast** — *feat(web): toasts façon shadcn (Sonner), un seul
> empilement en haut*. `setStatus()` is now a façade over `toast()`/`toast.success()`…; the one
> `<Toaster/>` (`components/ui/sonner.tsx`) sits in `root.tsx`, top-center under the header on a
> phone, top-right on desktop, ~356px, three stacked, swipe to dismiss, ✕ on errors (which persist,
> and close on a route change). `StatusArea`/`StatusOverlay`/`useStatusLift` are gone, and so are the
> redundant "Sent" confirmations — the sent message already shows. Generic: a clean upstream PR.

---
