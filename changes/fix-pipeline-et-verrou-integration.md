bump: patch

### Fixed
- Pipeline : chaque rôle tourne avec son propre type d'agent ; le type résolu au démarrage n'est plus écrit sur la carte (ADR 0026)
- Pipeline : un lancement raté ne compte plus le pas et ne laisse plus de session ouverte sur un pane shell
- Intégration : un second geste (PR, merge…) sur une carte déjà en cours d'intégration répond 409 « déjà en cours »
- Suivis du copilote : nés sur la base réelle de la carte relue, plus sur la branche du prédécesseur
