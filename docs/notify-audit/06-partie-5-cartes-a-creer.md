# Partie 5 — Cartes à créer

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

Ordonnées par rapport valeur/coût. **Aucun code n'est écrit dans le cadre de la carte d'audit.**

## N1 — Libérer le palier gratuit du sous-titre de la préférence copilot — ✅ fait en 0.120.0

**Pourquoi** : §2.3. C'est un `if` mal placé (`bridge/index.ts:201`) qui empêche une lecture de
transcript déjà écrite et testée de s'exécuter. Sans copilot, sans quota, sans réseau.
**Portée** : séparer la garde en deux — le palier rapide sous sa propre condition (transcripts
disponibles), le palier copilot sous `copilotSubtitle`. Renommer la préférence en conséquence ou en
ajouter une seconde ; c'est le seul vrai arbitrage de la carte.
**Acceptation** : avec `copilotSubtitle` off et le copilot off, une alerte `blocked` porte le dernier
message de l'agent dans son corps. La préférence `copilotSubtitle` ne gouverne plus que le copilot.

## N2 — Changer le sujet du titre et sortir le repo du corps — ✅ fait en 0.121.0

**Pourquoi** : §2.1, §2.2, §3.2. Le titre est un discriminant nul et le corps est une redondance.
**Portée** : réécrire `NotificationCoordinator.summarize` (forme A) selon §3.2 ; dériver le repo de
`card.repoPath` ou de `cwd` plutôt que de faire confiance à `workspaceLabel` ; porter `repoPath` sur
`Alert` si nécessaire. La branche est explicitement exclue (§3.4).
**Acceptation** : deux alertes de deux cartes différentes ont deux titres différents ; le repo
apparaît exactement une fois ; aucun champ n'est répété entre titre et corps.

## N3 — La cascade de repli du corps — ✅ fait en 0.122.0

**Pourquoi** : §3.3. Le repli actuel répète le sujet ; le `--stat` est calculé puis jeté.
**Portée** : implémenter la cascade sous-titre → dernier message → `--stat` → rien, et calculer le
`--stat` indépendamment de l'activation du copilot. Dépend de N1 et N2.
**Acceptation** : une alerte `done` sur une carte, copilot off, porte un résumé de diff dans son
corps. Aucun cas ne retombe sur le titre de la carte.

## N4 — La notification porte sur la carte en review — ✅ fait en 0.125.0

**Pourquoi** : Partie 4. C'est la demande d'origine sur l'événement notifié.
**Portée** : *revue après N3 — plus petite qu'écrite ici à l'origine.* Le marqueur ne se compose plus
à la main : depuis N2 il vit dans `notifyContent` (`bridge/notify-content.ts`), où `Review` est **une
ligne**. La carte est déjà chargée au moment de `onFire` (`notify-subtitle.ts:139` — la référence
`:127` d'origine a bougé avec la cascade), et `BoardDb.getCard` rend la carte entière : `status` est
donc là, il suffit d'élargir le type narrowé de `EnrichOpts.board` (`notify-subtitle.ts:92`), qui ne
déclare aujourd'hui que `{ title, spec }`. **Le vrai reste du travail est le tap** : faire pointer la
destination vers la carte plutôt que vers le pane, ce qui demande un champ dans le payload push à côté
du `target: "settings"` existant (`push.ts:64-66`, `sw.ts:100-103`). Traiter les cas limites de §4.3.
Dépend de N2.
**Revue après N9 (0.124.0)** : le marqueur profite désormais aux **trois** surfaces d'un coup — mais
`notify-content.ts` existe en double (bridge + web), et l'écrire d'un seul côté casse le build ; la
ligne s'écrit une fois puis se copie. En regard, le **tap s'agrandit** : le toast et la cloche
deep-linkent encore vers le pane (`panePath`), donc sans elles deux surfaces sur trois diraient
`Review` et ouvriraient le terminal — le défaut déplacé, pas corrigé.
**Acceptation** : une session qui se termine sur une carte qui passe en `review` produit une
notification dont le marqueur est `Review` et dont le tap ouvre la carte, sur les trois surfaces. Une
session qui se termine sans carte est inchangée.
**Livré** : `notifyContent` lit un `cardStatus` (une ligne pour le marqueur) et `notifyCardId` en
dérive la destination — une seule condition, donc le marqueur et le tap ne peuvent pas diverger. Le
statut arrive par le hook de pré-tir du coordinateur, élargi de `subtitleFor` à `beforeFire`
(`{ subtitle, cardStatus }`) : c'est le seul instant où la carte est déjà réconciliée (§4.2). Les
surfaces in-app le lisent directement sur le snapshot (`withCardFields` porte `cardStatus` sur
`AgentView`), le push par un `cardId` à côté du `target` existant. Aucune boucle, aucun hook nouveau,
une lecture DB par alerte **tirée**.

## N5 — Instruire le digest multi-agents (et le principe même de la coalescence) — ✅ livrée

> **Fait, en 0.126.0.** Arbitrage rendu en [§3.5](04-partie-3-proposition-de-contenu.md#35-le-digest-multi-agents) : **on garde la
> coalescence** (donc pas d'ADR — il n'avait de raison d'être que pour fermer l'option inverse) et on
> enrichit le digest. Titre = décompte par état lu du même `notifyMarker` que la notification solo
> (`1 question, 2 to review`), corps = les sujets (déjà acquis en 0.124.0). Le passage du copilote
> sur le digest est évalué et **écarté** : le digest n'a pas de matière brute à reformuler, pas de
> place pour le résultat, et sa composition change plus vite qu'une réponse ne revient. La garde
> `currentSolo` (§2.5) reste donc telle quelle. *Réévalué le 2026-09-01, une fois le digest
> structuré : coût, latence et risque de re-notification chiffrés en
> [§3.5](04-partie-3-proposition-de-contenu.md#35-le-digest-multi-agents) — conclusion inchangée, aucune carte ouverte.*

**Pourquoi** : §2.5, §3.5. Le digest est le pire contenu émis, il est atteint dès la deuxième alerte,
et il annule tous les sous-titres en vol.
**Portée** : audit ciblé + décision. Deux options à comparer : améliorer le digest (décompte par
état + sujets), ou abandonner la coalescence maintenant que chaque notification a un sujet distinct.
La seconde est un changement de posture et mérite un ADR. **Pas d'implémentation avant l'arbitrage.**
**Acceptation** : une décision écrite, avec son ADR si l'option 2 est retenue.

## N6 — Le board comme source d'événements notifiables — ✅ arbitrage rendu, [§6](../../NOTIFY_AUDIT.md#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)

> **Rendu le 2026-08-26, en ADR le 2026-09-01**
> ([0011](../../.adr/0011-the-board-may-raise-an-alert-that-can-retract.md)).
> Le board **a** le droit d'émettre, sous trois tests (le fait n'a pas été
> demandé à l'instant · il ouvre une action · aucun pane ne le dit déjà) et une condition (savoir
> comment il se rétracte), dans le **même** slot, digest, snooze et jeu de préférences que le reste.
> Douze événements recensés en [§6.3](07-partie-6-le-board-comme-source-d-evenements-noti-03-6-3-le-recensement.md) : cinq retenus pour le push (B1, B2, B4,
> B5, B12), deux pour la cloche seule (B7, B10), cinq écartés — dont un pour une raison structurelle
> ([§6.5](07-partie-6-le-board-comme-source-d-evenements-noti-05-6-5-ce-qui-reste-hors-d-atteinte-et-pourquoi-ce.md)). Le
> déclencheur commun existe déjà et n'est pas une boucle : le journal `event` tailé sur `onUpdate`
> ([§6.2](07-partie-6-le-board-comme-source-d-evenements-noti-02-6-2-le-declencheur-commun-existe-deja-et-ce-n-es.md)).

**Pourquoi** : §1.1, §4.4. Aujourd'hui seuls les statuts de pane sont observés. Une carte orpheline,
une review du copilot rendue, une dépendance débloquée ne notifient rien.
**Portée** : recensement des événements de board qui mériteraient une notification, et arbitrage sur
le droit du board à en émettre (contrainte `CLAUDE.md` : pas de nouvelle boucle — tout doit
s'accrocher à `engine.onUpdate`). Brainstorm, pas implémentation.
**Acceptation** : une liste d'événements candidats, chacun avec son déclencheur existant et son coût.

## N7 — Sortir le sous-titre de la file du copilot, ou lui donner la priorité — ⚠️ largement dissoute

> **Revue après N1, N3 et N10 : sa prémisse a disparu.** §2.4 la justifiait par « le tour court dont
> la valeur se périme attend derrière le tour long ». Or la notification n'attend plus le copilot du
> tout : le palier gratuit rend dès qu'il est lu (N1), la cascade descend au `--stat` quand il n'y a
> pas de transcript (N3), et le premier push part complet (N10). Ce qui périssait ne périt plus — la
> reformulation du copilot est devenue un **bonus dont le retard ne coûte rien**.

**Ce qu'il reste, et c'est mince** : la seule question encore ouverte est de savoir si la polish du
copilot doit arriver **avant que l'opérateur ait traité le pane**, faute de quoi le garde-fou de
fraîcheur (`currentSolo`) la jette. Ce n'est plus « l'alerte est plate », c'est « l'alerte aurait pu
être mieux tournée ». Priorité basse, et à ne rouvrir que si un usage réel montre que la polish est
jetée souvent.
**Portée si on la reprend** : soit une priorité dans `Copilot.ask` (`copilot.ts:793-798`), soit un
budget de temps propre au sous-titre au-delà duquel il abandonne. À arbitrer contre la règle « le
copilot est sérialisé à une requête » (`CLAUDE.md`, §The board) — qui n'interdit pas un ordre,
seulement un parallélisme.
**Acceptation** : quand une carte atterrit, le sous-titre de notification passe avant la review de
cette même carte.

## N8 — Renseigner `sessionName` avant les listeners de transition — ↩️ défait en 0.134.0

> **Fait en 0.126.1, puis retiré en 0.134.0** — et c'est la carte elle-même qui l'avait annoncé : elle
> constate en toutes lettres qu'aucune surface ne nomme plus le pane. Corriger l'ordre d'un champ que
> personne ne lit, c'est fiabiliser une plomberie qui ne va nulle part. §2.6 tranche : le champ sort
> de l'`Alert` et de l'entrée d'historique, l'application du cache dans `toView` et son test d'ordre
> partent avec, et `sessionName` reste ce qu'il n'avait jamais cessé d'être — le nom qu'affichent les
> pastilles de panes dans l'app, depuis le snapshot.

**Pourquoi** : §2.6. La raison d'origine était « le push est moins riche que le toast sur le même
événement ». **Plus aucune des cibles successives ne tient** : N2 a sorti `paneDisplayName` du titre
(`<marqueur> · <sujet>`) ; N9 a fait composer la cloche par `notifyContent()` ; et N5 (0.126.0) a
réécrit le digest, dont le corps liste désormais les **sujets** (`cardTitle` ou le repo) et non plus
les panes. Aucune surface ne nomme plus le pane — `paneDisplayName` n'est appelé nulle part dans
`bridge/`, et `Alert.sessionName` / `NotifyLogEntry.sessionName` sont portés sans lecteur.
**Ce qui restait, et qu'on répare** : le défaut d'ordre lui-même. Un champ déclaré sur deux formes de
fil, copié à chaque alerte, et structurellement toujours vide, est un piège pour la prochaine surface
qui redonnera un rôle au nom du pane — elle le lirait vide sans rien avoir cassé. Corriger l'ordre
coûte trois lignes ; le laisser coûte un débogage un jour.
**Portée** : appliquer le cache `sessionNames` dans `toView` plutôt qu'après la boucle de
transitions.
**Acceptation** : un pane dont le nom `/rename` était connu au poll précédent porte ce nom dans
l'`Alert` de sa transition suivante. ✅

## N9 — Une seule composition de contenu pour les trois surfaces — ✅ fait en 0.124.0

> **Fait.** `notifyContent()` compose le push, le toast et la cloche. Pas par un import — le web se
> construit indépendamment de l'arbre du serveur Bun, contrainte assumée du dépôt (en-tête de
> `web/src/lib/types.ts`) — mais par une copie **octet pour octet** que `notify-content.test.ts`
> vérifie, ce qui fait tenir l'acceptation malgré le doublon : éditer un fichier sans copier l'autre
> casse le build. `notifyVerb`/`notifyWhere`/`notifyWhat` sont supprimés : ils distribuaient les mots
> d'une phrase que chaque appelant réassemblait. Le doublon de `paneDisplayName` côté bridge, lui, a
> été supprimé en 0.134.0 : plus rien n'y nommait un pane (§2.6) — la copie du web, elle, sert sept
> surfaces. Le corps du digest liste les sujets dédupliqués ; son titre compte par état depuis
> 0.126.0 (§3.5, carte N5).

**Pourquoi** : §1.3, C7. Trois codes composent le même contenu à trois niveaux de richesse, et une
amélioration de l'un ne profite pas aux autres. Les helpers `notifyVerb`/`notifyWhere`/`notifyWhat`
(`web/src/lib/types.ts:80-104`) sont la bonne forme, mais ils vivent côté web et le push ne les voit
pas.
**Portée** : après N2/N3/N4, factoriser la composition dans le bridge et la faire consommer par les
trois surfaces. Attention à la contrainte `paneDisplayName` déjà dupliquée volontairement
(`bridge/types.ts:80-82`) : cette carte est aussi l'occasion de trancher si ce doublon reste
délibéré.
**Acceptation** : une amélioration du contenu ne se code qu'une fois.

## N10 — Un seul push, complet : ne différer que ce qui est lent — ✅ fait en 0.123.0

**Pourquoi** : *découvert en vérifiant N3 sur l'appareil, pas à la lecture du code.* Une alerte part
aujourd'hui en deux messages : l'alerte initiale, vide et **vibrante** (`renotify: true`), puis la mise
à jour de sous-titre, complète et **silencieuse** (`renotify: false`). Les deux partagent le collapse
topic `collie-herd` (`SEND_OPTIONS`, `bridge/push.ts:27`), et un collapse topic veut dire : *si
l'appareil est injoignable, ne garder que le dernier*. Un téléphone endormi ne reçoit donc que le
second — le silencieux. L'alerte se pose sans vibration, précisément dans le cas où le push existe :
écran éteint, appareil dans la poche.

*Mesuré en direct* (0.122.0, 3 abonnements — 1 FCM, 2 Mozilla) : les 6 envois d'une alerte à deux
temps repartent tous en `201`, et la notification atteint le téléphone **environ une minute plus
tard, sans vibration**. Un message unique à `renotify: true` envoyé seul, lui, vibre.

**Mais le collapse n'est pas la cause — c'est le découpage qui ne se justifie pas.** Les coûts, tous
mesurés :

| Étape | Coût |
|---|---|
| Debounce avant que l'alerte parte | **30 000 ms** (`notifyDelayMs`, défaut) |
| Palier 2 — lecture du transcript | 1–60 ms (`context.ts:55-56`) |
| Palier 3 — `git --stat` | ~20 ms (mesuré sur une carte réelle, 10 fichiers) |
| Palier 1 — le copilot | secondes à minutes, sérialisé sur tout le board |

L'alerte attend **déjà 30 secondes**. Lui ajouter ~80 ms pour qu'elle parte complète plutôt que vide,
c'est 0,3 % de retard en plus. Le découpage en deux temps n'a donc qu'une seule vraie justification :
le copilot, seul palier réellement lent. Pour les paliers 2 et 3 il ne rachète rien et coûte un
message, une vibration, et la machinerie de fraîcheur qui va avec.

**Portée** : le **premier** push attend les paliers 2 et 3 et part complet. La mise à jour silencieuse
ne subsiste que pour le copilot — de l'information supplémentaire qui arrive après, sur une alerte
déjà lisible : c'est là que le deuxième temps est cohérent, et là seulement. Le copilot étant éteint
par défaut, la configuration par défaut n'envoie plus qu'**un seul message**, qui vibre toujours, et
le défaut ci-dessus disparaît sans avoir à arbitrer les collapse topics.

Deux points d'attention :

- `NotificationCoordinator.emit()` est synchrone et `notifications.ts` est un fichier d'upstream. Le
  faire attendre y touche plus profondément qu'un hook. La contrainte de surface upstream est un coût
  de rebase, pas un principe : elle ne pèse que si le fork tire encore d'upstream — à trancher, et à
  écrire, avant de s'en affranchir ici. *Tranché à la livraison* : dépense assumée sur ce point précis,
  inscrite dans [`UPSTREAM.md`](../../UPSTREAM.md) comme les autres entrées — pas d'ADR, ce n'est pas une
  levée générale de la contrainte. La brique 24 du ledger porte la facture d'extraction correspondante.
- Une lecture de transcript ou un sous-processus git qui pend ne doit **jamais** retarder l'alerte :
  ce qu'on attend, on l'attend sous délai borné, et on part sans lui à l'expiration. Le corps vide
  reste un repli acceptable (§3.3, palier 4) ; une alerte qui n'arrive pas, non.

**Acceptation** : copilot éteint, une alerte survenue pendant que le téléphone dort arrive en **un
seul message**, complet et vibrant. Vérifiée sur l'appareil, écran verrouillé — le seul juge, comme
pour les troncatures.

*Livré en 0.123.0.* Le coordinateur attend `subtitleFor` avant de rendre ; les paliers 2 et 3 sont
`firstSubtitle`, sous une borne de 1 500 ms. Coûts re-mesurés à la livraison : `git --stat` sur un
dépôt sale réel **12 ms**, palier 2 sur le pire transcript de la machine (34 Mo) **220 ms** — la
borne n'est atteinte que par du travail bloqué. Copilot éteint = **un seul message**, `renotify:true`.

---
