bump: patch

### Fixed
- Lot : une carte en review dont le terminal a perdu son agent (hc après un redémarrage) est jugée par le lead au lieu de rester bloquée ; un renvoi au worker arrête le lot (« relancer la carte »)
- Lot : une carte en review sans verdict du lead depuis 30 min arrête le lot en « lead silencieux », reprenable par l'orchestrateur
