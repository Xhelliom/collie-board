bump: minor

### Added
- Vue projet : un bandeau compte les étapes terminées hors de toute phase validée et les valide d'un coup (« Valider tout ce qui est terminé… ») ; chaque ancienne dictée a son bouton « Valider cette phase », nommé d'après elle

### Fixed
- Le bouton de validation n'existait que sur « Sans phase » et ne comptait pas les étapes rangées dans une dictée : un vieux projet ne pouvait pas être remis à zéro ; valider ne range plus la carte conteneur comme une étape
- Une fois une phase validée, les autres dictées restent des sections au lieu de disparaître
