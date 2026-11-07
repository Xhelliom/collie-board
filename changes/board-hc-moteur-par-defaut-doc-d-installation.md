bump: minor

### Changed
- Un nouveau lancement va sous herdr-core (hc) dès que son core répond, sous herdr 0.9 sinon (`COLLIE_BOARD_MUX=auto`, le nouveau défaut)

### Added
- Le bouton Démarrer d'une carte dit quand hc ne répond pas et que le lancement se fera sous herdr 0.9
- Sous Windows, le bridge trouve le named pipe de hc sans réglage
- Doc d'installation de hc (Linux, Windows) : core démarré par herdr-app ou le bureau, jamais par un agent
