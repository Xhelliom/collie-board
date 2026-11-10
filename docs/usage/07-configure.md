# Configure

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Out of the box Collie runs **open single-user**: anyone on your tailnet who can reach the URL has
full control — that's exactly what the two startup WARNINGs are about. Close both in one sitting:

```bash
# in your .env
COLLIE_BOARD_TRUSTED_USER=you@example.com           # your tailnet login — the bridge rejects anyone else
COLLIE_BOARD_PUBLIC_HOSTS=myhost.tail1234.ts.net    # exact host(s) you serve on — blocks DNS rebinding
```

Config is a `.env` in the plugin's config dir — find it with
`herdr plugin config-dir herdr.collie-board` (typically `~/.config/herdr/plugins/config/herdr.collie-board`;
without Herdr, `~/.config/collie-board`). `collie-board-ctl.sh` resolves this same dir whether you run it
directly or via a Herdr action:

```bash
cp .env.example "$(herdr plugin config-dir herdr.collie-board)/.env"
```

The bridge reads `.env` only at startup — after any edit, `scripts/collie-board-ctl.sh restart`. See
[`.env.example`](../../.env.example) for the full option list — commonly `COLLIE_BOARD_PORT`, or
`COLLIE_BOARD_SERVE_MODE=http` (Headscale / `.internal` domains; read by the control script when it runs
`tailscale serve`).

**Custom domain or reverse proxy?** See
[Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md) for the full reverse-proxy
front-door setup. The one rule to know here: Collie is same-origin only. A plain `tailscale serve` on
your MagicDNS name works as-is, but a different hostname or TLS terminator makes API calls fail with
`403 cross-origin` (page loads, stays empty). Allow the exact origin:

```bash
COLLIE_BOARD_ALLOWED_ORIGINS=https://collie.example.com
```
