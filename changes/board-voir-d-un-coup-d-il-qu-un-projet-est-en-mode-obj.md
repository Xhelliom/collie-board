bump: minor

### Added
- Mode objectif visible : tuile d'accueil, en-tête et bloc Objectif de la page Projet passent en vert (actif), orange (en pause) ou bleu « à valider » (dit atteint), avec une puce « Objectif »
- Le bloc Objectif actif dit que l'orchestrateur enchaîne les lots, rien à activer en plus

### Upstream
- `web/src/routes/home.tsx`: the project tiles read each repo's open objective (`useRepoGoals`)
