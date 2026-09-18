# 0016 — The version is cut on main by CI; a branch only drops a fragment

**Status:** Accepted
**Date:** 2026-09-18

## Context

The versioning rule inherited from upstream makes every functional change cut a release **on its
own branch**: bump `herdr-plugin.toml`, `package.json` and `web/package.json`, and add a
`## [x.y.z]` entry at the top of `CHANGELOG.md`. Two branches in flight at the same time therefore
edit the same line of four files and pick the same next number. They conflict whether or not their
code touches.

The board runs several cards at once, so this is the common case. ADR 0014 measured it on this
repository: every one of the last 10 conflict resolutions touched `CHANGELOG.md`, and 4 of them also
touched the three version files. Each one cost an agent turn, and for a PR, a card reopened after
it was filed.

## Decision

**A branch never cuts a version.** It adds `changes/<slug>.md`: a first line
`bump: patch|minor|major`, then Keep a Changelog sections with one `- ` line per change. A file of
its own cannot conflict with another branch's.

**`main` cuts the release, in CI, after a green build.** `.github/workflows/release.yml` runs on the
`CI` workflow's success for a push to `main`. `scripts/release.ts` then folds every waiting fragment
into one entry, takes the biggest bump, cites the commit each fragment came in with, aligns the three
files and deletes the fragments. The workflow commits `chore(release): x.y.z`, pushes it atomically
with an annotated `vX.Y.Z` tag, and creates the GitHub Release. No fragment means no release.

**The pre-commit hook enforces both halves.** On a branch, a functional commit needs a fragment,
staged or already on the branch, and a version cut is refused. On `main`, a fragment is enough, and
a hand-cut bump is still accepted, so a hotfix committed directly on `main` keeps working.

## What this rules out

**"Keep bumping on the branch, and let the resolving agent settle the conflict."** That is the rule
this replaces. Settling the same four-file conflict on every second branch is the cost it was
measured to have.

**"Bump on main by hand after the merge, without fragments."** The person who cuts the release is
not the agent that wrote the change. The CHANGELOG line would be written from `git log`, after the
fact, by whoever happens to release.

**"Cut the release locally, in a merge hook."** A hook that commits behind the operator's back is
worse than one that refuses. It would also leave the PR path, which merges on GitHub, uncovered.

**"Let the tag's own workflow create the GitHub Release."** A tag pushed with `GITHUB_TOKEN` starts
no workflow. So the job that pushes the tag also creates the Release. The tag-triggered job stays for
tags pushed by hand.

## Consequences

- `origin/main` gets a commit the local `main` doesn't have, the release commit. The next card start
  fast-forwards to it (ADR 0015). But a local merge not yet pushed makes the two diverge, and the start
  is refused until `main` is pulled and pushed. Pull after pushing a merge.
- Several merges can ship as one release: every fragment waiting at the green run goes out together.
- The GitHub Actions bot must be allowed to push to `main`. Branch protection that requires a PR for
  every push blocks the release, and the job fails on the push.
- The fork now diverges from upstream on the versioning gate: `CLAUDE.md` says so where it lists what
  still applies verbatim.
- **What would justify revisiting:** releases failing on the push (a protected `main`, or a race
  with a push made meanwhile) often enough to matter. That would argue for a release PR instead of a
  direct push.
