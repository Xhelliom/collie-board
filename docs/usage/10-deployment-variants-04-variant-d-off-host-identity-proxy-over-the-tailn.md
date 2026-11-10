# Variant D — off-host identity proxy over the tailnet

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Choose this when you already run a **central ingress node** for your tailnet — one forward-auth/SSO
layer, one wildcard cert, a row of services behind it — and you want Collie to be another entry in
that table rather than a second auth stack configured on the agent host.

The proxy is on a *different machine*, so it can't reach the bridge on loopback. The agent host
publishes the bridge **tailnet-only** with `tailscale serve --http`, and the proxy's upstream is that
tailnet URL:

```
  phone ──── https ────► ingress node          TLS + forward-auth; SETS the device header
                            │
                            │  http, never leaves the tailnet (WireGuard encrypts it)
                            ▼
                        host.your-tailnet.ts.net:8788     tailscale serve --http, tailnet-only
                            │
                            ▼
                        127.0.0.1:8788                    the bridge
```

Plain HTTP on the middle hop is fine *because it rides the tailnet* — TLS terminates at the proxy.
That is not the same thing as serving Collie over plain HTTP publicly, which is what the
`COLLIE_BOARD_SERVE_MODE=http` warnings elsewhere are about.

The **four proxy requirements from
[Variant B](10-deployment-variants-02-variant-b-identity-aware-proxy-per-device-author.md) apply**, except (3): proxy to
the host's tailnet URL rather than `127.0.0.1`.

> ⚠️ **A Tailscale ACL is mandatory in this variant.** The bridge's tailnet URL has to stay reachable
> or the proxy couldn't reach it either, so there is a permanent second path to the bridge that skips
> your forward-auth entirely — and **`tailscale serve` forwards a client-supplied device header
> untouched** (verified: it arrives at the bridge unmodified). Your proxy's mandatory *override* only
> protects the proxy path; on the direct path there is no override, so a tailnet peer who supplies an
> allow-listed id gets full write access. Device ids are human-readable names, so treat them as
> guessable, not secret. **Restrict who can reach the port at all.**
>
> On Tailscale (or headscale ≥ 0.29), `grants`:
>
> ```jsonc
> "grants": [
>   { "src": ["tag:ingress"], "dst": ["tag:agent-host"], "ip": ["tcp:8788"] },
> ]
> ```
>
> On **headscale ≤ 0.28** `grants` does not exist, and an unparseable policy will take the control
> plane down rather than fail safe — use the older `acls:` form. Tags may not be an option either:
> 0.28 makes tag ownership and user ownership mutually exclusive, so tagging a node can detach it from
> its user. Name the nodes or users directly instead:
>
> ```yaml
> acls:
>   - action: accept
>     src: ["ingress-node"]
>     dst: ["agent-host:8788"]
> ```
>
> **Adding that rule is not enough on its own.** These policies are default-deny, so a broad rule you
> already have (`dst: ["agent-host:*"]`) will keep the port open to everyone it covers. The port has
> to be *carved out* of the broader grant, which in practice means splitting the range:
>
> ```yaml
>   - action: accept
>     src: ["my-phone", "my-laptop"]
>     dst: ["agent-host:1-8786", "agent-host:8788-65535"]   # everything EXCEPT the bridge
> ```
>
> Per-device auth is still required, and it does real work: since 0.15.0 a request arriving *without*
> the header is read-only, so a stray client, another service or the host's own loopback URL can watch
> but never drive. What it cannot do is stop a caller who deliberately sets the header. The ACL is
> what stops that, and the two together are the posture.

**Host and Origin are different values here** — the one place this trips people up. `tailscale serve`
Host-routes on the host's own MagicDNS name, so the proxy generally must rewrite `Host` to the
upstream (in Traefik, `pass_host_header: false`). The bridge then sees the *tailnet* Host while the
browser's Origin is your *public* name, so the two settings take different values:

```bash
COLLIE_BOARD_SERVE_MODE=http                                # proxy terminates TLS; this hop is tailnet-internal
COLLIE_BOARD_HOST=127.0.0.1                                 # keep loopback (default)
COLLIE_BOARD_DEVICE_HEADER=X-Tailnet-Device                 # header your forward-auth injects — REQUIRED here
COLLIE_BOARD_DEVICE_ALLOWLIST=my-phone,my-laptop            # ids allowed to drive; others + header-less → read-only
COLLIE_BOARD_PUBLIC_HOSTS=host:8788,host.your-tailnet.ts.net:8788   # the Host the proxy forwards
COLLIE_BOARD_ALLOWED_ORIGINS=https://collie.example.com     # the public origin the browser actually uses
```

> **`COLLIE_BOARD_TRUSTED_USER` is not a person gate in this shape.** `tailscale serve --http` *does* still
> inject `Tailscale-User-Login`, but it names the **calling node's owner** — through the proxy that's
> the ingress node, identically on every request no matter who is holding the phone. It remains
> useful for rejecting nodes owned by a *different* tailnet user (shared machines), so it is worth
> setting; it just cannot tell your own devices apart. The device header does that.

**Is it actually working?** Two controls are doing the work here — the ACL decides *who reaches the
port*, the device gate decides *what a request that got there may do* — and each has to be tested
from a machine that can actually observe it.

**From a tailnet peer** (your phone, a laptop — anything that is neither the ingress node nor the
agent host):

```console
$ curl -s https://collie.example.com/api/snapshot | jq -c .device
{"enforced":true,"device":"my-phone","authorized":true}

$ curl -s --max-time 10 -H 'X-Tailnet-Device: my-phone' http://host.your-tailnet.ts.net:8788/api/snapshot
curl: (28) Connection timed out
```

The first proves the proxy injects the header *and* that the id is allow-listed. The second is the
one people skip: it must **fail to connect**. A reply of any kind means that peer reached the port
directly, and since the header is forgeable there, your forward-auth is decoration for anyone who
bothers.

**On the agent host** (where the port is reachable by definition, so the gate is what's under test):

```console
$ curl -s http://127.0.0.1:8788/api/snapshot | jq -c .device
{"enforced":true,"device":null,"authorized":false}
```

A header-less request must be read-only. **If it says `"authorized":true`, your bridge predates
0.15.0** — update before going further.

> ⚠️ **Don't test reachability from the agent host.** A connection to your own tailnet IP is handled
> locally and never crosses the peer packet filter, so `curl http://host.your-tailnet.ts.net:8788`
> succeeds *there* even when the ACL is flawless. It is the most obvious machine to test from, since
> it's the one you're configuring, and it will tell you your ACL is broken when it isn't. Reachability
> is only observable from a second device.
