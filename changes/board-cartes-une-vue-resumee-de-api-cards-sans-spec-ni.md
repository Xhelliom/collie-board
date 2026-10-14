bump: minor

### Added
- API : `GET /api/cards?view=summary`, la liste sans spec, critères ni dictée, et seulement les cartes done encore utiles à l'écran, avec les compteurs (livrées sur 7 jours, done par dépôt et par phase) ; la route sans paramètre est inchangée

### Changed
- Accueil et Board lisent la vue résumée (236 → 26 Ko gzip sur 433 cartes) ; le Board charge la liste complète pour un filtre tag / auto / phase ou « Voir les n autres »
