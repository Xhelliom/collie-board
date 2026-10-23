bump: patch

### Changed
- Hook « depuis » de l'orchestrateur en Bun (`since-hook.ts`, plus de `jq`) : remplacer `since-hook.sh` par `bun ~/.claude/skills/collie-board/since-hook.ts` dans `~/.claude/settings.json`

### Fixed
- Windows : la galerie lit les scratchpads sous `%TEMP%\claude`, la jauge d'usage trouve `claude.exe`
