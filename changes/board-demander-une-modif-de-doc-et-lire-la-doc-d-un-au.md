bump: minor

### Added
- Documents : bouton « Demander une modif » sur un document — crée une carte (fichier + demande) ; l'agent fait la PR, le board n'écrit pas le dépôt.
- MCP : outil `read_project_docs` — liste par rubrique et lecture d'un fichier de la doc d'un projet connu, en lecture seule.

### Changed
- Routes `/api/docs*` : lisent tout dépôt connu du board ; un chemin inconnu est refusé (403).
