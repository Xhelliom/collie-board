bump: patch

### Changed
- Page projet : ne lit que les facts de son dépôt (`/api/project/facts?repo=`), en GET conditionnel (304 quand rien ne bouge)
