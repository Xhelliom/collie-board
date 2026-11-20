bump: minor

### Added
- Page Agents → « ⋯ » → « Agents du board » : le lead et le copilote avec leur état, « Ouvrir » et « Redémarrer » (deux touches, la confirmation dit qu'une revue en cours sera coupée).
- Route opérateur `POST /api/board/agents/restart` : ferme le lead ou le copilote, relancé à sa prochaine demande ; refusée à un `x-collie-pane`.
