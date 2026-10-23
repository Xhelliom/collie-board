bump: minor

### Added
- Routes pair d'action `/api/node/reply`, `/keys`, `/launch`, `/diff`, `/end`, derrière le jeton de `node.toml`, chaque appel tracé avec le pair appelant
- `launch` n'accepte qu'un environnement déclaré par le propriétaire, refuse tout chemin ou commande venu de l'appelant et tout dépôt dont l'autonomie est coupée ; passe par `launchAgent()` puis `promptAndConfirm()`
