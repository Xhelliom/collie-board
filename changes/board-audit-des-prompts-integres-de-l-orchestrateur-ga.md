bump: patch

### Changed
- Orchestrateur : ses prompts ne lui interdisent plus que ce que le bridge refuse (reprise d'un lot, étape suivante, lancement sous autonomie).
- Orchestrateur : un lancement refusé (403) donne sa raison ; il la cite à l'opérateur avec le réglage qui le permettrait.
- Un test garde la liste des interdictions autorisées dans les prompts.
