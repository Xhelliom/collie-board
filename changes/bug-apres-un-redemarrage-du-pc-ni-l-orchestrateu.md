bump: patch

### Fixed
- Après un redémarrage, l'orchestrateur reprend sa conversation (`claude --resume`), même muet toute la nuit
- « Démarrer l'orchestrateur » reprend sa dernière conversation au lieu d'en ouvrir une neuve (sauf `/exit`)
- Un agent n'est plus laissé « endormi » qu'après 72 h sans message (12 h écartait une nuit)

### Changed
- Le journal du bridge dit, pour chaque terminal perdu : repris, fini ou endormi, et pourquoi
