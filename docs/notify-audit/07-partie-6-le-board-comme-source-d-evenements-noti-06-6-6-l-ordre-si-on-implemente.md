# 6.6 L'ordre, si on implémente

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

Valeur décroissante par unité de code, et chaque étape est livrable seule :

1. ~~**La cloche seule** — B2, B7, B10 via `NotifyLog.add()` + le tailer. Zéro fichier upstream touché,
   zéro rétraction à définir. C'est déjà « le board raconte ce qui s'est passé pendant votre absence ».~~
   **✅ fait en 0.129.0** (`aeec4a1`) — voir l'encadré sous ce paragraphe.
2. ~~**B1 et B5 en push** — les deux faits que personne n'a demandés et que rien d'autre ne dit. Demande
   le socle de §6.4 (clé d'alerte, `paneId` optionnel, un marqueur, une ligne de digest).~~
   **✅ fait en 0.130.0** — voir le second encadré sous ce paragraphe.
3. ~~**B12** — le complément de N4, gratuit une fois le socle posé : même marqueur, même destination.~~
   **✅ fait en 0.133.0** — voir le troisième encadré sous ce paragraphe.
4. ~~**B4** — off par défaut, marqueur `Ready`. À faire en dernier : c'est la seule notification agréable
   du lot, et une notification agréable est celle qu'on regrette le moins de ne pas avoir.~~
   **✅ fait en 0.132.0** — voir le quatrième encadré sous ce paragraphe.

> Les deux dernières étapes ont atterri dans l'ordre inverse de cette liste : B4 en 0.132.0, B12 en
> 0.133.0. Les encadrés ci-dessous gardent l'ordre des étapes, pas celui des versions.

> **Étape 1 livrée en 0.129.0.** Ce que ça a réellement coûté, contre ce que cette liste annonçait :
>
> - **Le tailer** est `bridge/board-notify.ts` (§6.2), et rien d'autre n'est périodique.
> - **Les trois faits** passent par `NotifyLog.add()` en direct : `review.created` avec son verdict
>   (B2), `card.cleanup_failed` (B7), `copilot.*_failed` (B10). Donc **aucun push**, aucun débounce,
>   aucune coalescence, **`notifications.ts` intact**, et aucun prédicat de rétraction à écrire.
> - **Le marqueur n'a pas bougé** : les trois faits se disent avec `Needs you`/`Review`/`Done` et le
>   récit dans le `subtitle`, donc ni entrée de digest, ni préférence, ni deuxième copie de
>   `notify-content.ts` à tenir. Le socle de §6.4 reste **entièrement dû par l'étape 2**.
> - **« Zéro fichier upstream touché » était faux d'un cheveu**, et c'est le seul écart : `index.ts`
>   prend son sixième `onUpdate` (annoncé par §6.2), et `web/src/lib/types.ts` la copie du type dont
>   `paneId` devient optionnel. Les deux étaient déjà au ledger `UPSTREAM.md` ; l'entrée y est élargie.
> - **Le routage du tap** n'a pas eu besoin de `notifyCardId` : une entrée de board n'a pas de
>   `paneId`, et cette absence *est* la décision (`notification-bell.tsx`). `enrich()` reste inchangé —
>   sans pane, rien à enrichir.

> **Étape 2 livrée en 0.130.0.** Le socle de §6.4, posé en entier, et les deux faits qui le traversent :
>
> - **La clé est opaque.** `pending`/`outstanding` n'ont pas changé de type — c'étaient déjà des
>   `Map<string, …>` — mais plus rien ne lit la clé comme un pane : `arm(key, alert)` / `retract(key)`
>   sont publics, `onTransition` n'en est qu'un appelant, et `board-notify.ts` clé `card:<id>`.
> - **`paneId` a migré de `FiredAlert` vers `Alert`, en optionnel** ; `FiredAlert` n'ajoute plus rien
>   et n'est qu'un alias conservé pour les sites d'appel. Le deep-link se lit sur l'ALERTE, plus sur la
>   clé de la Map — c'est ce qui rend une alerte sans pane possible.
> - **Un marqueur, pas deux.** `Stalled`, pour B1 et B5 ensemble (§6.4, « Le vocabulaire du digest »),
>   plus sa ligne de digest en deuxième position et **une** préférence `board`, par défaut **on**.
> - **Le prédicat de rétraction est unique, lui aussi** : l'alerte tient tant que la carte se lit
>   exactement comme le fait l'a laissée — même colonne, même session, même handoff en attente. B1 se
>   rétracte quand la carte quitte `orphaned`, B5 quand elle reçoit une nouvelle session, qu'un
>   handoff est redemandé, ou qu'elle quitte les colonnes vives. Évalué sur `onUpdate`, à côté du
>   tailer, deux lectures indexées par alerte en cours — dont il n'y en a normalement aucune.
> - **La note de masse de §6.3 tient, à moitié.** Quatre cartes orphelinées dans le même tick
>   arrivent bien en UNE notification — même slot, un digest « 4 stalled ». Mais elles coûtent
>   **quatre messages** pour y arriver, chacun avec `renotify` : les timers viennent à échéance dans
>   le même tick et s'exécutent en callbacks séparés, file de microtâches vidée entre chaque, donc
>   chaque `fire()` rend avant que le suivant ne soit appelé. Un garde « rendu identique au
>   précédent » a été essayé et **ne sert à rien** ici — les quatre digests diffèrent, ils grossissent.
>   Collapser réellement demande de différer le rendu au-delà du lot de timers (un macrotask), ce qui
>   change le moment où *tout* appelant voit un rendu ; à ne faire qu'une fois le double buzz
>   effectivement constaté sur l'appareil. Le plafond est écrit à `emit()`.
> - **`notify-subtitle.ts` ne s'applique pas** à une alerte sans pane : ni transcript à lire, ni diff
>   à mesurer, ni notification à ré-écrire — et son propre récit est déjà dans le `subtitle`.
>
> **Ce qui reste à vérifier sur l'appareil**, et que le diff ne peut pas prouver : l'aller-retour d'un
> herdr redémarré — l'alerte de pane se rétracte à l'instant où le pane disparaît (`notifications.ts`)
> et l'alerte `Stalled` arrive 30 s plus tard, ce qui devrait faire un silence puis un buzz, pas deux.

> **Étape 3 livrée en 0.133.0.** « Gratuit une fois le socle posé » était juste : aucun fichier neuf,
> aucun canal neuf, aucune préférence neuve.
>
> - **Le fait entre par le même tailer**, dans `alarm()`, à côté de B1 et B5 — et le prédicat de
>   rétraction unique le couvrait déjà tel quel : la colonne est dans l'empreinte, donc l'alerte tombe
>   dès que la carte quitte `review`.
> - **Le statut de l'alerte est `done`, pas `stalled`.** C'est ce qui lui donne le marqueur `Review` et
>   le tap vers la carte, sans une ligne de `notify-content.ts` — les deux se déduisent déjà de
>   `cardStatus`, et les deux copies du fichier restent identiques octet pour octet. Conséquence
>   assumée : B12 est gouverné par la préférence **`done`** et non par `board`. C'est le bon axe — la
>   question de l'opérateur est « est-ce que je veux qu'on me dise qu'il y a à lire », pas « par quel
>   chemin on l'a su » — mais ça veut dire que B12 est **off par défaut**, comme N4.
> - **Le test 3 de §6.1 est le seul vrai travail.** Il se lit sur la `reason` que `reconcile()` estampe
>   (`cards.ts`), sortie en `paneReason()`/`DERIVED_REASON` pour que les deux fichiers ne puissent plus
>   diverger sur la chaîne : `agent done` **est** la transition que N4 vient de notifier, et un
>   conteneur qui dérive `review` d'un enfant ferait deux alertes pour un seul atterrissage (§4.3).
>   Une `reason` illisible se tait aussi — « on ne sait pas » doit tomber du côté du silence.
> - **Ce qui reste à vérifier sur l'appareil** : une carte posée en `review` à la main depuis le
>   téléphone se notifie elle-même 30 s plus tard. C'est correct (le geste est un tap, mais la carte
>   reste à lire), et c'est le seul cas du lot où l'opérateur avait le doigt dessus.

> **Étape 4 livrée en 0.132.0.** Le seul fait du recensement qui ouvre une porte au lieu d'en réclamer
> une, et ce que ça a coûté par-dessus le socle de l'étape 2 :
>
> - **Un déclencheur qui ne parle pas de sa propre carte.** `unblocks()` (board-notify.ts) est vrai sur
>   `card.status {to: done|archived}` et ne rend aucun sous-titre : le fait appartient aux SUCCESSEURS,
>   que seule une requête connaît. `BoardDb.dependentsOf()` est cette requête — `WHERE depends_on = ?`,
>   **non indexée et assumée** (un scan de table sur une carte terminée, un fait rare).
> - **La gate n'a pas bougé d'une ligne.** `startCard` refuse toujours un prédécesseur non terminé
>   (`cards.ts`, « THE DEPENDENCY IS A GATE, NOT A TRIGGER ») ; ce module arme une alerte et s'arrête
>   là. Le test « it notifies and STOPS THERE » est là pour que ça reste vrai.
> - **Son propre marqueur et sa propre préférence**, comme §6.4 l'exigeait : `Ready`, jamais
>   `Needs you` ; sa ligne de digest en **dernier** (`Needs you` · `Stalled` · `Review` · `Done` ·
>   `Ready`) parce que c'est le seul état qui ne réclame rien ; et une sixième préférence `ready`,
>   **off par défaut**, distincte de `board` — les rejoindre aurait forcé l'opérateur à choisir entre
>   « ma carte est calée » et « une carte peut démarrer », qui ne sont pas la même envie.
> - **Aucun prédicat de rétraction neuf.** Le `fingerprint` de l'étape 2 couvrait déjà le cas : un
>   démarrage change la colonne ET ouvre une session, donc l'une ou l'autre moitié le voit. Un
>   glissement `backlog` → `ready` à la main rétracte aussi, et c'est la bonne réponse — quelqu'un
>   avait la carte sous les yeux.
> - **Les successeurs déjà partis ne sont pas prévenus** : seules les colonnes `backlog`/`ready`
>   comptent, exactement le contour que la colonne « Rétraction » de §6.3 dessinait.
>
> **Ce qui reste à vérifier sur l'appareil** : rien de neuf de propre à B4 — la préférence étant off,
> le chemin par défaut est le silence. Ce qui n'est *toujours* pas vérifié sur l'appareil, ce sont les
> deux allers-retours notés dans l'encadré de l'étape 2.
