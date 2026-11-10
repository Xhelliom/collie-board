bump: minor

### Added
- Des commits arrivés sur la branche d'une carte déjà mergée sont signalés : `card.late_commits` sur la carte, cloche, et message à l'orchestrateur du dépôt

### Changed
- Un lot ne merge plus une branche qui a bougé depuis le verdict du lead (`run.moved`) : gate et lead la rejugent
- Le tap Merge (et « PR & done ») est refusé tant que l'agent de la carte travaille

### Upstream
- `bridge/index.ts`: un `engine.onUpdate` de plus, `lateCommits` (`late-commits.ts`) — fork-only
