bump: minor

### Added
- Carte classée dont la PR est devenue conflictuelle : « Reopen with an agent » restaure la branche depuis origin et relance un agent sur la résolution, « Update PR #N & done » pousse le résultat (ADR 0014) (cee4769)
- Écran « Open PRs » (bouton dans l'en-tête du board, lien dans la colonne Done) : les PR encore ouvertes, vérifiées à la demande — conflit, mergeable, ou GitHub qui calcule encore (9137a5e)

### Changed
- La version se coupe sur main, en CI, à partir des fragments de `changes/` ; une branche n'en coupe plus (ADR 0016)
