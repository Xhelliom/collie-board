# Résumé

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

L'interface est **bien pensée sur le fond et sous pression sur la forme**. Le raisonnement dans le
code est d'un niveau qu'on voit rarement : le gel du miroir pendant qu'on lit, le garde-fou de
course sur les menus de prompt, la stabilisation du brouillon échoué sur la ligne `❯`, le
dé-bounce des revalidations, le respect systématique de `safe-area-inset`. Rien de ce qui suit ne
remet ça en cause.

Le problème est ailleurs, et il est **structurel** : sur l'écran pane — le seul écran qui compte —
**onze bandes de chrome** se partagent la hauteur avec le miroir, qui est pourtant la seule raison
d'ouvrir cet écran. Chaque bande a une bonne justification prise isolément. Prises ensemble, elles
laissent au contenu environ **45 % de la hauteur, et 30 % clavier ouvert**.

Les huit griefs signalés sont tous réels, et l'audit en donne la mesure et la cause :

| Signalé | Cause trouvée |
|---|---|
| Input rogné à droite et à gauche | 31 % de largeur mangée par deux boutons (§2.1) |
| Boutons trop petits | 5 cibles de 28 px, sous Apple et Material (§2.2) |
| Retours à la ligne au milieu d'une phrase | **double wrap** : herdr coupe à 81 colonnes, le CSS recoupe à 50 (§3.1) |
| Tableaux disloqués | même double wrap, plus le parseur qui les exclut explicitement (§3.2) |
| Le drawer scintille et se ferme tout seul | **trois bugs distincts**, aucun couvert par un test (§7.1-7.3) |
| Le mouvement du drawer est trop linéaire | **aucune animation de fermeture**, ni vélocité, ni courbe choisie (§7.5) |
| Pas de mode desktop | `max-w-screen-sm` sur les 5 routes ; 8 colonnes de board à regrouper (§F) ; feuilles à ouvrir par la droite (§E7) |
| Board et sessions ne disent pas la même chose | le contexte n'est calculé que pour les panes nés d'une carte (§8) |

Il relève en plus **dix problèmes non signalés**, dont un de gravité supérieure à tous les autres :
**la suppression d'une carte se fait en un tap, sans confirmation**, dans une application où tous
les autres gestes destructeurs — bien moins graves — en demandent deux.

Deux constats orientent les corrections. D'abord, **une bonne partie de ce qui manque existe déjà**
et n'est pas branchée : le rendu Markdown propre (`TranscriptView`, enterré et figé), la jauge de
contexte (montée sur un seul écran sur quatre), et jusqu'à `pane.read source: "recent-unwrapped"`
côté herdr, déclaré et jamais appelé. Ensuite, **les bugs les plus visibles sont les moins chers** :
les trois défauts du drawer tiennent en une trentaine de lignes dans un seul fichier.

---
