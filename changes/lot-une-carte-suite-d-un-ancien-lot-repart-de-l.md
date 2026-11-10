bump: patch

### Fixed
- Une carte suite d'une carte d'un lot fini part de la base de ce lot (la branche par défaut), plus de sa branche de lot.
- Fin de lot : une PR qui viserait une branche du board (ancien lot, carte) arrête le lot avec sa raison au lieu de le lire fusionné.
- Lot « une PR » dont une carte a démarré avant son lancement : la branche de lot est coupée au premier pli (« no such branch: null »).
