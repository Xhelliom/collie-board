bump: minor

### Added
- Agent déjà dans son état au démarrage du bridge : `statusSinceAtLeast` (première observation), affiché « depuis au moins … ».
- Sous hc, `statusSince` exact dès la première observation, lu sur le `status_ms` du terminal (survit au redémarrage du bridge).
