bump: minor

### Added
- Pages custom du projet : un onglet par `docs/pages/<nom>.html` de main, affiché inerte (iframe sandbox, sans script ni réseau)
- Bouton plein écran sur une page custom, sortie par le bouton ou Échap
- Routes `GET /api/docs/pages` et `/api/docs/page` : la page sert sous sa propre CSP sandbox, celle du board inchangée
