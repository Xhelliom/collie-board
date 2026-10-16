bump: minor

### Added
- Conversation de l'orchestrateur : un bloc ```collie-buttons devient des boutons dont l'action est un outil MCP (ou `say`), avec aperçu, confirmation si destructif et résultat en une phrase.

### Changed
- Le catalogue des outils MCP vit dans `web/src/lib/board-tools.ts`, partagé par `bridge/mcp.ts` et le web.
