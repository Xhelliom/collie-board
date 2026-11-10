bump: patch

### Fixed
- Question d'un AskUserQuestion affichée en entier : une question longue s'enroule derrière une gouttière `│` (Claude Code 2.1.322) et seule sa dernière ligne était lue
- Le choix « Type something. » est une ligne de saisie dans la carte du dialogue (question simple et questionnaire à onglets) : chiffre, pointeur vérifié, texte, Entrée
- Questionnaire à onglets reconnu même quand sa question dépasse 10 lignes (il retombait sur la grammaire à une question)
- Bandeau d'écran bloquant : lu depuis la bordure haute du dialogue au lieu des 14 dernières lignes

### Upstream
- `bridge/server.ts`: `/reply` accepte `force` et passe par `sendPaneLine` (collage + Entrée en un appel) quand le moteur l'a — hc
