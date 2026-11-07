bump: patch

### Fixed
- Réglages → Mises à jour annonce une nouvelle version sur Windows : sans `COLLIE_BOARD_UPDATE_REPO`, le dépôt vient de l'`origin` GitHub du checkout (`off` coupe la vérification)
- `start` / `status` sous Windows affichent le dépôt que lit la vérification

### Upstream
- `bridge/index.ts`: the update repo from `resolveUpdateRepo()` (env, else the checkout's GitHub origin) — fork-only
- `bridge/update.ts`: `resolveUpdateRepo()` + `githubRepoOf()` / `originUrlOf()`, reading `.git/config` as a file — fork-only
