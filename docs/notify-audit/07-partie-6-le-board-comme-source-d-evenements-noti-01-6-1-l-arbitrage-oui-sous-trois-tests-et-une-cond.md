# 6.1 L'arbitrage : oui, sous trois tests et une condition

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

La décision d'abord, l'argument ensuite.

> **Le board a le droit d'émettre des notifications de son propre chef.** Rien ne justifie de réserver
> la notification aux transitions de pane : le pane n'est pas ce que l'opérateur suit, c'est
> l'instrument. Ce que le board sait et que le pane ignore — une carte devenue relançable, un verdict
> rendu, un handoff qui n'a jamais abouti — est exactement ce qu'on rouvre l'application pour aller
> chercher.
>
> **Mais il n'émet rien qui ne passe les trois tests ci-dessous, il ne crée aucun second canal, et un
> fait sans règle de rétraction n'émet pas du tout.**

**Test 1 — le fait est-il arrivé sans que l'opérateur le demande à l'instant ?**
C'est le test qui élimine le plus de candidats, et c'est le bon : `integrate.ts:5` le dit déjà pour
ses cinq gestes — « all five are TAPS ». Un merge, un PR, un démarrage sont awaités par leur route
(`board-routes.ts:569`, `:851-853`) : la réponse HTTP **est** la notification, l'opérateur a le doigt
dessus, et un push par-dessus est du bruit. Ne passent ce test que les faits dont la queue est
asynchrone et dépasse largement le tap qui les a lancés (une review, un handoff, un nettoyage
automatique), et ceux que personne n'a demandés du tout (un orphelinat).

**Test 2 — le fait ouvre-t-il une action, ou raconte-t-il seulement ?**
« La carte est passée en `working` » est du journal. « La worktree n'a pas pu être supprimée » est une
décision qui attend. Le journal des cartes (`db.recordEvent`, `db.ts:1218`) existe précisément pour
tout le reste, et il est déjà rendu sur l'écran de carte : un fait qui n'ouvre rien y reste.

**Test 3 — un pane le dit-il déjà ?**
C'est la règle que N4 a appliquée sans la nommer : la carte qui entre en `review` n'a pas sa propre
notification de board, elle est portée par la transition `done` du pane qui l'y a mise. Un événement
de board ne notifie que ce qu'aucun pane n'a signalé — sinon le même fait buzze deux fois, par deux
chemins qui n'ont aucun moyen de savoir l'un pour l'autre.

**La condition, et c'est la plus structurante : un événement de board doit dire comment il se
rétracte.**
Toute la machinerie de `NotificationCoordinator` repose sur des alertes **réversibles** : une alerte
de pane s'efface parce que le pane change d'état (`notifications.ts:130-134`, `:163-165`). Un
événement de board est **ponctuel** : `review.created` est vrai une fois et ne redevient jamais faux.
Coalescé tel quel dans le slot du troupeau, il y resterait à vie — et le digest annoncerait « 1 to
review » pour une carte lue il y a trois jours. **Donc : un événement de board ne rejoint le slot que
s'il est accompagné d'un prédicat de rétraction lisible sur la carte** (« la carte a quitté `review` »,
« la carte a été ouverte », « la carte n'est plus `orphaned` ») — évalué au même endroit que le reste,
sur `onUpdate`. Un fait dont on ne sait pas dire quand il cesse d'être vrai ne notifie pas ; il va au
journal, ou à la cloche, qui est une histoire et non un état.

**Et : pas de second système.** Les événements de board entrent dans le **même** slot `collie:herd`,
le **même** digest, le **même** snooze, les **mêmes** préférences (`notify-prefs.ts:31-36`). La
tentation inverse — un tag `collie:board`, une catégorie « alerte board » — donnerait deux endroits où
couper le son et deux notifications simultanées pour un troupeau qui n'en veut qu'une. Le seul
assouplissement admis est **par surface** (§6.3, B7 et B10) : certains faits méritent la cloche et pas
la vibration, et les trois surfaces sont déjà séparables depuis N9.
