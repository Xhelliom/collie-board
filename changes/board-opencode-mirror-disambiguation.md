bump: patch

### Fixed
- Seules les sessions OpenCode racines sont candidates en dossier partagé : les sous-agents (sessions filles, même dossier) ne portent jamais un pane — la vue suivait sinon un fil mort à la fin du worker.
