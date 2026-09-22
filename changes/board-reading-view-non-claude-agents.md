bump: minor

### Added
- Vue lecture (et Historique) pour les panes OpenCode : conversation lue depuis la session db (`session_message`), même rendu que les transcripts Claude.
- Raison `unsupported` sur l'historique de pane : un agent sans transcript lisible le dit au lieu d'affirmer que le pane n'a pas de session.

### Fixed
- La vue lecture d'un pane OpenCode répondait « This pane has no agent session » alors que l'agent tournait avec une conversation sur disque.
- Les opérations git du bridge ignoraient un `GIT_DIR` ambiant (exporté par les hooks git) au lieu du `cwd` demandé ; le runner et les fixtures de tests purgent désormais les variables de localisation.
