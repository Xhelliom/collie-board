bump: patch

### Added
- Journal du board partagé (ADR 0048 §2/§6, lot 1) : `journal_outbox` remplie par triggers dans la transaction de chaque écriture partageable d'un dépôt partagé, `journal_field`, application des événements entrants et `rebuild` — rien pour un dépôt non partagé, pas encore branché
