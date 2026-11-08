# Variant B — identity-aware proxy + per-device authorisation

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Use this when some devices should **drive** agents and others should be **read-only** — e.g. your
phone can reply, but a shared/less-trusted device can only watch. Collie reads an opaque device id
from a request header (`COLLIE_BOARD_DEVICE_HEADER`) and checks it against `COLLIE_BOARD_DEVICE_ALLOWLIST`:
allow-listed → full access, any other id → read-only, header absent → read-only as well.

Treating an absent header as read-only is the point: switching this on is you asserting that your
proxy sets the header on every request, so a request without one did not come through that proxy and
must not drive a terminal. **Device-auth only works behind a reverse proxy that authenticates the
device and injects the header.** It is not a standalone flag.

Note what "read-only" means here: the gate covers writes (replies, keys, uploads, pane and tab
create/close). Reading panes, polling the snapshot and listing sessions stay open to any caller that
gets past the same-origin and Host checks, exactly as they do for a device that is simply not on the
allowlist. Pane text can contain anything your agents printed, so the header is not a confidentiality
boundary.

Two consequences worth knowing before you turn this on:

- **The bridge's own loopback URL becomes read-only.** `http://127.0.0.1:$COLLIE_BOARD_PORT` bypasses your
  proxy, so the PWA loaded from it sends no device header and shows its read-only state. Drive the
  herd through the proxied URL instead.
- **To drive a pane from the host by hand**, send an allowlisted id yourself, against the loopback
  bridge rather than the public URL (the proxy's mandatory override in point 2 below would replace
  your header): `curl -H 'X-Device-Id: my-laptop' http://127.0.0.1:$COLLIE_BOARD_PORT/api/...`

> ⚠️ **Do not enable `COLLIE_BOARD_DEVICE_HEADER` on plain `tailscale serve`.** `tailscale serve` injects
> only its own `Tailscale-*` headers and *forwards* an arbitrary `X-Device-Id` untouched, so a
> client that *sets* `X-Device-Id: my-phone` itself is trusted. Spoofing is what makes this unsound,
> and only a proxy that **overrides** the header (point 2 below) closes it.

Your fronting proxy **must**:

1. **Authenticate the device** by some means it controls — mTLS client certs, an SSO/forward-auth
   layer (oauth2-proxy, Pomerium, Cloudflare Access), Tailscale node identity, etc. How you derive a
   stable per-device id is up to you; Collie treats it as opaque.
2. **Set (override) the device header** on *every* upstream request — never merely add it, so any
   client-supplied copy is discarded. This override is what makes the header trustworthy.
3. **Proxy to the bridge on loopback** (`127.0.0.1:$COLLIE_BOARD_PORT`). The loopback bind is the trust
   anchor — nothing but the proxy can reach the bridge to set the header.
4. **Satisfy the same-origin gate.** Collie accepts a request when the browser's `Origin` host
   equals the `Host` the bridge receives. So either **forward the public `Host` unchanged**, or — if
   your proxy rewrites Host — list the exact public origin in `COLLIE_BOARD_ALLOWED_ORIGINS`. Otherwise
   every API call 403s `cross-origin rejected` (the page loads but stays empty).

Collie side (`.env`):

```bash
COLLIE_BOARD_HOST=127.0.0.1                       # keep loopback (default)
COLLIE_BOARD_DEVICE_HEADER=X-Device-Id            # the header your proxy injects
COLLIE_BOARD_DEVICE_ALLOWLIST=my-phone,my-laptop  # ids allowed to drive agents; others → read-only
# COLLIE_BOARD_ALLOWED_ORIGINS=https://collie.example.com   # only if the proxy does NOT forward the public Host
# COLLIE_BOARD_TRUSTED_USER still composes on top if your ingress also injects Tailscale-User-Login
```

Illustrative nginx — the auth layer is yours; the load-bearing lines are the **override** and the
**loopback** `proxy_pass`:

```nginx
location / {
    # $device_id comes from your auth (client-cert CN, auth_request, SSO header, …).
    # SETTING it replaces any client-supplied X-Device-Id — that's what kills spoofing.
    proxy_set_header X-Device-Id $device_id;
    proxy_set_header Host        $host;       # forward the public Host → same-origin gate passes
    proxy_pass http://127.0.0.1:8788;
}
```

Revoke a device by dropping its id from `COLLIE_BOARD_DEVICE_ALLOWLIST` and restarting
(`herdr plugin action invoke restart --plugin herdr.collie-board`). With the header set but the allowlist
**empty**, every device is read-only (fail-closed), and so is a request that arrives without the
header. In that state nothing can drive a pane, including a hand-made `curl`; recovery is an `.env`
edit plus a restart.

This variant assumes the proxy is **on the same host**, reaching the bridge on loopback. If your
proxy runs on a *different* node and its upstream is the bridge's own `tailscale serve` URL, the
trust story changes — see [Variant D](10-deployment-variants-04-variant-d-off-host-identity-proxy-over-the-tailn.md).
