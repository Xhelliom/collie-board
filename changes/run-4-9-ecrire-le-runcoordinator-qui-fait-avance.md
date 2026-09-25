bump: minor

### Added
- Runs : `RunCoordinator` (`bridge/run.ts`) démarre les membres par slot et dans l'ordre, fait trancher le lead à chaque atterrissage, ouvre la PR puis classe la carte ; halte après 5 tours
- Journal de carte : `run.triaged` (verdict de la revue accepté ou non, avec la raison) ; un follow-up jeté est nommé
