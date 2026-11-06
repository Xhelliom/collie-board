bump: minor

### Added
- Une carte distante arrêtée sans PR écrit `card.remote_idle` (carte + `/api/orchestrator/since`), retiré à la reprise, à la PR ou à la fin
- La PR ouverte par une carte distante est rattachée à la carte ; son merge la termine
- Une carte distante lancée hors lot reçoit la consigne de pousser sa branche et d'ouvrir sa PR

### Fixed
- « Teach auto mode about your environment? » (dit `idle` par herdr) se lit `blocked`, et devient des boutons (« Not now »)
