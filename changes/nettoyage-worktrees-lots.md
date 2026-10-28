bump: patch

### Fixed
- Nettoyage : un worktree de carte dont le board a posé le travail (PR fusionnée ou lot) est enfin supprimé, même avec un commit postérieur (bilan, squash)
- Un nettoyage refusé laisse une trace (`card.cleanup_refused`) au lieu de rester silencieux
