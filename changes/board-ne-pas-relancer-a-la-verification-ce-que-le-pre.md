bump: minor

### Changed
- Le gate du dépôt (`bun run check`) saute les tests quand le pre-push les a passés sur le même commit, arbre propre ; tout écart les relance
- Le pre-push lance aussi `bun test ./scripts`, comme le gate
- Une barrière verte montre dans le journal de la carte sa dernière ligne (« tests skipped… »)
