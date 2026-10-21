bump: patch

### Fixed
- « Fusionner » sur une carte dont la PR est ouverte fusionne la PR sur GitHub, plus jamais en local
- Fusion locale refusée si `origin` a des commits absents de la branche ou de la base ; la base est poussée, et un push refusé annule la fusion sans classer la carte
- La vue d'une carte porte `prUrl`, l'url de sa PR lue au journal
