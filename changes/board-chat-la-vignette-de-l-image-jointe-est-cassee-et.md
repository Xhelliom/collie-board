bump: patch

### Fixed
- Image jointe : la vignette et l'aperçu s'affichent (URL `data:`, la CSP refusait `blob:`)
- Image jointe : le champ porte un jeton « [Image #N] » au curseur ; l'envoi le remplace par le chemin, une seule fois, séparé du texte
- Supprimer le jeton retire la vignette, retirer la vignette retire le jeton
