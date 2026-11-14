bump: patch

### Fixed
- Fin de lot sous autonomie sans lot planifié : l'orchestrateur prépare le suivant (et le lance lui-même si « Peut démarrer un lot quand rien ne tourne ») au lieu de « Ne lance rien ».
- Prompt de l'orchestrateur : les deux exceptions au « tu ne lances pas » (objectif actif ; autonomie qui peut démarrer quand rien ne tourne) sont données d'emblée.
