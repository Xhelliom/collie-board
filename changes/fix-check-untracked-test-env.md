bump: patch

### Fixed
- The untracked-files test no longer runs git on the real repository from the pre-push hook (it set `core.bare` and overwrote worktree indexes).
