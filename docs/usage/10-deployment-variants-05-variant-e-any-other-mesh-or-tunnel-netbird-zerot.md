# Variant E — any other mesh or tunnel (NetBird, ZeroTier, Cloudflare Tunnel)

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Tailscale is the **default**, not a requirement. Collie's own Tailscale coupling is one header read
and a convenience in `collie-board-ctl.sh`; the bridge itself is a loopback HTTP server that gates on
`Host`, `Origin`, and two optional headers. Anything that can reach `127.0.0.1:$COLLIE_BOARD_PORT` can
front it.

Collie deliberately **manages** only one front door — the one this project runs and tests. For every
other tunnel you own the ingress and Collie stays out of the way:

```bash
COLLIE_BOARD_SKIP_SERVE=1                                 # never run tailscale serve
COLLIE_BOARD_PUBLIC_HOSTS=collie.example.com              # exact public host — blocks DNS rebinding
COLLIE_BOARD_ALLOWED_ORIGINS=https://collie.example.com   # exact public origin for the same-origin gate
```

Then point your tunnel at `127.0.0.1:$COLLIE_BOARD_PORT` and start it however you start your other
services. `netbird expose 8788`, a ZeroTier-routed reverse proxy and `cloudflared tunnel` all work
this way. `collie-board-ctl.sh start` will build, launch and supervise the bridge and publish nothing;
`unserve` and `uninstall` likewise leave your tunnel alone, exactly as under
[Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md).

Three things to get right, none of them Collie-specific:

1. **The [Variant B](10-deployment-variants-02-variant-b-identity-aware-proxy-per-device-author.md) proxy requirements
   apply verbatim.** Loopback upstream, the public `Host` forwarded unchanged (or listed in
   `COLLIE_BOARD_ALLOWED_ORIGINS`), and — if you use the device gate — the identity header **overridden**
   on every request, never merely added.
2. **`COLLIE_BOARD_TRUSTED_USER` does nothing here**, for the reason it does nothing behind a reverse proxy
   ([Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md)): nothing injects
   `Tailscale-User-Login`, so the check passes every request rather than blocking it, and the bridge
   warns about that at startup. If your tunnel authenticates and injects a device identity, use
   `COLLIE_BOARD_DEVICE_HEADER` + `COLLIE_BOARD_DEVICE_ALLOWLIST` instead; if it authenticates but injects
   nothing, its own auth *is* the whole gate and anyone who passes it gets full Collie access.
3. **Pin a stable hostname before you install the PWA.** A service-worker cache is per-origin, and
   several tunnels hand out a fresh generated name per session. A name that changes gives you a new
   install each time and makes `COLLIE_BOARD_PUBLIC_HOSTS` unpinnable.

> ⚠️ **Anything that publishes to the open internet is a `funnel` by another name.** The rule in
> [Security](../../README.md#%EF%B8%8F-security--read-before-you-run-it) isn't about Tailscale, it's about
> reachability: this socket is a shell running as you. If your tunnel offers a public URL, the auth
> in front of it is the only thing between a stranger and that shell, so treat a shared PIN the way
> you'd treat a root password — and prefer a tunnel scoped to your own devices over a public URL
> with a gate on it.
