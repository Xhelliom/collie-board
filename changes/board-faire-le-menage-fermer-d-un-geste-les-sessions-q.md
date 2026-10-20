bump: minor

### Added
- Feuille « Ménage » depuis la liste des agents : panes à fermer groupés par raison (carte classée, agent terminé, au repos ≥ seuil, shell décoché), avec leur âge, fermés d'un geste confirmé
- Routes `GET /api/tidy` et `POST /api/tidy/close` (refuse `x-collie-pane`, chaque fermeture auditée `pane.close`)
