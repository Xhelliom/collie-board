bump: patch

### Fixed
- `collie-board-ctl.sh` : un `BUN_INSTALL` vide ne fait plus tester `/bin/bun` ; le test « bun hors PATH » construit un PATH sans bun au lieu de supposer que `/usr/bin` n'en a pas
