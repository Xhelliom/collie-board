bump: patch

### Fixed
- `GET /api/cost` répond du JSON : le préfixe manquait à `BOARD_PREFIXES`, la page web répondait à sa place.
- Test : toute route documentée dans le skill est routée par `isBoardPath` ou un garde de `server.ts`.
- Les sessions finies avant le déploiement sont mesurées une fois au démarrage, si leur `agentSessionId` est connu.
- Sous herdr-core, l'id de conversation d'une session vivante est retrouvé (process puis dossier) et enregistré sur la session.
- Jauge de fin de lot : une lecture fraîche attendue jusqu'au délai du CLI (plus de coupure à 10 s) ; l'échec dit sa raison dans le journal.
