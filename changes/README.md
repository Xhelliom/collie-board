# changes/

One file per change waiting for a release — [ADR 0016](../.adr/0016-the-version-is-cut-on-main-by-ci.md).
A branch never bumps the version or writes `CHANGELOG.md`: it adds `changes/<slug>.md` here, a file
no other branch can conflict with. After a green CI on `main`, `scripts/release.ts` folds every
fragment into one CHANGELOG entry, takes the biggest bump, aligns the three version files, cites the
commit each fragment came in with, deletes the fragments and tags the release.

```
bump: minor

### Added
- Écran « Open PRs » : vérifie à la demande si chaque PR ouverte merge encore
```

- First line: `bump: patch|minor|major` — the SemVer rules in `CLAUDE.md` still decide which.
- Then `### Added` / `### Changed` / `### Fixed` (Keep a Changelog), one `- ` line per change,
  super crisp. The commit hash is added for you; don't write one.
- Name it after the branch's slug so two branches never pick the same file.
