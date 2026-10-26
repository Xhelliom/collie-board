bump: patch

### Added
- Synchro du board partagé (ADR 0048 §3, lot 3) : `bridge/journal-sync.ts` sur `engine.onUpdate`, sans minuteur — une opération git en vol par dépôt, fetch ≤ 60 s, envoi ≤ 10 s après une écriture, non-fast-forward refait au tick suivant
- Dépôt en lecture seule pour ce pair après un refus de droits : les routes d'écriture de ses entités répondent 403 avec la raison
- `GET /api/repos` : champ `sync` (non envoyés, lecture seule, hors ligne) pour les dépôts partagés
