# Architecture

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

A small Bun process sits between your phone and Herdr — the browser never touches the socket.

```
  phone (PWA)
     │  HTTPS over the tailnet
     ▼
  tailscale serve        terminates TLS, injects the identity header
     │  127.0.0.1:PORT    (the bridge binds loopback only)
     ▼
  Collie bridge (Bun)    serves the UI + a small JSON API; polls Herdr
     │                   ├─ bun:sqlite   the cards (durable)
     │                   └─ git(1)       worktree + diff + merge, argv never a shell
     │  one-shot JSON-RPC over a Unix socket
     ▼
  Herdr server           owns the panes, agents and terminal state
```

Under [Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md) a reverse proxy
replaces the `tailscale serve` box; everything below the front door is identical.

- **One module touches the socket** (`bridge/mux/herdr09.ts`, behind `bridge/mux/mux.ts`); everything else speaks the bridge's HTTP API.
- **Polling is still the model** — the bridge polls Herdr (via `session.snapshot`, one RPC per tick) and the browser polls `/api/snapshot`; a long-lived Herdr event stream only pokes the bridge's poll to go faster, it never replaces it. No resync logic.
- **The board adds no second loop.** Card reconciliation, the context gauge, handoff and wrap-up completion and the copilot's review trigger are all `engine.onUpdate` hooks on that same poll. There is no second source of truth and nothing to resync.
- **The database holds intent, never runtime.** A card's status, cwd and agent are read from the snapshot on every request; SQLite keeps the cards, their session chain, the reviews and an append-only journal. A `disconnected` snapshot is ignored everywhere, so a socket blip can't orphan the whole board.
- **Actions are plain HTTP** — a reply or key `POST`s to `/api/pane/:id/{reply,keys}` → Herdr `pane.send_keys`, which types into a real terminal (hence the security posture). Board writes go through the same `guard()`, because starting a card ends up being exactly that.
- **`bridge/git.ts` is the only place the bridge shells out** — argv elements, never a shell; the one client-supplied path is validated and always follows `--`.
- **The UI is a static PWA** — Vite builds `web/dist`, served from disk, so a rebuild is live with no restart.

Full design rationale in [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — the board is §9. Decisions that
close off an option someone will reasonably propose again live in [`.adr/`](../../.adr/).
