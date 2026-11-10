bump: patch

### Fixed
- Sous hc, le nettoyage d'une carte ferme les terminaux restés dans son worktree (une carte « done » n'a plus de session ouverte pour nommer son pane)
- Une fermeture de pane refusée autrement que « pane inconnu » est inscrite sur la carte (`card.cleanup_failed`, étape `pane`)

### Added
- Balayage au démarrage : `git worktree prune`, worktree propre d'une carte done/archivée retiré avec ses terminaux hc, worktree sale signalé une fois sur la carte

### Upstream
- `bridge/index.ts`: un `engine.onUpdate` de plus, `worktreeSweep` (`worktree-sweep.ts`), qui ne tourne qu'au premier snapshot connecté — fork-only
