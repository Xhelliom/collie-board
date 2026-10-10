#!/usr/bin/env bash
# Refuse to ship while a file sits untracked: the diff that gets reviewed would import something
# that exists only on this machine (e7353472, adff0e0d, tag-chip.tsx). .gitignore'd files don't count.
# Run by the pre-push hook; to proceed, `git add` the file (or ignore it), or SKIP_UNTRACKED_CHECK=1.
set -euo pipefail

[ "${SKIP_UNTRACKED_CHECK:-}" = "1" ] && exit 0
untracked="$(git ls-files --others --exclude-standard)"
[ -z "$untracked" ] && exit 0

{
  echo "✗ untracked files — git add them (or .gitignore them) so the reviewer sees what you built against:"
  echo "$untracked" | sed 's/^/  /'
} >&2
exit 1
