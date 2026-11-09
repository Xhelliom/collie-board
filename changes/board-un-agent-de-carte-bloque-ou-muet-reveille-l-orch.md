bump: minor

### Added
- Une carte de lot dont l'agent est bloqué, inactif ou disparu depuis 10 min réveille l'orchestrateur (titre, état du pane, fin d'écran), une fois par épisode

### Upstream
- `bridge/index.ts`: one more `engine.onUpdate` hook, `stuckCards` (`stuck-card.ts`) — fork-only
