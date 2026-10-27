bump: minor

### Added
- Un seul troupeau : `GET /api/herd` sert les agents des pairs pilotés (lus ≈ 5 s sur `engine.onUpdate`), un pair injoignable marqué `disconnected` seul
- `/api/herd/<pair>/pane/<paneId>` (+ `/reply`, `/keys`) relaie lecture, réponse et touches vers `/api/node/*` du pair, mêmes gardes que les routes locales
