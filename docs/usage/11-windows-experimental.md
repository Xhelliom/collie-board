# Windows (experimental)

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

The **bridge** runs on Windows against Herdr's Windows beta, and so do the `start`/`stop`/`status`
actions (no `setup` or managed `tailscale serve` yet). Herdr there exposes its control socket as a *named pipe* named after the full socket path, not an AF_UNIX
socket, so Collie dials it through `node:net` instead of `Bun.connect` — one shim,
[`bridge/dial.ts`](../../bridge/dial.ts), which explains the mapping at the top of the file.

What that means in practice:

- **Install and start it with Herdr**, as on Linux — no Git Bash needed:

  ```powershell
  herdr plugin install Xhelliom/collie-board
  herdr plugin action invoke start --plugin herdr.collie-board
  ```

  Every action runs `bun scripts/ctl.ts <action>` ([ADR 0050](../../.adr/0050-every-action-runs-ctl-ts-because-herdr-allows-one-command-per-id.md)).
  `start` builds the UI if needed and registers a **scheduled task, `CollieBoard`**: at your logon,
  in your session, never elevated — not a service, whose session 0 has no desktop for an agent to
  drive. The task runs a small supervisor that restarts the bridge 5 s after it dies; logs go to
  `collie.log` beside the plugin `.env` (`bun scripts/ctl.ts logs`). `stop` ends and disables
  the task, `uninstall` deletes it; `status`, `url`, `version`, `restart` work as on Linux.
- **Not on Windows yet: `setup` and `update`.** Write the plugin `.env` yourself — its folder is
  `herdr plugin config-dir herdr.collie-board` (`%APPDATA%\herdr\plugins\config\herdr.collie-board`),
  with at least `COLLIE_BOARD_TRUSTED_USER` and `COLLIE_BOARD_PUBLIC_HOSTS` ([Configure](../../README.md#configure)).
  To update: `herdr plugin update`, then the `restart` action.
- **`tailscale serve` isn't managed here yet.** Either publish it yourself
  (`tailscale serve --bg 8788`, and remove it yourself) or use the [Variant C](10-deployment-variants-03-variant-c-reverse-proxy-as-the-only-front-door-n.md)
  posture: loopback bind, your own ingress in front, `COLLIE_BOARD_PUBLIC_HOSTS` pinned. The security
  rules in [§Security](../../README.md#%EF%B8%8F-security--read-before-you-run-it) are not relaxed on Windows.
- The socket path defaults to `%APPDATA%\herdr\herdr.sock`; override with `HERDR_SOCKET_PATH`
  (an explicit `\\.\pipe\…` value is passed through untouched). Named sessions
  (`%APPDATA%\herdr\sessions\<name>\herdr.sock`) are discovered like on Linux — verified against
  Herdr 0.9.5 in the [Windows reconnaissance](../multi-machine/reconnaissance-windows.md).

**Installing on Windows** — native, no WSL, no Developer Mode:

- **Bun from `irm bun.sh/install.ps1 | iex`** preferably: winget's package doesn't put `bunx` on
  `PATH` without Developer Mode. The build no longer needs it, but your own tooling may.
- **LF endings come with the repo**: its `.gitattributes` checks every text file out as LF whatever
  `core.autocrlf` says. A clone made before that is still CRLF on disk — refresh it once with
  `git rm -r --cached -q . && git reset --hard` on a clean tree.
- **`git` and `claude` on the PATH of the Herdr *server*, not just your shell.** The server inherits
  the PATH of whoever launched it; one started from a shell older than the Git install fails every
  card start with `worktree_create_failed: program not found`, while its panes, which rebuild their
  environment from the registry, still see git. Start Herdr from a fresh logon environment (a new
  Windows Terminal, or a scheduled task at logon), never from a long-lived shell.
- **The skill**: link it with a junction (`scripts/install-skill.sh` has the PowerShell line), and
  the orchestrator's hook is `bun ~/.claude/skills/collie-board/since-hook.ts`, as on Linux.
- The **gallery** reads Claude Code's Windows scratchpads, under `%TEMP%\claude`; the usage gauge
  finds `claude.exe` on `PATH` or in `%USERPROFILE%\.local\bin`.

**Is it actually working?** The bridge logs `[events] stream up` on start — the event stream works
over the pipe, so Windows gets the same live updates as Linux, not degraded polling.

`COLLIE_BOARD_HERDR_DIAL=net` forces that same dialer on Linux/macOS. It exists so the Windows code path
can be exercised — and regression-tested — without a Windows box; `bridge/dial.test.ts` uses it.
