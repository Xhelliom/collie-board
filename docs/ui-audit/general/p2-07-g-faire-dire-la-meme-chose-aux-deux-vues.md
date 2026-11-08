# G — Faire dire la même chose aux deux vues

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## G1. Le contexte là où la décision se prend

Deux ajouts, aucune nouvelle donnée à calculer pour le premier :

- **Écran pane** : monter `<ContextGauge>` au-dessus du composer, à côté de la statusline
  (`agent-chat.tsx:736`). Le composant existe, il gère déjà l'absence de chiffre en ne rendant rien
  (`context-gauge.tsx:12`), donc c'est sans risque. Il faut que le pane sache s'il est adossé à une
  carte — l'API board le sait déjà, le pane non ; le plus simple est d'ajouter `ctxPct` /
  `ctxTokens` à `AgentView` (voir G3, qui rend le chiffre disponible pour tous).
- **Accueil** : le pourcentage en texte sur `AgentCard`, comme `CardTile` le fait déjà
  (`card-tile.tsx:69`) — une ligne, une fois la donnée disponible.

## G2. Aligner les champs des deux tuiles

Décider ce qu'une tuile d'agent montre, et l'appliquer aux deux. Proposition : **branche + cwd
raccourci + ctx%** partout, l'espace en plus sur l'accueil (où l'on trie par espace) et le nombre de
sessions en plus sur le board (où il raconte l'historique de la tâche). L'essentiel est que les
champs communs ne soient plus présents d'un côté et absents de l'autre sans raison.

Note : `paneDisplayName()` (`types.ts:45`) est déjà l'arbitre du nom d'un pane. Une tuile de board
adossée à un pane vivant gagnerait à montrer les deux — titre de carte **et** nom de pane — puisque
c'est précisément le lien tâche ↔ agent que le board existe pour établir.

## G3. Calculer le contexte pour tout pane

C'est le correctif de fond, et il est côté bridge. `ContextTracker.update()` itère sur
`db.listOpenSessions()` (`context.ts:84`) — donc uniquement les panes nés d'une carte. Le faire
itérer sur **les panes du snapshot** (`snap.agents`) rendrait le chiffre disponible partout, y
compris pour un pane lancé à la main.

Le coût est réel et doit être regardé en face : une lecture de transcript par pane vivant toutes les
30 s (`REFRESH_MS`), là où aujourd'hui seuls les panes adossés à une carte sont lus. Sur un troupeau
de dix agents dont deux ont une carte, c'est cinq fois plus de lectures de fichiers. Les garde-fous
existent déjà — le throttle par pane, l'ignorance des agents sans transcript lisible
(`context.ts:87`), et le fait que tout échec dégrade silencieusement au « niveau 3 ». Reste que la
règle du dépôt est explicite (*« si c'est coûteux, throttle-le dans le consommateur »*, `CLAUDE.md`),
donc la cadence mériterait d'être mesurée avant d'être élargie.

Un intermédiaire moins coûteux : ne calculer que pour le pane **actuellement ouvert** plus ceux
adossés à une carte. Ça couvre le besoin réel — on regarde le contexte de l'agent qu'on est en train
de piloter — sans multiplier les lectures.

Le stockage bougerait aussi : `ctxPct` vit aujourd'hui dans `card_session` (`context.ts:107`), une
table durable. Pour un pane sans carte, c'est de l'état runtime — et la règle du fork est
explicite : *« `card` durable, `session` éphémère. Ne jamais persister d'état runtime »*
(`CLAUDE.md`). Le chiffre devrait donc vivre en mémoire dans le tracker et être servi avec le
snapshot, pas écrit en base.

---
