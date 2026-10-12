bump: patch

### Fixed
- A git test no longer runs on the real repository when launched from a hook (it flipped `core.bare` and corrupted worktree indexes).
