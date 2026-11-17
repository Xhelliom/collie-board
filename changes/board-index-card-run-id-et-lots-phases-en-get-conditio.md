bump: patch

### Changed
- Lots : index `card(run_id)` et fin de lot lue dans `run.finished_at` — `GET /api/runs` 575 → 42 ms
- Page Projet : lots et phases relus en GET conditionnel (304 quand rien n'a changé)
