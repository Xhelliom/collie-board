bump: patch

### Fixed
- Une session herdr injoignable recule ses tentatives (1,5 s, doublées jusqu'à 60 s) et reprend le rythme normal dès qu'elle répond.
- Le rescan des sessions ne relit plus rien tant que les dossiers de sessions n'ont pas changé (mtime).
