bump: minor

### Changed
- `POST`/`PATCH /api/cards` refusent un champ inconnu (400 qui nomme le champ voulu, ex. `description` → `spec`) au lieu de l'ignorer

### Added
- Une carte créée sans `spec` ni `rawInput` répond avec `warnings` : l'agent partirait sans brief
