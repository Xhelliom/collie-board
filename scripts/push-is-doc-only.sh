#!/usr/bin/env bash
# Reads a pre-push hook's stdin («local_ref local_sha remote_ref remote_sha» per line).
# Exit 0 only when EVERY pushed file is documentation (*.md, docs/, .adr/, changes/); exit 1 otherwise,
# and in any doubt (diff impossible, no base, nothing to look at): the hook then runs everything.
set -u
zero=0000000000000000000000000000000000000000
seen=0
while read -r _ local_sha _ remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  [ "$local_sha" = "$zero" ] && continue # deleting a ref pushes no file
  if [ "$remote_sha" = "$zero" ]; then # new branch: compare with its base, never with nothing
    base="$(git merge-base "$local_sha" origin/HEAD 2>/dev/null)" || exit 1
  else
    base="$remote_sha"
  fi
  files="$(git diff --no-renames --name-only "$base" "$local_sha" 2>/dev/null)" || exit 1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.md | docs/* | .adr/* | changes/*) ;; *) exit 1 ;; esac
  done <<<"$files"
  seen=1
done
[ "$seen" = 1 ]
