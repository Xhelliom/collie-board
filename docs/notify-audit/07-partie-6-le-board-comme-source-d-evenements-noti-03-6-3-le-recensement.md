# 6.3 Le recensement

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

Colonnes : ce qui se passe · où c'est déjà écrit · ce que ça ouvre comme action · comment ça se
rétracte · ce que ça coûte en plus du socle (§6.4) · verdict.

| # | Événement | Déclencheur **existant** | Action ouverte | Rétraction | Coût propre | Verdict |
|---|---|---|---|---|---|---|
| **B1** | **Carte orpheline** — son pane a disparu du snapshot | `reconcile()` sur `onUpdate` → `card.status {to: "orphaned"}` (`cards.ts:260-261`) | relancer depuis le dernier handoff | la carte quitte `orphaned` | nul — le tailer suffit | **oui**, mais voir la note de masse |
| **B2** | **Review du copilot rendue** | `CopilotCoordinator.review()` → `db.createReview` (`copilot.ts:1391`) → `review.created {reviewId, verdict}` | lire le verdict, les notes, les follow-ups | la carte quitte `review`/`done`, ou est ouverte | nul ; le verdict est déjà dans le payload | **oui** — le meilleur candidat du lot |
| **B3** | **Follow-ups créés par la review** | même chemin → `card.created` avec `origin: "copilot"` (`copilot.ts:1363-1389`) | trier le backlog | — | — | **non séparément** : un décompte dans le corps de B2, jamais N cartes = N buzz |
| **B4** | **Dépendance débloquée** — le prédécesseur est `done`/`archived`, le successeur devient démarrable | `card.status {to: "done"\|"archived"}` + `WHERE depends_on = ?` (la gate est `cards.ts:626-636`) | **démarrer** la carte | la carte démarre ou quitte `ready`/`backlog` | une requête non indexée sur `card`, seulement sur un `to: done`/`archived` (rare) | **oui**, marqueur propre, **off par défaut** |
| **B5** | **Handoff échoué ou expiré** | `HandoffCoordinator.update` sur `onUpdate` → `handoff.failed` / `handoff.expired` (`handoff.ts:166`, `:191`, `:234`) | reprendre à la main — sinon la carte garde une session morte et personne ne le sait | la carte redevient live, ou est ouverte | nul | **oui** — un échec silencieux est ce qu'une notification sert le mieux |
| **B6** | **Wrapup expiré ou échoué** | `WrapupCoordinator` sur `onUpdate` → `wrapup.expired` / `wrapup.failed` (`wrapup.ts:167`, `:200`) | aucune : il manque une note de clôture, le nettoyage a suivi quand même | — | — | **non** — échoue au test 2 |
| **B7** | **Nettoyage automatique refusé** — worktree ou branche restée | `WrapupCoordinator.autoCleanup` → `cleanupCard` → `card.cleanup_failed` (`wrapup.ts:214-218`, `integrate.ts:365`, `:373`, `:382`) | décider : merger, pousser, ou jeter | ne se périme pas | nul | **cloche oui, push non** — c'est « il reste quelque chose sur ton disque », pas une urgence |
| **B8** | **Merge / PR terminés ou échoués** | routes awaitées (`board-routes.ts:851-853`) → `card.merged`, `card.pr_opened`, `card.merge_failed`, `card.pr_failed` | — | — | — | **non** — test 1 : la réponse HTTP est déjà la notification |
| **B9** | **PR mergée ou fermée sur GitHub par quelqu'un d'autre** | **aucun** — `prStatusFor` n'est lu qu'à l'ouverture de la carte, TTL 60 s, un `gh` par lecture (`integrate.ts:117-126`) | relire, nettoyer | — | **un poll réseau** | **non, et c'est structurel** (§6.5) |
| **B10** | **Échec d'une demande copilot** — `copilot.refine_failed`, `explain_failed`, `reformulate_failed`, `review_failed` | les chemins copilot, tous asynchrones (`copilot.ts:1033`, `:1137`, `:1158`, `:1342`) | re-demander | — | nul | **cloche oui, push non** — un tap dont on n'apprend jamais qu'il n'a rien produit |
| **B11** | **Démarrage de carte échoué** | `card.start_failed` — mais `startCard` est awaité par la route (`board-routes.ts:569`) | — | — | — | **non** — test 1 ; à rouvrir seulement si le start devient asynchrone |
| **B12** | **Carte entrée en `review` sans transition de pane** (le cas laissé ouvert par §4.3) | `card.status {to: "review"}` hors `reconcile` | relire | la carte quitte `review` | nul | **oui**, et c'est le complément exact de N4 : même marqueur, même destination, autre déclencheur |
| **B13** | **Run arrêté** — le coordinateur rend une carte du run à l'opérateur (tours épuisés, start refusé, PR ou checkout en échec ; ADR 0017) | `RunCoordinator.halt` → `run.halted {runId, reason}` sur la carte (`run.ts`) | reprendre la carte à la main | la carte ne se lit plus comme la halte l'a laissée — colonne, session ou handoff (`fingerprint`, comme B1/B5/B12) | nul | **oui**, marqueur `Needs you`, clé `card:<id>`. Un worker `blocked` n'est **pas** une halte : le coordinateur ne répond jamais à une question (test 3) |
| **B14** | **Run terminé** — tous les membres sont `done`/`archived` | `RunCoordinator.update` → `run.finished {runId}`, sans carte (`run.ts`) | relire, archiver | un membre change de colonne, est supprimé, ou le run n'a plus de carte (`runFingerprint`) | un `runMembers` par tick tant que l'alerte est armée | **oui**, marqueur `Done` (préférence `done`), clé `run:<id>`, tap vers le premier membre |

**Note de masse sur B1.** Un herdr redémarré fait disparaître tous les panes d'un coup : `reconcile()`
orpheline alors *tout le board* dans le même tick. C'est le risque n°1 de cette catégorie, et la
coalescence existante l'absorbe déjà (« 4 orphaned » plutôt que quatre notifications) **à condition
que B1 entre dans le slot du troupeau** — ce qui est précisément la position de §6.1. À noter aussi :
la disparition du pane rétracte au même moment l'alerte de pane qui portait dessus
(`notifications.ts:163-165`), donc l'ancienne alerte s'efface et la nouvelle arrive — c'est le bon
comportement, mais c'est un aller-retour dans un même tick qu'il faudra regarder sur l'appareil.

**Note de doublon sur B2.** Copilot actif, une carte qui atterrit produit déjà l'alerte `Review` de N4
trente secondes après la fin de session ; la review arrive minutes plus tard. Ce ne sont pas les mêmes
faits (« à relire » vs « le copilot a un avis dessus »), mais ça ferait deux buzz pour une carte. La
sortie existe déjà et ne demande rien de neuf : **si l'alerte de la carte est encore en cours, la
review l'enrichit silencieusement** — exactement ce que fait le sous-titre du copilot via
`currentSolo` (`notifications.ts:221-223`, §2.5) — **et elle ne buzze de son propre chef que si cette
alerte a déjà été rétractée**. Un seul cas la fait exister seule, et c'est le bon : la carte a été
lue, puis le verdict est tombé.

**B2 resserré (capture opérateur du 07/11/2026).** La cloche se remplissait de « Review · <carte> —
Copilot review: complete / partial ». Deux cas ne passent plus le test « il y a quelque chose à décider » :
- **une carte d'un lot** (`card.runId` posé) : c'est le lead qui juge la carte, l'avis du copilot n'est
  pas pour l'opérateur — ni cloche, ni push (`BoardNotifier.update`, `board-notify.ts`) ;
- **hors lot, un verdict `complete`** (ou absent) : il ne demande rien. Seul un verdict qui demande
  quelque chose (`partial`, `drift`…) est encore dit dans la cloche (`tell()`).

Même passe : le **lead** est exclu partout où le copilot l'est, par son pane id — transitions (`index.ts`),
toast du client, `blocked` relayé depuis un pair (le pair publie ses `boardPaneIds`). Le trou était
l'adoption au démarrage : le pane du lead n'était connu qu'à sa première requête ; `Copilot.observe()`
l'adopte désormais au tick suivant le redémarrage.

**Note de priorité sur B4.** C'est le seul événement de la liste qui **ouvre** une possibilité au lieu
d'en réclamer une, et la gate est explicitement « pas un déclencheur » (`cards.ts:626`) : rien ne doit
démarrer tout seul. Donc marqueur distinct (`Ready`, jamais `Needs you`) et préférence **off par
défaut**, dans la même logique que `done` (§2.7). Le cas « l'opérateur est justement devant le board »
est déjà couvert sans rien coder : le service worker supprime le push quand un onglet est visible
(`push-decision.ts:63`).
