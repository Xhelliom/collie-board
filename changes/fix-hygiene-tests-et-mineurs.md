bump: patch

### Changed
- Gates run one at a time bridge-wide; a queued gate's timeout starts when it runs (ADR 0020 note).
- Tests share one git-free env (`scripts/test-env.ts`) instead of four copies of the `GIT_DIR` strip.
- `hasLanded` and `landedStat` read the same journal window as the run (`EVENT_WINDOW`, 200).
- `listPrEvents` reads only each card's current PR, not the whole PR history, every tick.

### Fixed
- An unknown i18n key shows the key instead of crashing the screen; session outcome labels are checked against the bridge's list.
