bump: patch

### Changed
- Pokes du flux d'événements herdr regroupés : au plus un poll moteur par seconde, plus un rattrapage en fin de fenêtre
- `/api/diag/routes` mesure chaque abonné `engine.onUpdate` (`onUpdate <nom>`), le décodage du flux (`events stream`), les événements par type et les pokes
