bump: patch

### Fixed
- « PR & done » : une nouvelle PR ouverte par l'agent après un merge est suivie, la carte n'est plus classée « done » à tort
- Pipeline : relancer une carte dont le passage au rôle suivant a échoué reprend ce rôle, plus le rôle 0
- Pipeline : un lancement raté ferme l'onglet qu'il avait ouvert
- Verrou d'intégration : pris aussi par le `land` d'un run, le suivi « PR & done » et le nettoyage automatique (tenu : réessai au tick suivant / nettoyage sauté)
- Route d'intégration : la carte est lue sous le verrou, plus avant
- Connu, non migré : une carte démarrée avant #77 garde dans son type d'agent celui résolu par l'ancien code, que ses rôles suivants héritent — vider le type de la carte corrige (ADR 0026)
