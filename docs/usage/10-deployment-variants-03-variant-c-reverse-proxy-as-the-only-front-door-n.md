# Variant C — reverse proxy as the only front door (no Tailscale)

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

A reverse proxy (Caddy, Nginx, …) is the **sole ingress** — no Tailscale in the path. Choose this
when the host isn't on a tailnet, or when you already run a TLS-terminating proxy with its own access
control (SSO, mTLS, a VPN gateway) and want Collie behind it like any other upstream.

Set `COLLIE_BOARD_SKIP_SERVE=1` so `collie-board-ctl.sh start` builds, starts and supervises the bridge but
**never touches `tailscale serve`** — the proxy owns ingress. The bridge still binds loopback only;
your proxy reaches it on `127.0.0.1:$COLLIE_BOARD_PORT`.

The **four proxy requirements from
[Variant B](10-deployment-variants-02-variant-b-identity-aware-proxy-per-device-author.md) apply verbatim** — the proxy
*is* the identity-aware front door here. A minimal Caddy front door:

```caddyfile
collie.example.com {
    # TLS is automatic (Let's Encrypt). Put YOUR access control here
    # (forward_auth / mTLS / SSO) — it also yields the per-device id below.
    reverse_proxy 127.0.0.1:8788 {
        header_up X-Device-Id {your_device_id}   # SET from your auth — overrides any client-supplied copy
        header_up Host {host}                     # forward the public Host → same-origin gate passes
    }
}
```

Required env (`.env`):

```bash
COLLIE_BOARD_SKIP_SERVE=1                                 # proxy is ingress; never run tailscale serve
COLLIE_BOARD_PUBLIC_HOSTS=collie.example.com              # Host allowlist — blocks DNS rebinding
COLLIE_BOARD_ALLOWED_ORIGINS=https://collie.example.com   # exact public origin for the same-origin gate
COLLIE_BOARD_DEVICE_HEADER=X-Device-Id                    # the header your proxy injects…
COLLIE_BOARD_DEVICE_ALLOWLIST=my-phone,my-laptop          # …and the ids allowed to drive; others → read-only
# COLLIE_BOARD_PUBLIC_URL=https://collie.example.com      # optional — shown in the collie-board-ctl.sh status banner
```

> ⚠️ **`COLLIE_BOARD_TRUSTED_USER` does nothing here.** It gates on `Tailscale-User-Login`, which only
> `tailscale serve` injects — with no Tailscale in the path there is no injector, so the check has
> nothing to compare against and every request passes it. It fails *open*, not closed, and the bridge
> logs a startup warning saying so. **Per-device auth (`COLLIE_BOARD_DEVICE_HEADER`) is the write gate**,
> and the **proxy must provide TLS and its own access control** — anyone who reaches the proxy gets
> read access to every pane. Give the proxy the same respect you'd give the tailnet.

**Caching: respect the origin's `Cache-Control` — never blanket-cache.** The bridge marks hashed
assets (`/assets/*`) immutable and everything else (notably `/sw.js` and `index.html`) `no-cache`.
A proxy cache that ignores this and holds onto `/sw.js` starves installed PWAs of updates
indefinitely — clients keep running old code with no way to notice. If your proxy adds caching,
honor origin headers (Caddy and stock Nginx `proxy_cache` do by default; CDNs often need it
enabled explicitly).
