#!/usr/bin/env bash
# Audit P6: the suites ran green at the pre-push on this exact commit, so the gate need not run them again.
#   tests-passed.sh record — the pre-push, after its suites: notes HEAD when the tree is clean, forgets otherwise.
#   tests-passed.sh        — exit 0 only when HEAD is the noted commit and the tree is still clean; any doubt → 1.
# The note is per checkout (git-path, so each worktree has its own) and never committed.
set -u
mark="$(git rev-parse --git-path collie-tests-passed 2>/dev/null)" || exit 1
head="$(git rev-parse --verify -q HEAD)" || exit 1
dirty="$(git status --porcelain 2>/dev/null)" || exit 1
if [ "${1:-}" = record ]; then
  if [ -z "$dirty" ]; then echo "$head" >"$mark"; else rm -f "$mark"; fi
  exit 0
fi
[ -z "$dirty" ] && [ -f "$mark" ] && [ "$(cat "$mark")" = "$head" ]
