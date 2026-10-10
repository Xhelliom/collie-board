bump: minor

### Added
- Templates d'agent (ADR 0026) : un rôle = brief + agent + modèle, appliqué au démarrage d'une carte (celui de la carte, sinon de sa phase) ; cinq fournis (implémenteur, relecteur, doc, exploration, correctif), réinitialisables
- Créer un template dans l'app, avec le copilote qui rédige le brief à partir d'une description ; importer les `.claude/agents/*.md` d'un dépôt sur confirmation, jamais automatiquement
- Le modèle d'un template passe en option du CLI pour `claude` seulement (`model_flag` dans `agents.toml`) ; les autres agents l'ignorent et l'écran le dit
- Sélecteur de template sur la carte et dans « Nouvelle carte » ; `templateId` sur une carte et sur une phase ; le journal note le template utilisé
