# Bilan

**Fait** : repli (CollapsibleText) appliqué sur spec, critères, bilan, journal, détail de roadmap, raisons lead/tri (commits précédents). Cette passe corrige deux tests qui ne gardaient rien :
- `project-step.test.tsx` : cible maintenant le repli de la spec elle-même (via son texte), vérifie « Voir plus » puis le dépliage « Voir moins ».
- `card.test.tsx` : nouveau cas (`scrollHeight` mocké) avec un « Voir plus » sous la spec, les critères et `r.notes`.

Les deux tests échouent bien quand on retire le repli (vérifié par mutation, code restauré).

**Checks** : tsc racine + web OK ; `web` vitest 1647/1647 verts.
**Reste** : rien. Le fragment `changes/` existe déjà (bump: patch).
