# Developing this plugin

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

Clone it and `herdr plugin link` it ([Install](../../README.md#install) above), then edit in place.

- **The manifest is the plugin.** `herdr-plugin.toml` declares the actions listed in
  [Herdr actions](08-commands.md#herdr-actions), and each one shells out to `scripts/collie-board-ctl.sh`. Both are
  commented — read them, not a paraphrase of them here.
- **One asymmetry in the dev loop:** `web/` rebuilds go live with no restart (the bridge serves
  `web/dist` from disk); `bridge/` changes need `systemctl --user restart collie-board`. Build, test and
  versioning rules are in [`CLAUDE.md`](../../CLAUDE.md) — versioning is hook-enforced, so skim it before
  your first commit.
- **Why a supervised service and not a plugin pane** — [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §3.
  That decision is why the manifest uses `[[actions]]` and `[[build]]` and nothing else.
- **Keep the upstream surface narrow.** Because this is a fork, new behaviour goes in a new file with
  an `engine.onUpdate` hook, never spread across `server.ts`/`index.ts`. The list of touched upstream
  files in [`UPSTREAM.md`](../../UPSTREAM.md) *is* the rebase cost, and it is meant to stay short. A
  change that would help upstream gets its entry in [`UPSTREAM_PRS.md`](../../UPSTREAM_PRS.md) in the
  same commit.

Herdr's plugin system itself is upstream's to document:
[authoring](https://herdr.dev/docs/plugins/) ·
[CLI reference](https://herdr.dev/docs/cli-reference/) ·
[example plugins](https://github.com/ogulcancelik/herdr-plugin-examples).
