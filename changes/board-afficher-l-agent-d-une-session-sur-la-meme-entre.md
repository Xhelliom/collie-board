bump: minor

### Changed
- Pane list: a space's only pane folds into its header (agent, pane tag, ctx on a meta line) instead of a separate row with its own dot.
- Pane list: every pane is written one way, `[icon] agent · p1 · ctx`; no pane count beside a space.
- Pane list: a path that only repeats the space's name is hidden; shell-only spaces and idle/shell dots step back.
