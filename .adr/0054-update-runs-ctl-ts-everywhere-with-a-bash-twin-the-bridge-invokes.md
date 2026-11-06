# 0054 — `update` runs `ctl.ts` everywhere, with a bash twin the bridge invokes

**Status:** Accepted
**Date:** 2026-11-06
**Supersedes:** the `update` clause of [ADR 0050](./0050-every-action-runs-ctl-ts-because-herdr-allows-one-command-per-id.md)

## Context

ADR 0050 kept `update` on bash, Linux/macOS only, so that a host whose Herdr can't see bun could
still update. The price was Windows: the update banner's `invoke update` answered
`platform_unsupported` there, and a Windows node had no way to update from a phone. Settings →
Updates now also gets an "Update" button, which goes through Herdr like the rollback does
(`bridge/rollback.ts`): the bridge can't reinstall itself, its restart kills its own unit.

Herdr allows one command per action id (ADR 0050), so `update` is either bun or bash, everywhere.

## Decision

- **`update` is `bun scripts/ctl.ts update` on every platform.** `ctl.ts` hands it to the shell
  script on Linux/macOS (unchanged behaviour) and runs the same steps natively on Windows: the same
  `update_checkout` git moves, then build, restart, re-link.
- **A second action, `update-bash`, Linux/macOS only, is the same update through bash.** It needs no
  bun on Herdr's `PATH`. The bridge's button and rollback invoke `update-bash` off Windows and
  `update` on Windows, so the phone's way back to a fix never depends on Herdr's `PATH`.
- **Herdr-managed installs keep the fetch + detach** the shell script already does, rather than
  `herdr plugin update`: that would run `[[build]]` a second time and can't land on a rollback tag.

## Consequences

- The command the release notes give, `invoke update`, works on every platform where Herdr sees bun;
  on a Linux host where it doesn't, `invoke update-bash` (README) or the Settings button.
- The bridge holds the update request and watches the action's Herdr log, so a failure (a refused
  fast-forward, a red build) comes back with its reason while the old bridge still runs. A success
  ends with the restart, which drops the request; the page then reloads on the new build.
- One more action id to keep. It goes away with the shell script (ADR 0046 §7).
