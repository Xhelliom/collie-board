bump: minor

### Changed
- Pane list: a space's only pane folds into its header (agent, pane tag, ctx on a meta line) instead of a separate row with its own dot.
- Pane list: every pane is written one way, `[icon] agent · p1 · ctx`; no pane count beside a space.
- Pane list: a path that only repeats the space's name is hidden; shell-only spaces and idle/shell dots step back.
- Pane list: a settled pane says how long it has sat idle / done (`· 3h ago`).
- Pane list: spaces with no agent fold behind one "N without an agent" toggle at the bottom.
- Pane list: a repo space with worktrees keeps a solid rail down to them.
