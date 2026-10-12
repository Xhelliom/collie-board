bump: minor

### Added
- Page carte : frise verticale de jalons dérivée du journal (démarrée, gate, lead, renvois repliés, review, PR ouverte/fusionnée, terminée)
- Pastilles de jalons sur la tuile de carte et les étapes projet (`/api/project/facts` renvoie `milestoneEvents`)

### Changed
- `/api/project/facts` : `repo` devient optionnel (sans lui, toutes les cartes) ; le board charge les facts avec ses cartes

### Fixed
- Frise et pastilles : « Terminée » vient du passage de la carte à `done` ; jalons dérivés de tout le journal, non plafonné
