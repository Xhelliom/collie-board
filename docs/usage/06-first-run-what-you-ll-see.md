# First run — what you'll see

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

The transcripts below are the control script's inline output. **Through `invoke start` you get
Herdr's JSON envelope instead** — the same text is the action's *captured stdout*, read with
`herdr plugin log list --plugin herdr.collie-board`.

```console
$ scripts/collie-board-ctl.sh start
building web UI (first run)…                    # linked clone only; a GitHub install already built
…bun install · typecheck · vite build output…
bridge started (systemd --user: collie-board)
tailscale serve (https) → tailnet :443 -> 127.0.0.1:8788

  ✓ Collie is running  ·  v0.71.0+e8b7728
    service   systemd --user (collie-board) · active
    local     http://127.0.0.1:8788
    tailnet   https://myhost.tail1234.ts.net
```

The `✓` is a real probe — the script connected to the bridge's port and got an answer, not just
"the unit is active". If you get `⚠ Collie isn't answering on :8788 yet` instead, see
[Troubleshooting](../../README.md#troubleshooting).

## What just happened

`start` left three durable things on the host:

1. **`web/dist`** — the built UI. The bridge serves it from disk at request time, so later UI
   rebuilds go live without a restart.
2. **A `systemd --user` service named `collie-board`** — unit file written to
   `~/.config/systemd/user/collie-board.service`, enabled and started, auto-restarting on failure.
   Inspect it with `systemctl --user status collie-board`. (No usable systemd? A `nohup` process with a
   pidfile in the config dir instead.)
3. **A tailnet-only `tailscale serve` mapping** — the script ran `tailscale serve --bg 8788`:
   HTTPS on the host's MagicDNS name, `:443 → 127.0.0.1:8788`. Tailscale terminates TLS (managed
   cert, nothing to obtain or renew) and injects the identity header the bridge checks. Inspect
   with `tailscale serve status`; remove just this mapping with `scripts/collie-board-ctl.sh unserve`.

`stop` merely pauses the service; `uninstall` reverses 2 + 3 and keeps your `.env` and the checkout.

## Open it on your phone

The URL is the banner's `tailnet` line (print it again anytime with `scripts/collie-board-ctl.sh url`).
It resolves for any device on your tailnet — so the phone needs the Tailscale app installed and
connected to the same tailnet as the host.

Then install it as an app: **iOS** — Safari → share sheet → *Add to Home Screen*. **Android** —
Chrome → ⋮ menu → *Add to Home screen* (or *Install app*). Installing (and Web Push) needs the
HTTPS origin the default serve mode already provides; over `COLLIE_BOARD_SERVE_MODE=http` the page works,
but service worker and install silently no-op.

## Is it actually working?

A sixty-second check, host side then phone side:

```console
$ scripts/collie-board-ctl.sh status

  ✓ Collie is running  ·  v0.71.0+e8b7728
    service   systemd --user (collie-board) · active
    local     http://127.0.0.1:8788
    tailnet   https://myhost.tail1234.ts.net

  serve config:
    https://myhost.tail1234.ts.net (tailnet only)
    |-- / proxy http://127.0.0.1:8788
```

```console
$ scripts/collie-board-ctl.sh logs        # journal timestamps trimmed here
[push] disabled (no VAPID keys configured)
[bridge] listening on http://127.0.0.1:8788  (poll 1500ms)
[bridge] WARNING: COLLIE_BOARD_TRUSTED_USER is empty — any tailnet device/user that reaches the bridge gets full write access. Set it to your tailnet login (see README → Variant A).
[bridge] WARNING: COLLIE_BOARD_PUBLIC_HOSTS is empty — Host-header validation is OFF (DNS rebinding not blocked). Set it to your MagicDNS name, especially under COLLIE_BOARD_SERVE_MODE=http.
```

**Both WARNINGs are expected on a fresh install** — that's the bridge telling you it's running
open-by-default on your tailnet. [Configure](../../README.md#configure) closes both. (The loopback URL in the log
is also correct: the bridge itself only ever binds `127.0.0.1` — `tailscale serve` is what makes it
reachable.)

On the phone: your agents are listed, and the footer build stamp (`v0.71.0 · e8b7728 · …`) matches
`scripts/collie-board-ctl.sh version`. If the page loads but stays empty, that's the same-origin gate —
see [Troubleshooting](../../README.md#troubleshooting).

## Surviving reboots

A `systemd --user` service only runs while you have a login session. On a host that should serve
Collie unattended, enable lingering once:

```bash
loginctl enable-linger $USER
```

The unit is `enable`d, so with lingering it starts at boot with your user manager; the
`tailscale serve` mapping is persistent (`--bg`) and comes back on its own.
