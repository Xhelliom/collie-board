bump: minor

### Added
- « En main » : écrire à un worker depuis l'appli (ou « Je le prends ») gèle le lead sur cette carte — ni jugement, ni consigne, ni fermeture ; le reste du lot continue (ADR 0058)
- « Rendre au lead » : il reprend sur l'état courant, sans consommer de round
- 1 h sans message : rappel dans la cloche ; 2 h : rendu au lead tout seul, notifié
- Un pane agent qui écrit à un worker en main reçoit 409 ; puce « En main » sur la carte, le lot et le pane

### Upstream
- `bridge/server.ts`: one import and one block before `reply`/`keys` — the operator's message takes the pane's card (`bridge/held.ts`), an agent's is refused 409 — fork-only
- `bridge/types.ts`: `AgentView.held` — fork-only
