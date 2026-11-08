# Architecture — Collie (a Herdr web bridge over Tailscale)

> **Fork note.** This document is upstream Collie's and still describes the bridge accurately —
> the deployment model, the interaction loop and especially §6's security posture are unchanged and
> remain load-bearing. What Collie Board adds sits on top of it and is described in §9; the fork's
> posture toward upstream is in [`UPSTREAM.md`](UPSTREAM.md).

> **Why Collie is shaped the way it is.** The deployment model, the interaction loop, and especially
> the security posture — the reasoning the code can't state itself. This describes what is built; a
> few deliberate *non*-decisions are called out as such, and §8 parks ideas that are not built on
> purpose. For how to run it see [`README.md`](README.md); for repo conventions
> [`CLAUDE.md`](CLAUDE.md); for the verified socket contract [`HERDR_API.md`](HERDR_API.md).

## 1. The problem (real workflow, real pain)

The route Collie replaces: **Termux on Android → SSH into a tailnet machine → run the Herdr TUI.**
Three pains:

1. The on-screen **terminal keyboard is terrible** to type on.
2. **No voice control** in a terminal.
3. **Re-SSHing / re-logging-in every time** is tedious.

The goal: a **mobile web interface, reachable over Tailscale, that you don't have to keep logging
into** — so you can check on and steer your agent herd from a phone with the native keyboard and
voice, no SSH.

## 2. What Collie is

A Herdr web bridge — a long-lived local process that

- connects to Herdr's Unix-socket API (`$HERDR_SOCKET_PATH`),
- serves a **mobile-first web app**, with live state polled over HTTP (see §5),
- translates browser actions → socket methods,
- sits behind **one hardened front door** — `tailscale serve` (default; tailnet-only HTTPS +
  MagicDNS) or a conforming reverse proxy
  ([README → Variant C](README.md#variant-c--reverse-proxy-as-the-only-front-door-no-tailscale)) —
  installable as a **PWA**.

The browser never touches the socket directly; the bridge is the only thing that does.

```
   phone / laptop (PWA)
        │  HTTPS over tailnet  (https://herd.<tailnet>.ts.net)
        ▼
   tailscale serve  ── injects identity headers, terminates TLS   (Variant C: a reverse proxy instead)
        │  127.0.0.1:PORT   (bridge binds loopback ONLY)
        ▼
   Collie (this project)
     • static web app + small JSON API (browser polls /api/snapshot)
     • mux adapter, bridge/mux/herdr09.ts (the ONLY code that knows socket method names)
     • snapshot poll, event-poked (see §5)
        │  newline-delimited JSON over Unix socket
        ▼
   Herdr server (owns panes, agents, state)
```

## 3. Deployment model — **systemd user service, not a plugin pane**

→ [`docs/architecture/03-deployment-model-systemd-user-service-not-a-plug.md`](docs/architecture/03-deployment-model-systemd-user-service-not-a-plug.md)

## 4. The core interaction loop

→ [`docs/architecture/04-the-core-interaction-loop.md`](docs/architecture/04-the-core-interaction-loop.md)

## 5. Architecture notes

→ [`docs/architecture/05-architecture-notes.md`](docs/architecture/05-architecture-notes.md)

## 6. Security model

→ [`docs/architecture/06-security-model.md`](docs/architecture/06-security-model.md)

## 7. Tailscale & PWA

- `tailscale serve` → tailnet-only HTTPS on a stable MagicDNS hostname; the node cert doesn't rotate,
  so the PWA stays signed in. No credential management, no login screen.
- Install as a PWA (Add to Home Screen) → app icon, instant open, persistent.
- Known failure mode (accept, don't engineer around): if `tailscaled` is down, the bridge is reachable
  on localhost but not via MagicDNS. On **Android specifically**, the OS backgrounds Tailscale
  aggressively — a notification tap may hit the app before the tunnel is up, and you wait. The
  intended mitigation (the agent's question in the notification body, so the tap is at least
  informative) is the gap noted at the end of §4.

## 8. Future ideas

Not planned, not scheduled — a parking lot for ideas surfaced while reading Herdr's socket surface,
so they don't get re-discovered from scratch or acted on by accident.

- **`herdr terminal session observe` / `control` (new in 0.7.2).** A CLI subcommand pair that streams
  a pane as NDJSON live ANSI frames — `observe` is read-only; `control` additionally accepts stdin
  commands (`terminal.input`, `terminal.resize`, `terminal.scroll`, `terminal.release`) with
  one-controller-at-a-time semantics (`--takeover` to steal control). A bridge process could spawn
  either as a child and get a true live pane mirror, or even a full interactive terminal, instead of
  polled snapshots. **But raw ANSI frames need a real terminal emulator to render** (cursor movement,
  screen clears, scroll regions — well beyond the current SGR-color-only parser, see
  [`HERDR_API.md`](HERDR_API.md)), and rendering that faithfully in the browser would breach §6's
  "pane output is React text nodes only" XSS boundary. Adopt this deliberately, with a real
  terminal-emulator library and a re-examined threat model — or not at all. This is the designated
  parking spot for that idea; don't half-do it.


## 9. The board (this fork)

→ [`docs/architecture/09-the-board-this-fork.md`](docs/architecture/09-the-board-this-fork.md)
