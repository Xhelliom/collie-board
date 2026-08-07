# 0008 — The user unit cannot have a mount namespace

- **Status:** Accepted
- **Date:** 2026-08-07
- **Shipped in:** 0.97.1

## Context

The unit carried `PrivateTmp=yes` from upstream, under a comment describing it as hardening for "the
bridge is remote shell access". It is a `systemd --user` unit.

An unprivileged user manager cannot mount anything without a **user namespace** — so on systemd 258+
every sandboxing directive that needs a mount namespace (`PrivateTmp=`, `ProtectSystem=`,
`PrivateDevices=`, `ReadOnlyPaths=`…) silently drags one in. Inside it, uid 0 is not mapped, and
every root-owned file on the host reads as `nobody:nobody`:

```
$ systemd-run --user --pipe --property=PrivateTmp=yes stat -c '%U:%G %a' \
    /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf
nobody:nobody 644          # root:root 644 outside the namespace
```

OpenSSH accepts a config file owned by **root or by the invoking user, and nobody else**. Every file
pulled in by `/etc/ssh/ssh_config`'s `Include` now fails that test:

```
Bad owner or permissions on /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf
fatal: Could not read from remote repository.
```

`ssh` exits 255 before it ever reads a key, so **every git operation against an SSH remote fails** —
which is `git push`, which is Open a PR and Done. It is not a key problem, not an agent problem, and
`PrivateUsers=no` does not help: the user namespace is a precondition for the mount, not a choice.
The failure is invisible from a shell, where the same command works, and invisible in the service's
own logs — it surfaces only as a `card.pr_failed` event with a message about file permissions.

This is the **second** trap from the same line. The first is in `README.md` and the 0.31.0 changelog:
a repository under `/tmp` doesn't exist for the service, and git fails with `ENOENT … posix_spawn
'git'`, which reads as "git is not installed".

What the line bought, meanwhile: a private `/tmp`. The bridge's job is to hand a phone a real
terminal on this machine — every agent it launches runs **outside** this unit, in herdr, with the
operator's full `$HOME`. A private `/tmp` for the bridge process alone defends nothing that the
design has not already conceded.

## Decision

**No mount-namespace sandboxing in the user unit.** `PrivateTmp=` is removed from both places the
unit is written (`systemd/collie-board.service`, and the heredoc in `scripts/collie-board-ctl.sh`), and
`ProtectSystem=`, `PrivateDevices=`, `ReadOnlyPaths=`, `ProtectHome=` are not to be added in its
place — they all take the same namespace and reproduce the same bug.

`NoNewPrivileges=yes` stays: it needs no namespace and costs nothing.

## Consequences

- Open a PR and Done work against SSH remotes, which is how the fork's git remotes are configured.
- A repo under `/tmp` now works too. The README's warning goes with the line that caused it.
- The bridge sees the host's real `/tmp`. Accepted: a process that exists to type into the
  operator's terminals is not made safer by not seeing their scratch files.
- **What would justify revisiting:** running the bridge as a *system* unit (uid 0 is mapped there, so
  the namespace directives behave as documented), or systemd gaining an id-mapped mount for user
  namespaces that preserves host ownership. Neither is on the table today.
- Diverges from upstream on a hardening line — recorded in `UPSTREAM.md`. Upstream never shells out
  to git, so upstream only ever meets the `/tmp` half of this.
