# Audit des notifications — Collie Board 0.117.0

> Document en français : c'est la langue de la demande. Le reste du dépôt reste en anglais.
> Rédigé le 2026-08-25 sur la branche `board/audit-pertinence-notifications`.
>
> **Ce document n'implémente rien.** C'est un inventaire, un diagnostic et un jeu de propositions.
> Chaque constat cite `fichier:ligne` pour être vérifiable et contestable séparément.

## Méthode et limites

Deux sources, croisées :

1. **Lecture de code** — la chaîne complète d'une notification, du poll herdr à l'affichage :
   `state-engine.ts` → `notifications.ts` → `notify-subtitle.ts` / `notify-log.ts` → `push.ts` →
   `web/src/lib/push-decision.ts` → `web/src/sw.ts`, plus les trois surfaces d'affichage
   (push OS, toast in-app `use-transitions.ts`, cloche `notification-bell.tsx`).
2. **Snapshot réel** de l'instance en service, lu le 2026-08-25 sur `GET /api/snapshot`
   (127.0.0.1:8788), 9 panes agents dont 3 adossés à une carte. C'est ce snapshot qui transforme
   plusieurs déductions de lecture en faits observés — ils sont signalés « *vérifié en direct* ».

Ce qui n'est **pas** couvert : le rendu réel des notifications sur iOS Safari vs Chrome Android
(troncatures exactes des titres/corps), et la latence réelle du copilot (aucune mesure faite ici,
seulement le timeout configuré).

---

## Sommaire

- [Résumé](#résumé)
- [Partie 1 — Inventaire](#partie-1--inventaire-de-ce-qui-est-émis-aujourdhui)
- [Partie 2 — Pourquoi c'est plat](#partie-2--pourquoi-cest-plat)
- [Partie 3 — Proposition de contenu](#partie-3--proposition-de-contenu)
- [Partie 4 — Règle d'événement « session terminée + carte en review »](#partie-4--règle-dévénement--session-terminée--carte-en-review-)
- [Partie 5 — Cartes à créer](#partie-5--cartes-à-créer)
- [Partie 6 — Le board comme source d'événements](#partie-6--le-board-comme-source-dévénements-notifiables-carte-n6)

---

## Résumé

→ [`docs/notify-audit/01-resume.md`](docs/notify-audit/01-resume.md)

## Partie 1 — Inventaire de ce qui est émis aujourd'hui

→ [`docs/notify-audit/02-partie-1-inventaire-de-ce-qui-est-emis-aujourd-h.md`](docs/notify-audit/02-partie-1-inventaire-de-ce-qui-est-emis-aujourd-h.md)

## Partie 2 — Pourquoi c'est plat

→ [`docs/notify-audit/03-partie-2-pourquoi-c-est-plat.md`](docs/notify-audit/03-partie-2-pourquoi-c-est-plat.md)

## Partie 3 — Proposition de contenu

→ [`docs/notify-audit/04-partie-3-proposition-de-contenu.md`](docs/notify-audit/04-partie-3-proposition-de-contenu.md)

## Partie 4 — Règle d'événement « session terminée + carte en review »

→ [`docs/notify-audit/05-partie-4-regle-d-evenement-session-terminee-cart.md`](docs/notify-audit/05-partie-4-regle-d-evenement-session-terminee-cart.md)

## Partie 5 — Cartes à créer

→ [`docs/notify-audit/06-partie-5-cartes-a-creer.md`](docs/notify-audit/06-partie-5-cartes-a-creer.md)

## Partie 6 — Le board comme source d'événements notifiables (carte N6)

- [Partie 6 — Le board comme source d'événements notifiables (carte N6)](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti.md)
- <a name="61-larbitrage--oui-sous-trois-tests-et-une-condition"></a>[6.1 L'arbitrage : oui, sous trois tests et une condition](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-01-6-1-l-arbitrage-oui-sous-trois-tests-et-une-cond.md)
- <a name="62-le-déclencheur-commun-existe-déjà-et-ce-nest-pas-une-boucle--le-journal---écrit-en-01290"></a>[6.2 Le déclencheur commun existe déjà, et ce n'est pas une boucle : le journal — ✅ écrit en 0.129.0](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-02-6-2-le-declencheur-commun-existe-deja-et-ce-n-es.md)
- <a name="63-le-recensement"></a>[6.3 Le recensement](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-03-6-3-le-recensement.md)
- <a name="64-le-socle-partagé--ce-que-ça-coûte-vraiment"></a>[6.4 Le socle partagé : ce que ça coûte vraiment](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-04-6-4-le-socle-partage-ce-que-ca-coute-vraiment.md)
- <a name="65-ce-qui-reste-hors-datteinte-et-pourquoi-ce-nest-pas-un-manque-de-courage"></a>[6.5 Ce qui reste hors d'atteinte, et pourquoi ce n'est pas un manque de courage](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-05-6-5-ce-qui-reste-hors-d-atteinte-et-pourquoi-ce.md)
- <a name="66-lordre-si-on-implémente"></a>[6.6 L'ordre, si on implémente](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-06-6-6-l-ordre-si-on-implemente.md)
- <a name="67-revue-du-2026-11-07--une-alerte--une-chose-que-seul-lopérateur-peut-faire"></a>[6.7 Revue du 2026-11-07 : une alerte = une chose que seul l'opérateur peut faire](docs/notify-audit/07-partie-6-le-board-comme-source-d-evenements-noti-07-6-7-revue-du-2026-11-07-une-alerte-une-chose-que.md)

## Ce que cet audit ne tranche pas

- **Le défaut de `NotifyPrefs.done`** (§2.7). À reconsidérer une fois N1 à N4 livrées, pas avant :
  aujourd'hui le défaut `off` est le bon réglage pour le contenu actuel.
- ~~**La coalescence** (N5). Assumée comme un acquis par le code actuel ; l'audit constate qu'elle
  coûte cher et laisse l'arbitrage à sa propre carte.~~ **Tranchée en 0.126.0 : conservée** (§3.5).
- **La longueur exacte des troncatures** par plateforme. Les propositions de §3.2 visent « court »
  sans chiffrer ; un passage sur un vrai téléphone est le seul juge.
