bump: minor

### Added
- Le worker écrit un bilan (`.board/bilan.md`) en s'arrêtant ; le lead le reçoit et le juge avec le diff

### Fixed
- Diff vide + bilan « déjà livré » vérifiable dans main : terminé sans renvoi ; diff vide sans bilan : renvoi qui le réclame (journalisé `run.decision`)
