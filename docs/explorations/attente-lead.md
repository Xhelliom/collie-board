# Où passe le temps entre « travail fini » et le verdict du lead — incident du 23/11

Exploration, aucun code modifié. Heures locales. Sources : journal des cartes (`GET /api/cards/<id>`,
table `event` de `board.db`), `journalctl --user -u collie-board`, `bridge/gate.ts`, `bridge/run.ts`,
`bridge/lead.ts`, `~/.local/state/collie-board/lead/.board/prompts`.

## En une phrase

Le lead n'a jamais été muet : **il n'a jamais été interrogé**. Une porte (`bun run check`) restée
bloquée 4 h 16 sur la carte A a tenu la file **globale** des portes, donc aussi la porte de la carte B.
Le délai de 30 min a bien sonné vers 16 h 26, mais `proc.kill()` ne tue que `bash` : le `bun test`
petit-fils garde le tube stdout ouvert et `spawnGate` attend sa fin de fichier jusqu'à 20 h 12. Pendant
toute l'attente, les deux cartes sont « occupées » dans le coordinateur, donc le filet « lead muet »
n'est pas évalué. Il se déclenche sur B 7 s **après** une porte verte, en accusant le lead.

## 1. Chronologie

### Carte A — « Un lot arrêté finit toujours par réveiller… » (2ee7c6eb, lot 3ad99119)

| Heure | Fait | Source |
|---|---|---|
| 15:55:45 | Le bridge relance t19y (« screen frozen 1 h ») | journalctl `[stuck]` |
| 15:56:02 | `card.status working → review` (« agent done ») : **atterrissage** | journal carte |
| ~15:56:03 | Tick suivant : `stepFor` renvoie `gate` (dépôt à porte, aucun `run.gate` depuis l'atterrissage). `act()` ajoute la carte à `busy` puis appelle `runGate("bun run check", worktree)`. La file est vide (dernière porte : f01de947 à 14:40:24) et la porte démarre aussitôt | `run.ts` `stepFor` l. 258, `update` l. 493, `gate()` l. 729-733 ; table `event` |
| ~15:56 → | `scripts/check.sh` : typecheck, puis `tests-passed.sh` échoue (le pre-push n'a pas encore validé 2c74af52e), donc `bun run test` → `bun test ./bridge ./scripts` (pid 1899470) | `scripts/check.sh`, `package.json` |
| en parallèle | L'agent lance lui-même un `bun test` **à la racine, sans chemin** (pid 1597943) : il ramasse aussi les tests Vitest de `web/`, qui ne tournent pas sous Bun, et ne finit jamais | bilan du worker (`run.report`) ; `bunfig.toml` sans `root` |
| ~16:26 (déduit) | `GATE_TIMEOUT_MS` (30 min) expire : `timedOut = true; proc.kill()`. **SIGTERM au seul `bash`** de `check.sh`. Son `bun test` est réparenté à systemd (le « parent systemd » vu par l'orchestrateur) et **garde le stdout de la porte ouvert** | `gate.ts` l. 110-114 |
| 16:26 → 20:12 | `await Promise.all([Response(stdout).text(), …])` attend la fin de fichier du tube, qui ne vient pas. La porte ne rend rien. La carte reste dans `busy` et n'est donc plus évaluée par `stepFor` (ni filet, ni rien) | `gate.ts` l. 116-120, `run.ts` l. 463 |
| 20:12:35 | L'orchestrateur tue 1597943 et 1899470 et renvoie l'agent au travail | `card.operator_said`, `card.prompted` |
| 20:12:42 | Le tube se ferme, `spawnGate` voit `timedOut` → `run.halted « gate could not run: timed out after 30 min »`, **4 h 16 après l'atterrissage** | journal carte |
| 20:16:49 | Nouvel atterrissage, même commit 2c74af52e, que le pre-push a validé entre-temps | journal carte, PR #529 (un seul commit) |
| 20:17:01 | Porte verte en 12 s (« tests skipped — the pre-push ran them green ») | `run.gate` |
| 20:17:19 | Verdict du lead : `finished` (18 s) | `run.decision` |

**Causes de l'attente :** 0 s pour le lead. 30 min de porte légitime, puis 3 h 46 de porte zombie
(processus tué, tube toujours ouvert).

### Carte B — « Objectif : texte mis en forme et repliable » (9ef648b8, lot ffafbde6)

| Heure | Fait | Source |
|---|---|---|
| 16:36:28 | Premier atterrissage | journal carte |
| ~16:36:29 | `stepFor` → `gate`, la carte entre dans `busy`, `runGate` est **mis en file derrière la porte de A** (`gatesWaiting`, tuile « vérification en attente ») | `gate.ts` `runGate`/`oneAtATime` |
| 16:57:18 | L'opérateur relance l'agent (critères en Markdown) → `working` | `card.operator_said` |
| 17:01:17 | Deuxième atterrissage. La promesse de porte de 16:36 est toujours en file : la carte reste dans `busy` | journal carte |
| 17:01 → 20:12 | **Rien ne peut bouger** : la file globale attend A, et `stepFor` n'est jamais appelé pour B | `run.ts` l. 463 |
| ~20:12:42 | A libère la file et la porte de B démarre (sur HEAD 8fd150f4e, la tête courante) | `oneAtATime` |
| 20:15:09 | Porte verte en ~2 min 27 (« typecheck and tests green — run here ») | `run.gate` |
| 20:15:16 | Premier tick avec B hors de `busy` : `now − landed(17:01:17) = 194 min ≥ LEAD_SILENT_MS`, aucun verdict → `run.halted « no verdict from the lead 194 min… » leadSilent` | `run.ts` l. 223-226 |
| 20:15:20 | `run.resumed` automatique | journal carte |
| 20:15:39 | Le lead rend `finished` en 15 s | `run.decision` |

**Causes de l'attente :** 3 h 11 en file derrière la porte zombie de A, 2 min 27 de porte, 0 s de lead.
L'arrêt « lead muet » est un **faux positif** : le lead n'avait reçu aucune demande.

### Le lead pendant ce temps (pane t16k)

Les verdicts sur CrewDesign et sw-to-crew s'enchaînent normalement, de 16:56 à 20:22 (une quinzaine de
`run.decision`, chacun moins de 30 s après son atterrissage). Ces dépôts n'ont **pas de porte**, donc rien
ne les retient. Les fichiers de `lead/.board/prompts` du jour (16:25, 16:39, 19:44) concernent tous des
cartes d'autres dépôts : aucune demande collie-board entre 14:40 et 20:15. Les `[board] pane t16k: prompt
did not take` du journal sont des relances de `promptAndConfirm` qui ont fini par passer.

### Le « 266 min » : un autre cas

Il ne vient pas du 23/11 mais de la carte f01de947, le 22/11 : atterrie à 09:20:52, arrêtée à 13:47:18
pour « lead muet 266 min ». Le journal montre un disque plein (`database or disk is full`) puis un
redémarrage à 10:11. Herdr est resté injoignable jusqu'à 13:47:17 : chaque snapshot est `disconnected`,
`update()` s'arrête dès sa première ligne, et le filet ne compte qu'au premier snapshot connecté. Même
symptôme (un filet qui mesure depuis l'atterrissage et se déclenche quand le coordinateur reprend la
main), cause différente.

## 2. Réponses aux questions

**Q1 — Chronologie.** Voir les tableaux ci-dessus. Qui lance la porte : le `RunCoordinator`
(`run.ts` `gate()`), au premier tick où la carte est en `review` sans `run.gate` postérieur à
l'atterrissage. Quel processus : `bash scripts/check.sh` → `bun run test` → `bun test ./bridge ./scripts`.
Quand le lead est-il sollicité : au tick qui suit une porte verte (`check`). Pour A, la première fois à
20:17. Pour B, à 20:15:20, après le faux arrêt.

**Q2 — Sérialisation.**
- Les portes sont sérialisées **globalement, pour tout le bridge** : `oneAtATime` dans `gate.ts`,
  partagé par `run.ts` et `pr-follow.ts`. Le commentaire `ponytail: one global queue; per-repo slots if…`
  l'assume.
- Oui, une porte bloquée retient les portes **de tous les lots et de tous les dépôts**, ainsi que le
  suivi des PR. Le 23/11, seul collie-board avait une porte : les autres dépôts n'ont rien senti.
- Pourquoi 4 h 16 et pas 30 min : le délai de 30 min a bien expiré, mais `proc.kill()` envoie SIGTERM au
  seul processus direct (`bash`). Les descendants (`bun run test`, `bun test`) survivent, réparentés à
  systemd, et héritent du stdout/stderr en tube. `spawnGate` attend la fin de fichier des deux tubes **et**
  `proc.exited`. Sans fin de fichier, il n'y a pas de retour, et le délai n'a rien arrêté. Le retour n'est
  venu qu'avec le `kill` manuel de 20:12:35.
- Le délai court à partir du démarrage effectif de la porte, et non de sa mise en file : une porte en file
  n'a aucune borne (B : 3 h 36 en file).

**Q3 — Pourquoi le seuil « lead muet » arrive si tard.** Deux raisons, qui se cumulent :
1. **Le filet est aveugle pendant une action en cours.** `update()` saute toute carte présente dans
   `this.busy` (`run.ts` l. 463). Une carte dont la porte attend (en file ou en cours) n'est jamais
   réévaluée : son filet ne peut pas se déclencher, que la porte dure 30 min ou 4 h.
2. **Le filet compte depuis l'atterrissage, pas depuis la demande au lead.** `since = landed` (ou la
   reprise). Il se déclenche donc au premier tick libre, même si la porte vient de passer et que le lead
   n'a jamais été interrogé. D'où 194 min pour B, 7 s après une porte verte. Le commentaire de
   `LEAD_SILENT_MS` (« past the lead's own deadlines (3 × 5 min) and a gate ») suppose une porte de
   quelques minutes et une file vide. Le 22/11 (266 min), la raison est la même par une autre voie :
   `update()` ignore les snapshots `disconnected`.

**Q4 — Le doublon de tests explique-t-il le blocage ?** Pas par une ressource partagée. Les tests du
bridge n'utilisent ni port réel ni fichier verrou commun : `:memory:` (269 occurrences),
`mkdtemp(tmpdir())`. Les `port: 8787`, `/tmp/state` de `server.test.ts` sont des valeurs de config, et
aucun serveur n'est ouvert. Le même commit 2c74af52e passe seul en 56 s, puis dans le pre-push, puis dans la
porte de 20:17 : le code n'a pas changé entre le blocage et le vert. Ce qui est établi :
- 1597943 (l'agent) ne finit jamais parce qu'un `bun test` nu à la racine ramasse `web/**.test.tsx`
  (Vitest + jsdom). `bunfig.toml` ne fixe pas de `[test] root`.
- 1899470 (la porte) : le test bloquant **n'a pas été identifié**. La concurrence avec 1597943 (CPU,
  mémoire, timers) reste plausible, mais rien ne la prouve, et un ralentissement ne fait pas 4 h.
- Surtout, quelle que soit la cause du blocage, **la porte aurait dû rendre la main à 16:26**. Le
  doublon a déclenché l'incident. C'est le kill partiel qui l'a fait durer.

**Q5 — Ce que l'opérateur ne voit pas.**
- Une **porte en cours** n'apparaît nulle part : ni sur la tuile, ni dans la carte, ni dans journalctl.
  `gate.ts` ne journalise rien, et `run.gate` n'est écrit qu'à la fin. A est restée 4 h 16 en
  « À relire » sans aucune autre indication.
- Une porte **en file** affiche « vérification en attente » (`gateWaiting`, `tile-state.ts`), sans dire
  derrière quelle carte ni depuis quand.
- Une carte « À relire » n'indique **ni depuis quand elle y est, ni ce qu'elle attend** (porte en file,
  porte en cours, lead, opérateur). La seule horloge est interne au filet, qui ne la montre qu'au
  moment où il se déclenche.
- L'arrêt « lead muet » oriente vers le pane du lead, qui n'y était pour rien.

## 3. Correctifs, du plus rentable au moins rentable

### 1. Une porte qui dépasse son délai meurt avec tous ses descendants, et rend la main tout de suite

C'est le correctif à plus fort gain : il ramène un blocage de 4 h 16 à 30 min et libère la file pour
tout le monde.
- `spawnGate` lance la porte dans son propre groupe de processus, et le délai tue le **groupe**
  (`process.kill(-pid, "SIGKILL")`, après un SIGTERM court). Après le délai, `spawnGate` n'attend plus
  la fin de fichier des tubes : il renvoie `error` sur `proc.exited` ou sur une courte échéance, quoi
  qu'il arrive aux tubes.
- `bun install` (`deps.ts`) passe aussi par `spawnGate` et en profite.
- Test dans `gate.test.ts` : une porte `sh -c 'sleep 600 & wait'` (un petit-fils qui garde le tube) avec
  un délai de 200 ms doit rendre `error` en moins d'une seconde, et le petit-fils doit être mort.
- **Fichiers :** `bridge/gate.ts`, `bridge/gate.test.ts`.

### 2. Le filet compte depuis la demande au lead et voit les cartes « occupées »

Ce correctif supprime le faux « lead muet » et arrête un lot coincé derrière une porte en ≤ 30 min, au
lieu de laisser la carte invisible.
- Dans `stepFor`, le filet part du plus récent de : atterrissage, reprise, **`run.gate` vert**. Une
  porte verte remet le compteur à zéro, puisque c'est elle qui donne la main au lead.
- Dans `update()`, une carte présente dans `busy` sur une action `gate` qui dure plus de
  `GATE_TIMEOUT_MS` + marge est arrêtée avec une raison juste : « vérification en file derrière
  <carte> depuis N min » ou « vérification bloquée depuis N min ». Il faut pour cela retenir dans le
  coordinateur l'heure de début de chaque action et son type (`busy` : `Set` → `Map<cardId, {kind, since}>`).
- Si le correctif 1 tarde, au minimum : `runGate` borne aussi l'**attente en file** (par exemple
  2 × `GATE_TIMEOUT_MS`) et rend `error « queued behind … for N min »`.
- **Fichiers :** `bridge/run.ts` (`stepFor`, `update`, `busy`), `bridge/run.test.ts`, éventuellement
  `bridge/gate.ts` (borne d'attente en file).

### 3. Rendre visible où attend une carte « À relire », et depuis quand

Ce correctif ne raccourcit aucune attente, mais il la rend lisible pour l'opérateur.
- `gate.ts` expose la porte **en cours** à côté de `gatesWaiting` : `gateRunning: Map<cardId, startedAt>`.
  Il écrit aussi une ligne `[gate] start <carte> <cmd>` / `[gate] end <carte> <issue> <durée>` dans le
  journal du bridge.
- `cards.ts` ajoute à la carte `gateSince` (et, pour une porte en file, la carte qui tient la file).
  L'interface affiche sur la tuile et dans la carte « vérification en cours depuis 12 min » ou « en
  attente derrière “…” », et pour toute carte « À relire » l'âge de l'atterrissage.
- **Fichiers :** `bridge/gate.ts`, `bridge/cards.ts`, `bridge/board-routes.ts` (clé de révision
  `deps`), `web/src/lib/board.ts`, `web/src/lib/tile-state.ts`, `web/src/routes/card.tsx`,
  `web/src/i18n/messages/board.ts`, `web/src/i18n/messages/card.ts`.

### 4. Empêcher le `bun test` nu qui ne finit jamais

C'est le correctif au plus petit gain : il traite le déclencheur de ce cas précis, pas la classe de
problèmes.
- `bunfig.toml` : `[test] root = "./bridge"` (ou une liste équivalente qui inclut `scripts/`), pour qu'un
  `bun test` lancé à la racine ne ramasse plus les tests Vitest de `web/`. À vérifier : `bun test
  ./scripts` explicite (dans `package.json`) doit rester accepté.
- **Fichiers :** `bunfig.toml` (+ une ligne dans `CLAUDE.md` § Tests si le comportement change).

Ordre conseillé : 1, puis 2 (ils sont indépendants et chacun suffirait à éviter le pire du 23/11), puis 3,
puis 4.
