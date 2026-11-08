# Audit de l'interface — Collie Board 0.40.0

> Document en français : c'est la langue de la demande. Le reste du dépôt reste en anglais.
> Rédigé le 2026-07-29 sur la branche `board/auditer-l-interface-complete-et-livrer-une-revue`.
>
> **Ce document n'implémente rien.** C'est un état des lieux + une revue de pistes. Chaque constat
> cite `fichier:ligne` pour être vérifiable, contestable, et actionnable séparément.

## Méthode et limites

L'audit est une **lecture de code** : les 96 fichiers de `web/src/` (composants, routes, hooks,
lib), plus `index.html`, `index.css`, et les points du bridge qui déterminent ce que l'interface
reçoit (`bridge/server.ts`, `HERDR_API.md`).

Les mesures en pixels sont **dérivées des classes Tailwind**, pas d'un rendu réel sur appareil
(`h-7` → 28 px, `py-2` → 16 px, base 16 px). Elles sont justes à quelques pixels près pour ce qui
est de la hauteur des barres ; elles n'intègrent pas les hauteurs de ligne exactes des textes. Un
passage sur un vrai téléphone confirmerait les totaux — il ne changerait pas les ordres de grandeur.

Ce qui n'est **pas** couvert : les performances mesurées (pas de profilage), le rendu réel sur iOS
Safari vs Chrome Android, et l'accessibilité testée au lecteur d'écran (les constats a11y ci-dessous
sont structurels, lus dans le DOM produit).

---

## Sommaire

- [Résumé](#résumé) — les huit griefs signalés et leur cause
- **[Partie 1 — Audit](#partie-1--audit)** : budget d'écran · composer · texte de l'agent · gestes
  destructeurs · accessibilité · système visuel · **feuilles (drawer)** · **board vs session** ·
  ce qui est solide
- **[Partie 2 — Revue](#partie-2--revue--pistes-damélioration)** : pistes A à G, priorisées
- **[Partie 3 — Ressenti](#partie-3--revue-du-ressenti--conformité-aux-pratiques-actuelles)** :
  responsive · typographie · couleur · motion · verdict par axe
- [Ce que l'audit ne recommande pas](#ce-que-laudit-ne-recommande-pas)
- [Par où commencer](#par-où-commencer)

## Résumé

→ [`docs/ui-audit/general/p0-01-resume.md`](docs/ui-audit/general/p0-01-resume.md)

# Partie 1 — Audit

## 1. Le budget d'écran : le problème de fond

→ [`docs/ui-audit/general/p1-01-le-budget-d-ecran-le-probleme-de-fond.md`](docs/ui-audit/general/p1-01-le-budget-d-ecran-le-probleme-de-fond.md)

## 2. Le composer — les points signalés, mesurés

→ [`docs/ui-audit/general/p1-02-le-composer-les-points-signales-mesures.md`](docs/ui-audit/general/p1-02-le-composer-les-points-signales-mesures.md)

## 3. Le texte de l'agent

→ [`docs/ui-audit/general/p1-03-le-texte-de-l-agent.md`](docs/ui-audit/general/p1-03-le-texte-de-l-agent.md)

## 4. Gestes destructeurs — l'incohérence la plus grave de l'audit

→ [`docs/ui-audit/general/p1-04-gestes-destructeurs-l-incoherence-la-plus-grave.md`](docs/ui-audit/general/p1-04-gestes-destructeurs-l-incoherence-la-plus-grave.md)

## 5. Accessibilité

→ [`docs/ui-audit/general/p1-05-accessibilite.md`](docs/ui-audit/general/p1-05-accessibilite.md)

## 6. Cohérence du système visuel

→ [`docs/ui-audit/general/p1-06-coherence-du-systeme-visuel.md`](docs/ui-audit/general/p1-06-coherence-du-systeme-visuel.md)

## 7. Les feuilles (drawers) — trois bugs distincts dans un seul fichier

→ [`docs/ui-audit/general/p1-07-les-feuilles-drawers-trois-bugs-distincts-dans-u.md`](docs/ui-audit/general/p1-07-les-feuilles-drawers-trois-bugs-distincts-dans-u.md)

## 8. Board et session : deux vues du même agent qui ne disent pas la même chose

→ [`docs/ui-audit/general/p1-08-board-et-session-deux-vues-du-meme-agent-qui-ne.md`](docs/ui-audit/general/p1-08-board-et-session-deux-vues-du-meme-agent-qui-ne.md)

## 9. Ce qui est solide (et qu'il ne faut pas casser en corrigeant le reste)

→ [`docs/ui-audit/general/p1-09-ce-qui-est-solide-et-qu-il-ne-faut-pas-casser-en.md`](docs/ui-audit/general/p1-09-ce-qui-est-solide-et-qu-il-ne-faut-pas-casser-en.md)

# Partie 2 — Revue : pistes d'amélioration

Classement par **valeur perçue ÷ risque**. « Risque » = surface upstream touchée + probabilité de
casser une des mécaniques du §9.

| # | Piste | Répond à | Effort | Risque |
|---|-------|----------|--------|--------|
| **A1** | Confirmer la suppression d'une carte | §4 | trivial | nul |
| **A2** | Agrandir le rouage Settings | §5.1 | trivial | nul |
| **A3** | Settings passe sur `AppHeader` | §6.3 | trivial | nul |
| **A4** | Unifier la couleur de surlignage | §3.5 | trivial | nul |
| **E1** | **Feuilles : filtrer la cible du glissement** | §7.1 | trivial | nul |
| **E2** | **Feuilles : remettre `dragY` à 0 en fermant** | §7.2 | trivial | nul |
| **E3** | **Feuilles : stabiliser `onClose`** | §7.3 | trivial | nul |
| **B1** | Essayer `recent-unwrapped` | §3.1 | faible | **élevé** |
| **B2** | Bouton copier sur le miroir et les blocs de code | §6.4 | faible | faible |
| **B3** | Masquer le handle quand il n'y a qu'un pane | §1.2 | trivial | faible |
| **E4** | Feuilles : verrou du body + transform hors React | §7.4 | faible | faible |
| **E6a** | **Feuilles : une animation de fermeture** | §7.5a | faible | nul |
| **E7** | **Feuilles : drawer latéral droit sur grand écran** (même composant) | §7.6 | faible | faible |
| **G1** | **Le contexte sur l'écran pane et l'accueil** | §8.1 | faible | faible |
| **G2** | Aligner les champs des deux cartes | §8.3 | faible | nul |
| **C1** | Refonte du composer : une rangée au lieu de trois | §2 | moyen | moyen |
| **C2** | Tableaux dans le parseur Markdown | §3.2 | moyen | faible |
| **C3** | Réparer la hiérarchie de titres | §5.2 | faible | nul |
| **C4** | `errorElement` par route | §6.5 | faible | faible |
| **F1** | **Board en colonnes sur grand écran** | desktop | moyen | faible |
| **F2** | Élargir les autres écrans au-delà de 640 px | desktop | moyen | moyen |
| **G3** | Calculer le contexte pour tout pane, pas seulement ceux d'une carte | §8.2 | moyen | faible |
| **D1** | **Vue « Lecture » live sur le transcript** | §3.1, §3.2, §3.3 | **élevé** | moyen |
| **D2** | Trancher le mode clair | §6.1 | faible | faible |
| **E5** | **Migrer les feuilles sur Vaul** — *décidé, cf. §E5* | §7.5, §7.7 | moyen | moyen |
| ~~E6b–d~~ | ~~vélocité, seuil proportionnel, élasticité~~ — sans objet si E5 | §7.5b-e | — | — |

---

## A — À faire sans discuter (quelques lignes chacune)

→ [`docs/ui-audit/general/p2-01-a-a-faire-sans-discuter-quelques-lignes-chacune.md`](docs/ui-audit/general/p2-01-a-a-faire-sans-discuter-quelques-lignes-chacune.md)

## B — Peu de code, à évaluer avant de trancher

→ [`docs/ui-audit/general/p2-02-b-peu-de-code-a-evaluer-avant-de-trancher.md`](docs/ui-audit/general/p2-02-b-peu-de-code-a-evaluer-avant-de-trancher.md)

## C — Chantiers moyens

→ [`docs/ui-audit/general/p2-03-c-chantiers-moyens.md`](docs/ui-audit/general/p2-03-c-chantiers-moyens.md)

## D — Les deux vraies décisions

→ [`docs/ui-audit/general/p2-04-d-les-deux-vraies-decisions.md`](docs/ui-audit/general/p2-04-d-les-deux-vraies-decisions.md)

## E — Les feuilles

→ [`docs/ui-audit/general/p2-05-e-les-feuilles.md`](docs/ui-audit/general/p2-05-e-les-feuilles.md)

## F — Le mode desktop, et le vrai Kanban

→ [`docs/ui-audit/general/p2-06-f-le-mode-desktop-et-le-vrai-kanban.md`](docs/ui-audit/general/p2-06-f-le-mode-desktop-et-le-vrai-kanban.md)

## G — Faire dire la même chose aux deux vues

→ [`docs/ui-audit/general/p2-07-g-faire-dire-la-meme-chose-aux-deux-vues.md`](docs/ui-audit/general/p2-07-g-faire-dire-la-meme-chose-aux-deux-vues.md)

# Partie 3 — Revue du ressenti : conformité aux pratiques actuelles

Les deux premières parties traitent de défauts : ce qui casse, ce qui gêne. Celle-ci traite de
**craft** — est-ce que l'interface est au niveau de ce qu'on attend d'une app web en 2026, sur trois
axes : responsive, patterns modernes, qualité visuelle.

Tout ce qui suit est **compté**, pas ressenti. Les commandes sont reproductibles sur `web/src/`.

## Le constat central : le code est artisanal, le design est par défaut

C'est le contraste le plus frappant de tout cet audit.

D'un côté, quelqu'un a écrit **une centaine de lignes** pour gérer un brouillon échoué sur la ligne
`❯` d'un terminal — un cas limite que personne n'aurait vu venir, avec stabilisation temporelle,
suppression d'auto-écho et reprise explicite. Quelqu'un a implémenté un garde-fou de course qui
re-dérive un menu depuis une lecture fraîche avant d'envoyer une touche. Quelqu'un a documenté
pourquoi `navigator.onLine` ne doit pas gater le polling, avec le bug réel à l'appui.

De l'autre : **aucune échelle typographique n'a été décidée**, **aucune police n'a été choisie**,
**aucun breakpoint n'a été posé**, et la palette est celle qui sort de la boîte shadcn, chroma zéro,
jamais touchée.

Ce n'est pas de la négligence — c'est que l'effort est allé **entièrement** dans le comportement, et
jamais dans la forme. Le résultat est une application qui marche remarquablement bien et qui
ressemble à un template.

---

## 1. Responsive — le mot ne s'applique pas

→ [`docs/ui-audit/general/p3-01-responsive-le-mot-ne-s-applique-pas.md`](docs/ui-audit/general/p3-01-responsive-le-mot-ne-s-applique-pas.md)

## 2. Typographie — aucune échelle n'a été décidée

→ [`docs/ui-audit/general/p3-02-typographie-aucune-echelle-n-a-ete-decidee.md`](docs/ui-audit/general/p3-02-typographie-aucune-echelle-n-a-ete-decidee.md)

## 3. Couleur — une palette sans identité

→ [`docs/ui-audit/general/p3-03-couleur-une-palette-sans-identite.md`](docs/ui-audit/general/p3-03-couleur-une-palette-sans-identite.md)

## 4. Feedback, états et motion

→ [`docs/ui-audit/general/p3-04-feedback-etats-et-motion.md`](docs/ui-audit/general/p3-04-feedback-etats-et-motion.md)

## 5. Ce qui est réellement moderne — et à ne pas perdre de vue

→ [`docs/ui-audit/general/p3-05-ce-qui-est-reellement-moderne-et-a-ne-pas-perdre.md`](docs/ui-audit/general/p3-05-ce-qui-est-reellement-moderne-et-a-ne-pas-perdre.md)

## 6. Verdict par axe

| Axe demandé | Verdict | Ce qui le porte |
|---|---|---|
| **Interface web responsive** | **Non** | 2 breakpoints en tout ; `max-w-screen-sm` est une contrainte, pas une adaptation |
| **Interface moderne (patterns)** | **Oui, largement** | polling adaptatif, gel de lecture, PWA, offline, gardes de course, a11y sémantique |
| **Socle technique moderne** | **Oui** | oklch, dvh, field-sizing, `:has()`, Tailwind 4, safe-area |
| **Éléments visuellement modernes et bien pensés** | **Non — jamais décidés** | pas d'échelle typo (19 % de valeurs arbitraires), pas de police, chroma 0, pas de courbes de motion |

En une phrase : **c'est une application très bien construite qui n'a jamais reçu de direction
artistique.** Ce qui relève du comportement est au-dessus de la moyenne du métier ; ce qui relève de
la forme est resté au réglage d'usine.

Une précision, parce qu'elle compte : « moderne » n'est pas une fin en soi. La densité élevée est
défendable pour un outil de pilotage, le refus des fioritures aussi, et une bonne partie du charme
de ce produit vient de sa sobriété. Le problème n'est pas que les choix soient austères — c'est
qu'**ils n'ont pas été faits**.

---

## 7. Cinq gestes qui changeraient le ressenti

→ [`docs/ui-audit/general/p3-07-cinq-gestes-qui-changeraient-le-ressenti.md`](docs/ui-audit/general/p3-07-cinq-gestes-qui-changeraient-le-ressenti.md)

## Ce que l'audit ne recommande pas

→ [`docs/ui-audit/general/p3-07-ce-que-l-audit-ne-recommande-pas.md`](docs/ui-audit/general/p3-07-ce-que-l-audit-ne-recommande-pas.md)

## Par où commencer

→ [`docs/ui-audit/general/p3-08-par-ou-commencer.md`](docs/ui-audit/general/p3-08-par-ou-commencer.md)
