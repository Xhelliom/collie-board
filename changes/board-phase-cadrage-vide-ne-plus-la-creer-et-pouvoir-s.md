bump: minor

### Added
- Page projet : « Supprimer la phase » sur une phase vide (ni carte ni lot), confirmée d'un second tap en place.

### Changed
- `DELETE /api/phases/<id>` refuse une phase non vide (409 « phase is not empty »).
- Le prompt de l'orchestrateur ne crée plus de phase de board pour le Cadrage : seulement l'item de roadmap.
