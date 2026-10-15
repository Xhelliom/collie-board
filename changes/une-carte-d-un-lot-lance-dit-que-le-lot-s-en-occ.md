bump: minor

### Added
- Carte d'un lot lancé : puce « Lot · <nom> » et étape du lot (en cours, relecture, merge) sur la tuile, l'étape projet et l'écran carte
- Écran carte : bandeau « le lead s'en occupe » avec lien vers le lot et la PR du lot ; gestes d'intégration repliés derrière « Reprendre la main »
- `/api/runs` et le détail carte exposent `finished` et `prUrl` ; `/api/project/facts` porte le lot actif d'une carte

### Fixed
- « à fusionner à la main » ne s'affiche plus tant qu'un lot en cours va fusionner la carte
