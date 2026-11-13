bump: patch

### Fixed
- Un redémarrage du bridge pendant l'export du plan ne perd plus la PR docs(plan) : au démarrage, les lots finis sans export réussi sont réexportés (une fois par dépôt, rattrapage compris).
- Un échec d'export est journalisé dans le journal du lot (`plan.exported`) en plus du log.
