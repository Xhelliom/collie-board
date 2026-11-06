# 0050 — Every action runs `ctl.ts`, because Herdr allows one command per action id

**Status:** Accepted — its `update` clause superseded by [0054](./0054-update-runs-ctl-ts-everywhere-with-a-bash-twin-the-bridge-invokes.md)
**Date:** 2026-11-03

## Context

[ADR 0046 §7](./0046-multi-machine-un-collie-central-et-des-noeuds.md) plans the Windows port of
`collie-board-ctl.sh` as `scripts/ctl.ts` under Bun, with "des entrées `platforms = ["windows"]`"
in `herdr-plugin.toml` beside the Linux ones. The natural reading is one Windows variant per action,
under the same id, so that `herdr plugin action invoke start --plugin herdr.collie-board`, the
command the update banner and the README give, means the same thing on every OS.

Herdr 0.9.5 does not allow it. Measured with a throwaway plugin, two `[[actions]]` with id `hello`,
one `platforms = ["linux", "macos"]` and one `platforms = ["windows"]`:

```
herdr plugin link … → {"error":{"code":"duplicate_plugin_action_id","message":"duplicate action id 'hello'"}}
```

Its plugin docs say the same ("each id type must be unique inside a plugin"), and `command` is one
argv with no per-platform form. Two other ways around it were tried or weighed:

- **A relative launcher** (`command = ["scripts/ctl", …]`, with a `scripts/ctl.cmd` beside a POSIX
  `scripts/ctl`). On Windows, Herdr resolves the path to the extensionless file and fails
  (`%1 n'est pas une application Win32 valide`, os error 193): PATHEXT resolution applies only to a
  bare command found on `PATH`.
- **A polyglot `ctl.cmd`**, valid as both batch and sh. It would depend on how Herdr execs a file
  with no shebang on Linux (ENOEXEC), which nobody can test from a Windows box, and nobody can read.

`[[build]]` entries carry no id, so a Windows-only build entry is fine.

## Decision

**Every action that runs on Windows has the same argv on every platform: `["bun", "scripts/ctl.ts",
"<id>"]`.** `ctl.ts` hands the command, untouched, to `collie-board-ctl.sh` on Linux and macOS, and
runs it natively on Windows. An action `ctl.ts` cannot yet run on Windows (`setup`, `update`) keeps
the bash command and is pinned to `platforms = ["linux", "macos"]`; Windows doesn't offer it until
the port catches up. `scripts/ctl.test.ts` pins both rules against the manifest.

## Consequences

- **Bun must be on the Herdr server's `PATH` on Linux and macOS too**, for `start`, `stop`,
  `restart`, `uninstall`, `status`, `url` and `version`. Before this, those actions only needed bash,
  and `collie-board-ctl.sh` found bun itself in `~/.bun/bin` & co. (brick 1 in `UPSTREAM_PRS.md`: a
  Herdr started outside a login shell doesn't see `~/.bun/bin`). The bun used to *run* the bridge is
  still resolved by the shell script; only the hand-off needs `bun` on `PATH`.
- **`update` stays on bash for exactly that reason.** A host whose Herdr can't see bun can still
  update, which is its only way back to a fix from a phone.
- **On Windows, the in-app update banner's `invoke update` is refused** (`platform_unsupported`)
  until `ctl.ts` learns `update`. The refusal is Herdr's, not a silent no-op.
- **What would justify revisiting it:** Herdr accepting per-platform commands, or duplicate ids with
  disjoint platforms. Then the Linux actions can go back to bash with no hand-off, until the shell
  script is retired anyway (ADR 0046 §7: it gains no function from here on and disappears once
  `ctl.ts` catches up).
