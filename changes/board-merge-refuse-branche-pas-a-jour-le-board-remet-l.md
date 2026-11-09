bump: patch

### Fixed
- Merge refusé car la branche n'est pas à jour : le board la met à jour (`gh pr update-branch`) et merge une fois la CI verte, au lieu de halter
- Une attente GitHub (checks, mergeabilité) de plus de 3 h halte avec sa raison : plus de PR de lot en attente silencieuse
