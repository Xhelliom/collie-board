# 3. Deployment model — **systemd user service, not a plugin pane**

**Statut :** ✅ décidé — architecture en place, pièges vérifiés

Partie de [`ARCHITECTURE.md`](../../ARCHITECTURE.md), qui en est le sommaire.

This is the clearest call in the design. A plugin **pane** runs inside a terminal pane: if the pane
closes, the user detaches, or Herdr restarts, the bridge dies — exactly when you're on mobile and not
watching the TUI. A long-lived network daemon must be supervised independently.

- **The bridge runs as a `systemd --user` service** (launchd agent on macOS) — starts at login,
  restarts on failure, survives Herdr restarts. **On Windows it is a scheduled task** at the user's
  logon, in their session, never elevated, running `scripts/ctl.ts _run` — a supervisor that
  restarts the bridge 5 s after it dies. Never a Windows service: session 0 has no desktop
  ([ADR 0046 §7](../../.adr/0046-multi-machine-un-collie-central-et-des-noeuds.md)).
- **Every action that runs on Windows is `bun scripts/ctl.ts <id>`, on every platform** — Herdr
  allows one command per action id ([ADR 0050](../../.adr/0050-every-action-runs-ctl-ts-because-herdr-allows-one-command-per-id.md)).
  ctl.ts hands the command to `collie-board-ctl.sh` on Linux/macOS and runs it itself on Windows.
- **The Herdr plugin stays — as a thin registration/launcher,** so the bridge shows up in
  `herdr plugin list` and Herdr conventions still apply. Its `[[actions]]` do things like
  `systemctl --user start collie-board` and **print the tailnet URL**; they do *not* host the server. A
  `[[build]]` step builds the web UI on `herdr plugin install` (GitHub); local `link` installs skip
  it and build lazily on first `start`. Concretely that's `[[actions]]` + `[[build]]` and nothing
  else: `[[panes]]` is what this section argues against, and `[[events]]` would duplicate the
  bridge's own `events.subscribe` stream (§5).
- **Socket-path discovery:** a non-Herdr-launched daemon won't get `$HERDR_SOCKET_PATH` injected, so
  it resolves the path from a well-known location (`~/.config/herdr/herdr.sock` default, or the
  bridge's own config) and re-resolves on reconnect in case it moves.
