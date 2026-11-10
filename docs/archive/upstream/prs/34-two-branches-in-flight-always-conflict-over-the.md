# 34. 🔵 Two branches in flight always conflict — over the version, not the code

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Every functional change used to cut its release on its own branch: the three version files and a new
`## [x.y.z]` at the top of `CHANGELOG.md`. Two branches open at once edit the same line of four files
and pick the same number, so the second to merge conflicts whether or not its code touches the
first's. Upstream has the same rule, and so the same conflict on any two PRs open together.

| | |
|---|---|
| Commit | `4774e73` *feat(release): la version se coupe sur main, en CI, à partir de fragments* |
| Files | `scripts/release.ts` + test, `scripts/release-notes.sh`, `scripts/git-hooks/pre-commit`, `.github/workflows/release.yml`, `changes/README.md`, `CLAUDE.md` → *Versioning*, `package.json` (test script) |
| Extraction | **Clean**, but it changes upstream's working agreement — propose it as a question before a PR. Drop the ADR link (the fork's numbering) and the `herdr.collie-board` id in the notes. |

A branch drops `changes/<slug>.md` (`bump:` line + Keep a Changelog bullets) and never touches a
version. After a green CI on `main`, `scripts/release.ts` folds the fragments into one entry — biggest
bump, each bullet citing the commit its fragment came in with — aligns the three files and deletes
the fragments; the workflow commits, pushes the tag atomically with it and creates the GitHub
Release, since a tag pushed with `GITHUB_TOKEN` starts no workflow of its own. The pre-commit hook
enforces both halves and keeps the hand-cut bump for a hotfix committed on `main`.

---
