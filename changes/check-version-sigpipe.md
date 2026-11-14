bump: patch

### Fixed
- La mise à jour n'échoue plus en silence : check-version.sh ne lit plus le CHANGELOG via `| head -1` (SIGPIPE, code 141).
- Une étape de build qui échoue nomme l'étape et son code.
