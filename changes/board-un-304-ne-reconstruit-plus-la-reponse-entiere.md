bump: patch

### Changed
- `conditionalJson` ne sérialise plus qu'une fois (ETag et corps), gzip réutilisé
- `/api/cards` et `/api/project/facts` ne recalculent rien tant que ni la base ni les panes n'ont bougé
