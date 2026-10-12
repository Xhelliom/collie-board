bump: patch

### Fixed
- Geste PR/merge/resolve : délai client de 3 min (le hook pre-push dépassait 20 s) ; au timeout, « toujours en cours… » et la carte se relit au lieu d'un échec « signal timed out »
