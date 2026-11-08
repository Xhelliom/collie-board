# herdr-core (hc) — the default engine for new launches

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Collie Board reads **two engines at once**: herdr 0.9 (the plugin host above) and
[herdr-core](../../HERDR_CORE_API.md) (`hc`, the engine behind **herdr-app**). Every pane stays on the
engine it was born on; only a **new** launch picks one. By default (`COLLIE_BOARD_MUX=auto`) that is
**hc whenever its core answers**, and herdr 0.9 otherwise — the card's Start button then says
*"herdr-core (hc) is not answering: this launch will run under herdr 0.9."*. Pin one engine with
`COLLIE_BOARD_MUX=hc` or `COLLIE_BOARD_MUX=herdr09`
([ADR 0052](../../.adr/0052-collie-v2-sur-herdr-core.md) §4.2). An agent already running under 0.9 moves
over with the card's **Migrate to herdr-core** button, offered whenever hc answers.

> **Start the core from herdr-app or your desktop session — never from an agent.** The core hands its
> own environment to every terminal it starts. Started from a Claude Code pane, it passes on
> `CLAUDE_CODE_CHILD_SESSION`: every Claude it launches then **writes no transcript** (no history, no
> context gauge, no resume, no migration) and inherits a stale `HERDR_PANE_ID`. The bridge never
> starts it either: it only dials the socket and falls back to 0.9 when nobody answers.

**Linux**

1. Install herdr-app (it installs herdr-core with it) from [herdr.dev](https://herdr.dev); you get
   `herdr-app`, `hc` and `herdr-core` in `~/.local/bin`.
2. Start the core **from your desktop**: open herdr-app, or add `hc server start` to your desktop
   session's autostart (a `~/.config/autostart/*.desktop` entry). Not from a Herdr pane running an agent.
3. Check: `hc server status` from a plain terminal, then the Start button of a card no longer shows
   the 0.9 notice. The socket is `$XDG_RUNTIME_DIR/herdr-core/default.sock`; override with
   `COLLIE_BOARD_HC_SOCKET`.

**Windows**

1. Install, in PowerShell: `irm https://releases.herdr.dev/app/install.ps1 | iex` (herdr-app, then
   herdr-core if absent; needs Windows 10 1803+ and Git for Windows for `sh`).
2. Start the core **in your desktop session**: open herdr-app, or run `hc server start` in a normal
   desktop terminal (not over SSH, not from an agent). On Windows `hc server status` never starts one.
3. Check: `hc server status`. The bridge dials `\\.\pipe\herdr-core-<USERNAME>-default.sock`
   (measured); override with `COLLIE_BOARD_HC_SOCKET`.

The Herdr plugin (`herdr-plugin.toml`) and its actions stay as they are while herdr 0.9 is supported
— install, start and update still go through them.
