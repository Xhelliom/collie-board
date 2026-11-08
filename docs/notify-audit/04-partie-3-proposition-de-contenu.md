# Partie 3 — Proposition de contenu

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

## 3.1 Le principe : changer le **sujet** de la phrase

Aujourd'hui le sujet grammatical est l'agent (`claude is done`). L'agent est la chose la moins
intéressante et la moins distinctive de l'événement : il y en a un par pane et ils s'appellent tous
pareil. **Le sujet doit être le travail, pas l'ouvrier.**

Ordre de priorité proposé pour le sujet, du plus discriminant au moins :

1. le **titre de la carte** quand le pane en a une ;
2. le **repo** (`repoName(cwd)` ou `workspaceLabel`) sinon.

## 3.2 Titre et corps proposés

> **Implémenté en 0.121.0** — `bridge/notify-content.ts`, une composition unique partagée par le push
> initial (`notifications.ts`) et par chaque mise à jour de sous-titre (`notify-subtitle.ts`), de
> sorte que les deux chemins ne peuvent plus produire deux phrases différentes. **Une réserve :** le
> marqueur `Review` attend la règle d'événement de la partie 4 — jusque-là un `done` de carte lit
> `Done`. Le corps du digest multi-agents (§3.5) est laissé tel quel, son arbitrage restant ouvert.

Une seule règle, deux champs :

> **Titre** = `<marqueur d'état> · <sujet>`
> **Corps** = `<repo> · <ce qui s'est passé>` — le repo est omis quand il est déjà le sujet du titre.

Marqueurs d'état proposés (courts, scannables, stables — c'est ce qu'on lit en premier sur un écran
verrouillé) :

| Situation | Marqueur |
|---|---|
| `blocked` | `Needs you` |
| `done` + carte qui passe en `review` (§4) | `Review` |
| `done` sans carte | `Done` |

Rendu, sur les cas réels du snapshot :

```
AVANT                                   APRÈS
─────────────────────────────────────   ────────────────────────────────────────────────
claude is done                          Review · Auditer la pertinence des notifications
Auditer la pertinence des notifica…     collie-board · 3 fichiers, +180 −12
· Auditer la pertinence des notifi…

claude needs you                        Needs you · Mesurer la lecture des dossiers
Mesurer la lecture des dossiers et      CrewDesign · demande quel cache viser en priorité
évalu · Mesurer la lecture des doss…

claude is done                          Done · elber
worktree-green-stone-90b3 ·             ~/.herdr/worktrees/elber · 2 fichiers, +40 −3
~/.herdr/worktrees/elber/worktree-…
```

Ce que ça donne, champ par champ :

| Champ | Contenu | Source | Disponible ? |
|---|---|---|---|
| Marqueur | `Needs you` / `Review` / `Done` | `alert.status` + statut de carte (§4) | oui |
| Sujet | titre de carte, sinon repo | `alert.cardTitle`, sinon `repoName(cwd)` | oui — `cardTitle` est déjà porté par `Alert` (`notifications.ts:96`) |
| Repo (corps) | nom court du repo | `card.repoPath` ou segment de `cwd` | oui — `repoPath` déjà lu en `notify-subtitle.ts:127` |
| Quoi (corps) | sous-titre copilot → dernier message → `--stat` → rien | §3.3 | oui — cascade complète en 0.122.0 |

## 3.3 Le corps quand personne n'a réécrit : une cascade, pas un repli sur le sujet

> **Implémenté en 0.122.0** — la cascade entière est dans `enrichNotification`
> (`bridge/notify-subtitle.ts`). Le palier 3 rend le stat sur une ligne (`diffStatLine`,
> `bridge/git.ts`) et il est **récupéré indépendamment du copilot** : la condition n'est plus « le
> copilot est-il activé » mais « quelque chose l'utiliserait-il », c'est-à-dire un corps à remplir ou
> un prompt à nourrir. Le même stat sert les deux, en deux rendus — une ligne pour l'écran verrouillé,
> le listing par fichier pour le prompt — donc un seul sous-processus git par alerte, jamais zéro
> quand le corps en a besoin. Le palier 4 est déjà acquis depuis 0.121.0 (§2.2). **Deux effets de
> bord :** un `done` dont le transcript a parlé n'affiche jamais son diff (le palier 2 le prime, comme
> la cascade le prescrit), et une carte sans worktree ne déclenche plus de tour de copilot sur un
> `(no branch for this card)` — il n'y a rien à reformuler.

Le repli actuel (`cardTitle ?? cwd`) est le pire possible : il répète le sujet. Cascade proposée,
du plus informatif au moins, **sans jamais retomber sur le sujet** :

1. **sous-titre du copilot**, s'il a répondu (palier lent existant) ;
2. **dernier message de l'agent**, tronqué (palier rapide existant, aujourd'hui verrouillé — §2.3) ;
3. **`git diff --stat` résumé** pour un `done` : `3 fichiers, +180 −12`. Déjà calculé par
   `cardDiffSummary` / `cwdDiffSummary` (`notify-subtitle.ts:149-153`) mais **seulement quand le copilot
   est activé** — il sert aujourd'hui de matériau de prompt, jamais de contenu ;
4. **rien** — un corps réduit au seul repo vaut mieux qu'un corps qui répète le titre.

Le point 2 est de loin le meilleur rapport valeur/coût de tout l'audit : une lecture de fichier
déjà écrite, déjà testée, qu'un `if` mal placé empêche de s'exécuter.

## 3.4 La branche : **non** — tranché

**Décision : la branche n'entre pas dans le contenu de la notification.**

Trois arguments, dans l'ordre de force :

1. **Elle est une fonction du titre.** `branchFromTitle(card.title)` (`bridge/cards.ts:354`) slugifie
   le titre. *Vérifié en direct* : `"Auditer la pertinence des notifications et redéfinir leur
   contenu"` → `board/audit-pertinence-notifications`. Mettre les deux, c'est écrire le sujet deux
   fois — exactement le défaut qu'on corrige en §2.2.
2. **Elle n'existe que là où elle est redondante.** `withCardFields` ne pose `branch` que pour un pane
   adossé à une carte (`bridge/cards.ts:169`). Un pane lancé à la main — le seul cas où une branche
   apporterait une information non déductible — n'en a pas. *Vérifié en direct* : `branch: null` sur
   les 6 panes hors carte.
3. **Le budget d'affichage est le vrai arbitre.** Une notification push offre un titre d'une ligne et
   un corps d'une à deux lignes. Chaque caractère dépensé en branche est pris sur « ce qui s'est
   passé », qui est la seule chose que l'opérateur ne peut pas deviner.

**Où la branche a quand même sa place** : la cloche (`notification-bell.tsx`), qui est un historique
consulté sur un écran, pas un coup d'œil sur un écran verrouillé, et le détail de carte, qui
l'affiche déjà (`web/src/routes/card.tsx:431-432`). Pas le push.

## 3.5 Le digest multi-agents

> **Tranché et implémenté (corps en 0.124.0, titre en 0.126.0)** — carte N5. Le digest hérite du
> défaut de sujet en pire, et il est atteint dès la **deuxième** alerte simultanée. Les deux moitiés
> sont maintenant réparées :
>
> > **Titre** = `1 question, 2 to review` — le décompte **par état**, pas par agent
> > **Corps** = les **sujets** : `Auditer les notifications · Mesurer la lecture · elber`
>
> Le titre lit le **même marqueur** que la notification solo (`notifyMarker`, `notify-content.ts`),
> donc un `Review` isolé et un `to review` dans le digest ne peuvent pas désigner deux états
> différents. Les mots diffèrent parce que la forme diffère — « 1 Needs you » n'est pas une phrase —
> pas la règle. Un groupe vide disparaît : un troupeau homogène lit `3 to review` et ne parle pas des
> états qu'il n'a pas.
>
> **Le corps est borné** (0.133.4) : trois sujets, puis `+N` pour le reste, chacun coupé à 32
> caractères — deux lignes d'écran verrouillé, et une carte au titre bavard ne pousse plus les autres
> hors de l'écran qu'elle devait nommer. Un sujet qui ne résout à rien (pas de carte, `cwd`
> illisible) sort de la liste au lieu d'y laisser un trou ; le titre le compte encore.

**L'ordre des groupes est fixe et le plus urgent d'abord** : `question` → `to review` → `done`. Un
agent bloqué est arrêté sur une réponse que vous seul pouvez donner ; une carte finie ne l'est pas.
Fixe et non trié par taille, sinon le titre se réordonne tout seul à chaque alerte qui se résout —
sur un écran verrouillé, un titre qui bouge est un titre qu'on relit. (L'exemple de cet audit disait
« 2 à relire, 1 question » ; c'était un rendu, pas un ordre.)

### La coalescence est **conservée** — l'option « une notification par carte » est écartée

Le regroupement a été conçu pour éviter la pile de notifications identiques, et l'argument « chaque
notification a désormais un sujet distinct, donc la pile est lisible » ne tient pas jusqu'au bout :

1. **Un seul `tag` est aussi ce qui permet de rétracter.** `retract()` ré-émet *le* résumé rétréci
   sur le même slot (`notifications.ts:320-323`) : traiter un agent au PC met à jour la notification
   qui reste. Avec un push par pane il faudrait un `clear` par pane, et chaque rétractation ratée
   laisserait un fantôme sur l'écran verrouillé — exactement le défaut que la coalescence corrige.
2. **Le budget d'affichage est par écran, pas par notification.** Empilées, N notifications se
   regroupent et chacune se réduit à peu près à son titre ; un digest, c'est un titre **et** un corps,
   tous deux entièrement visibles, qui portent les N sujets.
3. **Le décompte par état est une information que la pile ne porte pas.** « 1 question, 2 to review »
   se lit d'un coup d'œil ; trois notifications séparées demandent de les compter.

Décision : **on garde la coalescence.** Il n'y a donc pas de changement de posture à arbitrer, et
**pas d'ADR** — l'ADR n'aurait eu de raison d'être que pour fermer l'option inverse.

### Le copilote sur le digest : **non** — réévalué le 2026-09-01, toujours écarté

> **Question rouverte comme prévu.** La première évaluation (0.126.0) répondait « non » avant que le
> digest ait une forme : elle est refaite ici maintenant qu'il en a une — décompte par état lu de
> `notifyMarker`, sujets dédupliqués. **Conclusion inchangée : on ne fait pas.** Pas de carte de mise
> en œuvre ouverte. La garde `currentSolo` (`notifications.ts:258-260`) reste telle quelle.

La question posée : le copilote pourrait-il composer un sous-titre de *digest*, poussé en update
silencieux, comme il le fait pour une alerte solo (`enrichNotification`, palier 1) ? Aujourd'hui il
en est empêché par `currentSolo` (§2.5) : dès la deuxième alerte, toutes les réponses en vol sont
jetées.

**Les trois grandeurs, chiffrées.** Toutes lues dans le code ou mesurées ailleurs dans cet audit ; la
latence réelle du copilot n'est toujours pas mesurée (cf. *Méthode et limites*), seules ses bornes de
configuration le sont — et elles suffisent à trancher.

| | Alerte solo (aujourd'hui) | Digest (ce qui est évalué) |
|---|---|---|
| **Requêtes copilote** pour une rafale de N alertes | **1** — `enrichNotification` sort par `currentSolo` avant de dépenser un tour (`notify-subtitle.ts:234`) | **N** — le hook `onFire` l'appelle une fois par alerte qui part (`index.ts:231`). À N=4, la moitié du cycle `RESET_EVERY = 8` (`copilot.ts:53`) dépensée à réécrire un texte déjà écrit |
| **Latence plancher** | 2 s — `POLL_MS`, la granularité de lecture du fichier de sortie (`copilot.ts:44`) ; l'agent ne peut pas répondre « vite » | identique, mais opposée à une composition qui, elle, change à chaque arrivée **et** à chaque rétractation |
| **Latence plafond** | 5 min (`REQUEST_TIMEOUT_MS`, `copilot.ts:41`) **plus** l'attente en file derrière les reformulations et les reviews de cartes — un seul tour à la fois, tout le board | identique, sauf que la file est à son pic exactement dans ce cas : N agents qui finissent ensemble, ce sont aussi N reviews à faire |
| **Ce que le premier push attend** | 12–220 ms mesurés, borne dure 1 500 ms (§N10) | **inchangé** — le digest part complet sans rien attendre : son contenu est local et synchrone |

**Le risque de re-notification, tranché : rédhibitoire.** L'update du palier 1 est
`renotify: false` sur le collapse topic `collie-herd` (`push.ts:27`), et §N10 a *mesuré en direct* ce
que ça veut dire : un téléphone endormi ne reçoit que **le dernier** message du topic. Sur une alerte
solo, l'exception est assumée — le silencieux est le dernier mot, il ajoute de l'information à une
alerte déjà lisible, et le copilote est éteint par défaut. Sur un digest, l'exception ne tient plus,
pour deux raisons indépendantes :

1. **L'ordre n'est plus garanti.** La réponse composée contre la forme *S* peut atterrir après le
   rendu `renotify: true` de la forme *S+1* (une alerte de plus est arrivée). Sur le collapse topic,
   le dernier écrase : un digest périmé recouvre le digest courant, **silencieusement**. Ce n'est plus
   « une alerte qui ne vibre pas », c'est *un mauvais contenu qui éteint la bonne alerte*.
2. **Le « silencieux » n'est pas vérifié là où il compte.** `renotify` n'est honoré que par les
   navigateurs qui le supportent (`sw.ts:67-68`) et ce dépôt n'a jamais vérifié de quel côté tombe
   iOS — c'est nommément hors du périmètre de cet audit (*Méthode et limites*). Les deux branches
   perdent : honoré → c'est le point 1 ; ignoré → chaque `showNotification` sur le même tag ré-alerte,
   donc N updates « silencieux » = N vibrations de plus sur la notification dont le rôle est
   précisément de ne buzzer qu'une fois pour N agents. On ne construit pas une fonctionnalité dont la
   prémisse — *c'est gratuit parce que c'est silencieux* — est fausse sur une plateforme et non
   vérifiée sur l'autre.

Et le clignotement se chiffre déjà sans copilote : une rafale de N alertes rend le slot **N fois**,
chacune avec `renotify` (le plafond est écrit à `emit()`, `notifications.ts:325-337` ; constaté à
quatre cartes orphelinées en §6.3). Y ajouter le palier 1, c'est aller jusqu'à **2N** rendus pour un
contenu qui, lui, n'a pas bougé.

**Les quatre raisons de fond**, dans l'ordre de force :

1. **Il n'y a rien à reformuler.** Le décompte par état et les sujets sont des faits que le bridge
   détient déjà, localement, gratuitement, **et de façon synchrone dans le premier push qui buzz**.
   Le copilote dépenserait du quota et des secondes pour redire moins bien ce qui est déjà écrit. Le
   palier 1 se justifie sur une alerte solo parce qu'il y traduit un `git --stat` ou un dernier
   message d'agent en une phrase — de la matière brute. Un digest n'a pas de matière brute : il a
   déjà sa phrase.
2. **Le contenu qu'il produirait n'a pas de place.** Le corps du digest porte déjà N sujets — trois
   suffisent à saturer les deux lignes d'un écran verrouillé. Ajouter « ce qui s'est passé » pour
   chacun est impossible ; le faire pour un seul, c'est choisir arbitrairement lequel des N compte.
3. **Le digest est instable, la réponse est lente.** Chaque arrivée et chaque résolution le
   re-rendent ; la réponse arrive au mieux 2 s plus tard, au pire 5 min plus tard, file comprise.
   Elle décrirait un ensemble d'alertes qui n'existe déjà plus.
4. **Le coût de quota culmine exactement là.** N agents qui finissent dans la même fenêtre, c'est le
   pic de pression sur une file d'une requête. Y ajouter N tours de digest, c'est dépenser le plus au
   moment où l'on sert le moins — et faire attendre les reviews de ces mêmes cartes derrière.

**L'interaction avec `currentSolo` : la garde n'est pas l'obstacle, c'est le diagnostic.** Elle
s'applique deux fois — avant de dépenser un tour (`notify-subtitle.ts:234`) et avant de rendre la
réponse (`notify-subtitle.ts:124`) : la première est la garde de quota, la seconde la garde de
fraîcheur. Pour laisser le copilote adresser le digest, il faudrait remplacer les deux par un
prédicat sur la *forme* du digest — « le même ensemble de clés en cours ». Or ce prédicat devient
faux dès qu'une alerte arrive ou se rétracte, c'est-à-dire à l'intérieur même de la fenêtre de
debounce, dans exactement le cas visé. **Une garde de fraîcheur correcte rejetterait donc tout ce
qu'un palier 1 sur digest peut produire ; une garde plus laxiste publierait du périmé.** Il n'existe
pas de version de la garde qui fasse passer un sous-titre de digest sans mentir — c'est la raison 3,
écrite au niveau du code.

**Conséquence : `currentSolo` reste telle quelle**, et elle coûte maintenant beaucoup moins cher — ce
qu'elle jette n'est plus la seule chance d'avoir un corps informatif, puisque le digest en a un par
construction. Le palier 1 reste ce qu'il est : une amélioration d'alerte solo. Rien à implémenter,
donc rien à ouvrir.

*Écarté aussi, adjacent :* mémoriser la réponse copilote sur l'alerte sans la rendre, pour qu'elle
serve si le digest redescend à une seule alerte. Ça marcherait, mais ça affiche une phrase composée
plusieurs minutes plus tôt sur un pane dont on ne sait plus rien — un contenu périmé sur un slot qui
buzz. À reconsidérer seulement si quelqu'un observe le cas en vrai.

**Ce qui rouvrirait la question** (et rien d'autre) : le digest devient déclaratif au point d'avoir de
la matière brute à traduire — par exemple si un jour il portait un extrait par sujet — **et** le
palier 1 sort du collapse topic partagé, donc cesse de pouvoir manger le buzz d'une alerte.

---
