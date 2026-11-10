# Manage & update

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

## Back up your data

**Settings → Backup → Download backup** saves everything Collie Board persists as one JSON file,
`collie-board-backup-YYYY-MM-DD.json`. No terminal, no `scp` — it downloads to the device you're
holding. On the wire it's `GET /api/backup`, gated like a write (it hands over every durable byte
the plugin owns, push subscription keys included), so a read-only device can't take one.

**Settings → Backup → Restore…** reads one back: pick the file, then tap again to confirm — it
replaces the board and every stored preference. Before it writes a single byte the bridge exports
the CURRENT state to `<state dir>/backups/pre-import-<timestamp>.json` and names that file in the
result; if that safety export fails, the import is abandoned rather than run without a net. The
restore is a merge, not a wipe: a table present in the file replaces that table, a table absent from
it is left alone, files are overwritten by path and none are deleted. Cards are live immediately
(the board reads SQLite per request), but snooze / notification prefs / push subscriptions were
loaded into memory at boot, so finish with:

```bash
herdr plugin action invoke restart --plugin herdr.collie-board
```

The format, version `1`:

```jsonc
{
  "kind": "collie-board-backup",
  "version": 1,
  "exportedAt": "2026-08-05T09:41:12.000Z",
  // Every row of every table in board.db, keyed by table name: cards, sessions, reviews, the
  // journal, repo preferences. Rows rather than the file's bytes — the database is open with WAL,
  // so a byte copy taken mid-write would be torn. Read from `sqlite_master`, so a table added
  // later is in the backup without anyone updating the exporter.
  "db": { "card": [ … ], "session": [ … ], "review": [ … ], "event": [ … ], "repo_pref": [ … ] },
  // Everything else under the state dir, walked recursively — notify-prefs.json, snooze.json,
  // push-subscriptions.json, update-state.json, audit.log, the copilot's scratch, uploads.
  // `.json`/`.log`/`.txt`/`.md`/`.toml` stay readable as `utf8`; anything else (images) is base64.
  "files": [ { "path": "snooze.json", "encoding": "utf8", "content": "{…}" } ],
  // This browser's preferences — theme, display prefs, push opt-out, board repo scope. They live
  // in localStorage, never on the bridge, so the app staples them on before saving the file.
  "client": { "collie:theme": "dark", "collie:display-prefs:v3": "{…}" }
}
```

JSON rather than a tarball on purpose: no dependency, nothing shelled out, and a backup you can read
with `jq` when what you actually need is one card's spec back. A backup from an older Collie Board
restores fine (unknown tables and columns are skipped on both sides); one from a *newer* version is
refused rather than half-applied. Treat the file as sensitive: it carries card specs, the audit log
and push subscription keys, exactly like the 0700 state dir it came from — and `backups/` beneath
that state dir holds the same, one file per import.

## Stop or uninstall

Pause the bridge without removing anything (a later `start` brings it right back):

```bash
scripts/collie-board-ctl.sh stop      # or: herdr plugin action invoke stop --plugin herdr.collie-board
```

To tear the service down completely — stop + disable it, remove the `systemd --user` unit, and remove
Collie's own `tailscale serve` mapping (port-scoped, so other tailnet mappings on the host survive) —
use `uninstall`. It leaves your `.env` and the checkout untouched:

```bash
scripts/collie-board-ctl.sh uninstall # or: herdr plugin action invoke uninstall --plugin herdr.collie-board
```

Then `herdr plugin uninstall herdr.collie-board` (or, for a linked clone, just deleting the directory)
removes the plugin registration itself.

## Update to a new release

Collie Board is link-mode — the checkout *is* the plugin, and there's no `herdr plugin update`. One
command does the lot:

```bash
scripts/collie-board-ctl.sh update    # or: herdr plugin action invoke update --plugin herdr.collie-board
```

It advances the checkout, rebuilds the UI and restarts the bridge (re-execing itself, so it's safe
even when the update rewrites the script). Confirm via the footer build stamp. The same works on
Windows. On a Linux/macOS host whose Herdr doesn't see bun on its `PATH`, invoke `update-bash`
instead — or tap **Update** in Settings → Updates, which uses it there (ADR 0054).

How it advances depends on how you installed, because `herdr plugin install` does **not** clone — it
`git fetch --depth 1` + `checkout --detach`es, leaving a detached, shallow checkout:

- **Linked clone** — `git pull --ff-only` on your branch, then **re-links the plugin** so Herdr picks
  up any new actions and the new version.
- **`herdr plugin install`** — fetches the default-branch tip and re-detaches onto it (`--force`, so a
  lockfile the build rewrote can't wedge the next update). It deliberately does **not** re-link:
  linking would re-register the plugin as a local path, and Herdr then refuses
  `herdr plugin install` — the reinstall you'd need if this checkout ever breaks.

Your `.env` and serve state live outside the checkout, so they survive either path. If you pinned a
version with `--ref`, keep using `herdr plugin install --ref …` — `update` always goes to the latest.

**The in-app "a new release is out" banner checks the repo the plugin was installed from**: the
GitHub `origin` of its checkout — `Xhelliom/collie-board` for a `herdr plugin install`, on Windows as
on Linux, with no setup step. `COLLIE_BOARD_UPDATE_REPO=owner/name` in your `.env` overrides it, and
`COLLIE_BOARD_UPDATE_REPO=off` turns the check off. `start` / `status` on Windows print the repo it
reads (`updates …`).

By hand: frontend (`web/`) → `collie-board-ctl.sh build` (live, no restart — served from disk); backend
(`bridge/`) → `systemctl --user restart collie-board`. Run `scripts/install-hooks.sh` once to enable the
repo's pre-commit / pre-push checks.
