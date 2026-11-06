bump: minor

### Added
- Carte : bouton « Migrer vers herdr-core » pour un agent Claude au repos sous herdr 0.9 — ferme le pane, reprend la même conversation sous hc (`claude --resume`), session de carte rattachée ; si hc refuse, relancé sous 0.9 et signalé

### Fixed
- Un terminal hc force la persistance du transcript Claude (un core démarré depuis un pane Claude la coupait)
