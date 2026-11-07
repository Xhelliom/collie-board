bump: patch

### Fixed
- Lot : une carte réglée sur l'environnement d'un pair démarre sur ce pair (comme son bouton) au lieu d'arrêter le lot
- Lot : cette carte livre sa propre PR, suivie jusqu'au merge ; la dernière carte locale ouvre la PR du lot sans l'attendre ; un arrêt sans PR sur le pair halte le lot

### Upstream
- `bridge/index.ts`: le `PeerStore` est construit ici, passé à `startServer` et au `runHook` (les pairs, pour un lot)
- `bridge/server.ts`: reçoit le `PeerStore` en option au lieu de le construire
