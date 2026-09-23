bump: minor

### Added
- Galerie : les documents Markdown/HTML du scratchpad (`/tmp/claude-<uid>/…/scratchpad/`) sont listés et lisibles depuis le téléphone — Markdown rendu, HTML frotté (règle partagée `bridge/scrub.ts`) et sandboxé, via le lecteur `DocViewer` commun aux deux surfaces.
- Galerie : extraction du scrub HTML en `bridge/scrub.ts` et du lecteur de documents en `web/src/components/artifact-viewer.tsx`, partagés entre artefacts du worktree et galerie du scratchpad.

### Fixed
- Artefacts de session : les dossiers de dépendances, build et caches (`node_modules/`, `dist/`, `coverage/`, `.venv/`, …) et le scratch `.board/` ne produisent plus de faux artefacts — ni via l'expansion des dossiers non commités, ni via les fichiers seulement lus/mentionnés.
