bump: minor

### Added
- Board partagé : lancer une carte (local, lot, « Lancer sur » un pair) pousse d'abord sa réservation `card.claimed` ; un seul pair gagne (ADR 0048 §7)
- Carte prise par un autre pair : « Démarrer » grisé avec « Prise par X à HH:MM », et « Reprendre la main » confirmé (`POST /api/cards/<id>/claim`)
- Hors ligne, seule une carte assignée à soi se lance sur un dépôt partagé
