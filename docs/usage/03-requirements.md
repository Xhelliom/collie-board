# Requirements

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

On the **host** (the tailnet node your agents run on):

| Tool | Why |
| --- | --- |
| [**Bun**](https://bun.sh) | Runs the bridge and builds the web UI — the only hard dependency. |
| [**Herdr**](https://herdr.dev) ≥ 0.7.0 | The herd this mirrors; its CLI registers the plugin, and `worktree.create` is what a card start rides on. |
| [**Tailscale**](https://tailscale.com) | Front door for the default variant (`tailscale serve`); optional if you run [Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md) behind your own reverse proxy. Without any front door, the bridge is `127.0.0.1`-only. |
| **git** | Clone, the `update` command, and every card: worktree, branch, diff, merge. |

Soft dependencies: **Node.js** (the control script uses it to extract your MagicDNS name from
`tailscale status --json`; without it the banner falls back to the loopback URL), **`systemd
--user`** (supervises the service; falls back to a `nohup` process without it), and
[**`gh`**](https://cli.github.com) (only for a card's *open a PR* tap — `merge` and `cleanup` need
plain git). You never install JS deps by hand — the build runs `bun install` for you; the backend
imports only Bun + `node:*`. [`web-push`](https://www.npmjs.com/package/web-push) is optional and
lazy (see [Web Push](../../README.md#web-push-optional)).

**Linux and macOS are the supported hosts.** The bridge itself also runs on **Windows**
(experimental) against Herdr's Windows beta — see [Windows](../../README.md#windows-experimental).
