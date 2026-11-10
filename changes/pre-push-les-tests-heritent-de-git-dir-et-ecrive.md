bump: patch

### Fixed
- pre-push : les suites de tests tournent sans aucune variable `GIT_*` héritée de git — un test qui oublie `gitFreeEnv` n'écrit plus dans le dépôt poussé
