# Install

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

**The short version** — from a checkout, one bootstrap then one start:

```bash
bash scripts/collie-board-ctl.sh setup     # preflight, link the plugin, write the security config
herdr plugin action invoke start --plugin herdr.collie-board
```

`setup` exists for one reason: it derives `COLLIE_BOARD_TRUSTED_USER` and `COLLIE_BOARD_PUBLIC_HOSTS`
from `tailscale status`. Those are the two settings that turn "anyone on my tailnet has a shell on
this box" into "only me", and they are exactly the two people skip. It also notices when your tailnet
has no HTTPS certificate and configures the http fallback instead of letting `serve` fail.

It never overwrites a `.env` you already have — it tells you what's missing and leaves the file
alone. It starts nothing and publishes nothing; `start` is the step that puts you on the tailnet.

The long version, and every deployment variant, follows.

On the host, not your phone. Two ways in — both point at
[`Xhelliom/collie-board`](https://github.com/Xhelliom/collie-board), this fork. Installing
[upstream Collie](https://github.com/AltanS/collie) instead gets you the stateless mirror and no
board; the plugin ids differ (`herdr.collie` vs `herdr.collie-board`), so the two can also coexist.

**From GitHub (turnkey)** — Herdr clones and builds for you:

```bash
herdr plugin install Xhelliom/collie-board
herdr plugin action invoke start --plugin herdr.collie-board
```

**From a local clone (for development)** — registered by path:

```bash
git clone https://github.com/Xhelliom/collie-board.git && cd collie-board
herdr plugin link "$(pwd)"
herdr plugin action invoke start --plugin herdr.collie-board
```

They differ only in *when* the UI builds: a GitHub install builds at install time (the manifest's
`[[build]]` step); a linked clone builds on first `start`. Either way, `start` does four things:

1. **builds** `web/dist` if it's missing (typechecked, staged, swapped in atomically),
2. **starts the bridge** as the `systemd --user` service `collie-board` (`nohup` fallback without systemd),
3. **publishes it on the tailnet** — literally `tailscale serve --bg 8788`: HTTPS on the host's
   MagicDNS name, `:443 → 127.0.0.1:8788`, tailnet-only,
4. **prints the banner** with the URL to open — walked through line by line in
   [First run](../../README.md#first-run--what-youll-see).

> No Herdr? Run `scripts/collie-board-ctl.sh start` directly — same effect (config then lives in
> `~/.config/collie-board/.env`).
