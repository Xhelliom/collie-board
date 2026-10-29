bump: minor

### Added
- Board partagé : un lot porte `createdBy`/`createdPair` dérivés ; seul le pair créateur le lance, le reprend, le pilote et le pousse (ADR 0048 §7)
- Fin de lot partagée : `finished_at` journalisé quand le coordinateur du créateur termine le lot — les autres pairs le voient terminé
- UI : boutons « Lancer ce lot » / « Reprendre » grisés avec « Lot de X — seul son créateur… » ; « en cours chez X » sur le lot et la carte
- Un agent (orchestrateur) est refusé (`403`) sur une carte assignée à un autre et sur le lot d'un autre
