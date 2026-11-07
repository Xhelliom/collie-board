bump: patch

### Fixed
- Le lead n'envoie plus de notification après un redémarrage du bridge : son pane est adopté au tick suivant, plus à sa première requête
- Le lead est exclu du toast du client et des alertes relayées depuis un pair, comme le copilote
- Cloche : plus de « Copilot review » pour une carte d'un lot (le lead la juge), ni pour un verdict `complete`

### Upstream
- `bridge/server.ts`: the snapshot's `leadPaneId`, and `/api/node/snapshot` carries `boardPaneIds` — fork-only
- `bridge/types.ts`: `SnapshotResponse.leadPaneId` — fork-only
- `web/src/lib/types.ts`: `SnapshotResponse.leadPaneId` — fork-only
- `web/src/lib/loaders.ts`: `HomeData.leadPaneId` — fork-only
- `web/src/routes/root.tsx`: hands `leadPaneId` to `useAgentTransitions` — fork-only
- `web/src/hooks/use-transitions.ts`: skips the lead's pane like the copilot's — fork-only
