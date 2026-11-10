bump: minor

### Added
- Mode objectif : pas de push par fin de lot, le bilan de l'orchestrateur va au journal de l'objectif
- Point d'étape regroupé (lots, mergées, bloquées, quota, recettes) à mi-budget, budget atteint, objectif déclaré, décision
- Bloc Objectif : barre de budget consommé, progression et journal des bilans et points d'étape

### Upstream
- `bridge/index.ts`: un `engine.onUpdate` de plus, `goalWatch` (`goal-mode.ts`), et `goalOpen` passé à `lotHoldsPush` — fork-only
