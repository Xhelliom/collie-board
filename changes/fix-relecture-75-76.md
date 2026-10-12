bump: patch

### Fixed
- PR ouverte par l'agent (`pr_updated` seul) : son merge est journalisé, la carte d'un lot est classée, ses dépendantes rebasées, « PR et terminé » la suit
- `pr_merged` n'est plus journalisé deux fois quand l'écran de carte voit le merge pendant celui du board
- Base par défaut : un `origin/HEAD` sur une branche `board/…` (préfixe configuré) retombe sur `main`/`master`
- `card.base_moved` n'est plus émis après un merge local ni après un discard
