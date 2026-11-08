# 6.4 Le socle partagé : ce que ça coûte vraiment

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

Le tailer est trivial ; le prix est ailleurs, et il faut le dire honnêtement. **Le pipeline de
notification est indexé par `paneId` de bout en bout.**

| Point | État aujourd'hui | Ce qu'un événement de board demande |
|---|---|---|
| Clé d'alerte | `pending` et `outstanding` sont des `Map<paneId, …>` (`notifications.ts:154-156`) | une clé opaque — `card:<id>` — le coordinateur n'a jamais besoin qu'elle soit un pane |
| Type d'alerte | `Alert.status` vaut `"blocked" \| "done"` ; `FiredAlert.paneId` est **requis** (`notifications.ts:92`, `:122`) | élargir le statut, rendre `paneId` optionnel |
| Historique | `NotifyLogEntry.paneId` requis, et `enrich()` matche dessus (`notify-log.ts:20`, `:93-96`) | même élargissement ; la cloche route **déjà** vers une carte quand il y en a une (`notification-bell.tsx:145`) — c'est une ligne |
| Marqueur | `notifyMarker` ne connaît que `blocked`/`done`+`review` (`notify-content.ts:88-90`) | une entrée par nouveau marqueur, **dans les deux copies** du fichier (bridge + web, diffées par un test) |
| Digest | `DIGEST_COUNTS` compte par marqueur (`notifications.ts:134-138`) | une ligne par nouveau marqueur, dans l'ordre d'urgence |
| Préférences | quatre booléens (`notify-prefs.ts:31-36`) | un booléen par famille — **pas un par événement**, ou l'écran de réglages devient la liste de §6.3 |
| Rétraction | `resolve()` est appelé par une transition ou une disparition de pane | le prédicat de §6.1, évalué sur `onUpdate` à côté du tailer |

## Le vocabulaire du digest — tranché avant la première implémentation (0.130.0)

La question que posait la carte « Étendre le vocabulaire du digest aux événements de board » :
`digestTitle()` compte par état (« 1 question, 2 à relire ») et ces mots décrivent des panes. Trois
réponses possibles — un état par événement, un rangement sous les états existants, ou l'exclusion du
digest. **Réponse : un seul état neuf, `Stalled`, et rien d'autre.**

- **Pas de rangement sous l'existant.** Une carte orpheline sous `Needs you` ferait dire « 4
  questions » à un digest où personne ne pose de question. C'est exactement le « 3 agents done » que
  N5 vient de supprimer, sous un autre déguisement.
- **Pas un état par événement.** B1 (le pane a disparu) et B5 (le handoff n'a jamais abouti) sont le
  **même** fait pour l'opérateur : le travail s'est arrêté et rien ne le relancera. Deux marqueurs
  pour ça donneraient deux mots pour une seule décision, et §6.4 interdit déjà la même dérive côté
  préférences.
- **Pas d'exclusion.** Hors digest, un événement de board vivrait dans un second canal — ce que §6.1
  refuse en premier lieu.

**L'ordre d'urgence**, complet : `Needs you` · `Stalled` · `Review` · `Done` — et depuis 0.132.0
`Ready` en queue, le marqueur propre que le paragraphe « Ce que le mot doit tenir » ci-dessous
réservait à B4 : dernier parce que c'est le seul état qui ne réclame rien. `Needs you` reste en
tête — un agent bloqué attend *maintenant*, sur une session ouverte ; une carte calée a déjà cessé
d'avancer et dix minutes de plus ne changent rien. `Stalled` passe devant `Review` pour la raison
symétrique : une relecture est du travail qu'on choisit, une carte calée est du travail qui n'a pas
eu lieu.

**Un digest mixte se lit `1 question, 2 stalled, 1 to review`** — un seul titre, une seule
notification, un seul slot `collie:herd`. La coalescence n'est pas touchée : c'est la même
`summarize()`, la même `Map` d'alertes en cours, avec une clé qui n'est simplement plus obligée
d'être un pane.

**Ce que le mot doit tenir.** `Stalled` doit rester vrai pour tout ce qui rejoindra cette famille
(B12 mis à part, qui est un `Review`). Si un futur fait est « une possibilité s'ouvre » et non « le
travail s'est arrêté » — B4, la dépendance débloquée — il prend son propre marqueur (`Ready`) et sa
propre préférence, comme §6.3 le dit déjà. Le test est celui-là et pas la commodité de compter.

Deux remarques de posture :

- `notifications.ts` est un **fichier upstream**. N10 y a déjà dépensé une modification profonde,
  assumée et inscrite dans [`UPSTREAM.md`](../../UPSTREAM.md). Élargir la clé et le type d'alerte est une
  dépense du même ordre — à décider consciemment, avec le ledger [`UPSTREAM_PRS.md`](../../UPSTREAM_PRS.md)
  en regard : « un coordinateur de notifications qui ne présume pas que ses alertes sont des panes »
  est une brique **générique**, donc elle y a sa place.
- Une sortie moins chère existe et mérite d'être posée : **ne servir d'abord que la cloche**.
  `NotifyLog.add()` est appelable directement (`index.ts:225` le fait déjà depuis le hook `onFire`) et
  ne traverse ni le coordinateur, ni le débounce, ni la coalescence. B7, B10 et une première version de
  B2 y tiennent sans toucher une ligne d'upstream, sans prédicat de rétraction (une histoire ne se
  rétracte pas), et sans risque de réveiller un téléphone pour rien. **C'est la version à livrer en
  premier** ; le push est l'incrément d'après, pour les seuls B1, B2, B5 et B12.
