# Tri de la recette de collie-board — 15/11/2026

## La question

Parmi les entrées « à tester » de la Recette de collie-board, lesquelles décrivent encore l'interface
actuelle ? Il fallait réécrire celles dont une étape est devenue fausse, mettre de côté celles dont la
fonction n'existe plus, et faire se suivre les étapes qui se testent dans le même geste. Aucun verdict
n'est posé : il appartient à l'opérateur.

## Avant / après

| | Avant | Après |
|---|---|---|
| Entrées « à tester » | **167** | **165** une fois les 2 mises de côté appliquées (voir *En attente*) |
| Entrées réécrites | — | **28** (étapes périmées) + **5** (enchaînées) |
| Verdicts posés | — | **0** (le seul verdict existant, « ok » sur l'étape 1 de *Style Sémaphore*, est conservé) |

Méthode : chaque étape des 167 entrées a été confrontée au code de `web/src` sur `main` (libellés
`i18n`, composants) et à l'historique des cartes. Dans le doute, l'entrée est restée telle quelle :
seul ce qui est prouvé faux a changé. 137 entrées sont justes.

## Mises de côté (2)

| Entrée | Pourquoi |
|---|---|
| Parcourir les documents d'un projet par rubrique sans tout faire défiler | Rubriques, puce « Autres » et « Voir les N décisions » ont disparu. La page Documents est devenue un explorateur, déjà testé par « Parcourir la doc d'un projet comme dans un explorateur de fichiers ». |
| herdr-core en lecture derrière `COLLIE_BOARD_MUX` | La bascule n'existe plus : hc est lu en continu. C'est testé par « Voir les agents herdr-core rangés par projet ». |

## Réécrites — étape devenue fausse (28)

La capacité existe toujours, mais un libellé ou un écran a changé.

| Capacité | Ce qui avait changé |
|---|---|
| Autoriser un autre poste à lancer des cartes sur cette machine | Le droit ne se donne plus dans Réglages → Pairs mais par une case dans les réglages du projet |
| Déclarer un environnement et tester la connexion à un pair | L'environnement se déclare dans les réglages du projet (« Offrir ce dépôt aux autres postes ») |
| Coller ou joindre une capture puis l'envoyer | Le champ montre un jeton « [Image #N] » ; le chemin ne part qu'à l'envoi |
| Voir les écarts de la doc et lancer sa mise aux normes | Le « Bilan de doc » est replié quand il y a des écarts : il faut d'abord le déplier |
| Mettre la doc aux normes sans référence à un autre projet | Même chose : le bouton est dans le Bilan replié |
| Parcourir la doc comme dans un explorateur | Le dossier s'appelle « Décisions (N) », plus « Décisions roadmap (N) » |
| Suivre les 4 critères de sortie de herdr 0.9 | Les critères sont repliés sous « Conditions de départ : N sur 4 tenues » → « Voir » |
| Retrouver ses épinglés sur l'Accueil du téléphone | Le titre « Épinglés » ne se replie plus |
| Voir les agents herdr-core rangés par projet | « Troupeau » et l'onglet « Espaces » n'existent plus : c'est la page Agents |
| Voir et piloter ensemble les agents herdr 0.9 et herdr-core | Même chose : « Troupeau » → page Agents |
| Ouvrir un agent ou un terminal depuis la page Projet | Même chose : « Troupeau » n'existe plus |
| Savoir ce que fait chaque bouton de recette | « Ça marche / Ça ne marche pas » → « C'est bon / Pas bon / Passer » |
| Lire et cocher la recette sans ouvrir les cartes | La Recette est une chronologie : plus de « Faire / Attendu » ; « Pas bon » crée seul la carte de correction |
| Changer de vue du board sur téléphone | Les onglets en icône seule sont devenus une rangée adaptative avec un menu « Plus » |
| Voir le board en style Sémaphore ou Classique | Le réglage Style / Classique n'existe plus : l'étape 5 est retirée |
| Voir le style Sémaphore en vraies couleurs d'état | « Au travail » est bleu, plus ambre : l'étape des titres bleus est retirée |
| Lire une page sur mesure depuis le téléphone | Une page n'est plus un onglet d'office : il faut cocher « En onglet » dans Documents › Pages |
| Lire la documentation du projet depuis le téléphone | La page Documents est un explorateur de dossiers |
| Lire une doc collie-board rangée selon la convention | UPSTREAM.md n'est plus signalé trop gros |
| Choisir le mode de fusion d'une PR | « Merge commit » → « Commit de fusion » |
| Voir qu'un projet tourne en mode objectif | Plus de tuile verte ni de puce « Objectif · actif » : une cible et la première phrase |
| Fixer un objectif au projet | « Pause » → « Mettre en pause » |
| Lire la sortie d'un agent en plein écran | Plus d'icône en haut : menu ⋯ → « Sortie en plein écran » |
| Répondre en mode lecture à un écran qui retient l'agent | La touche du bandeau s'appelle « Esc » |
| Lire la roadmap du projet | Plus d'entrée « Board » dans la navigation : on passe par Projets |
| Voir clos un lot fait à la main | « Lancer le lot » → « Lancer ce lot » |
| Reconnaître ses projets par leur nom sous Windows | Le sélecteur de projet est dans le titre, plus dans les onglets |
| Voir où en est chaque projet depuis l'accueil | Plus de ligne « Orchestrateur » : une colonne d'activité (au repos, N au travail, N pour toi…) |

Une étape réécrite perd son identifiant, donc tout verdict qu'elle aurait eu. Les étapes inchangées gardent le leur.

## Réécrites — enchaînées dans un même geste (5)

Seule la première étape de l'entrée qui suit change : elle part de l'écran où la précédente s'arrête.
Les cartes restent distinctes.

- Page Agents : *Voir ses agents par projet* → *Voir sur quoi travaille chaque agent*
- Page Projet : *Voir les totaux de tokens du projet* → *Voir combien de tokens un lot, une phase… ont consommé*
- Recette : *Vérifier ce qui a été livré sur une chronologie* → *Mettre de côté une étape ancienne*
- Réglages du projet : *Retrouver le plan à jour dans le dépôt* → *Régler les allers-retours du lead* → *Laisser l'orchestrateur reprendre un lot*

L'audit proposait 43 regroupements en tout : la fiche d'une PR, le bloc Objectif, le pane
d'un agent… Ils n'ont pas été enchaînés, car chaque entrée y demande un état différent (PR verte, PR en
conflit, lot arrêté…). Ce n'est pas un même geste, et les enchaîner aurait rendu les étapes fausses
quand on les teste seules.

## En attente : appliquer les 2 mises de côté

La route « mettre de côté » est livrée (#450) et le dépôt déployé est à jour. Mais le bridge en service
a démarré avant ce merge et ne la connaît pas encore. Le redémarrer était hors de portée de cette carte.
Une fois Collie redémarré :

```bash
for id in 0df455a0-19cd-492d-8a8e-f2a65ffa6737:"Rubriques, « Autres » et « Voir les N décisions » retirés : Documents est un explorateur, testé ailleurs" \
          d11658e9-f70b-4f00-888e-3a15bbf0bc45:"La bascule COLLIE_BOARD_MUX=hc n'existe plus : hc est lu en continu, testé par « agents herdr-core rangés par projet »"; do
  card=${id%%:*}; note=${id#*:}
  curl -s -X POST "http://127.0.0.1:8788/api/cards/$card/recette-aside" -H 'content-type: application/json' \
    -H "x-collie-pane: ${HERDR_PANE_ID:-$HC_TERMINAL_ID}" -d "$(jq -n --arg n "$note" '{aside:true,note:$n}')"
done
```

Ou, depuis la Recette : « Mettre de côté » sur ces deux entrées.

## Recommandation et cartes déposées

Les fonctions qui disparaissent sont rares (2 sur 167). Ce qui fait vieillir la recette, ce sont les
cartes qui refont un écran sans relire les recettes qui le décrivent : 26 des 29 étapes fausses viennent
de là. Plutôt que de refaire un tri de temps en temps, autant corriger à la source :

- **« Recette : la carte qui refait un écran relit les étapes en attente qui le décrivent »** : une ligne
  de plus dans la consigne de fin de carte.
- **« Redémarrer Collie sous herdr-core : “herdr plugin action invoke restart” échoue »** : trouvé en
  route. Sous hc seul, la commande que CLAUDE.md impose de donner à l'utilisateur répond `server_not_running`.

## Questions pour le propriétaire

1. CLAUDE.md impose `herdr plugin action invoke …` pour toute consigne de mise à jour. Si cette
   commande ne marche pas sous herdr-core, faut-il assouplir la règle ou bien faire marcher la commande ?
2. Plusieurs entrées restent « ok » faute de preuve contraire. Leurs étapes dépendent d'un
   environnement (Windows, Android, pair, reboot) et n'ont été vérifiées que par leurs libellés. Seule
   ta passe dira si elles tiennent.
