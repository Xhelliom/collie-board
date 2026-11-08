# Convention de documentation d'un dépôt

**Statut :** ✅ décidé le 2026-11-06 (roadmap : « le dépôt fait foi », « un socle commun + un module par type de projet » ; d'où vient ce socle : §5).

> Ce qu'un agent pose dans un dépôt quand on lui demande « mets de l'ordre dans la doc », et ce que
> la page Documents et le bilan de doc du board lisent. Le **dépôt fait foi** : pas de wiki en base,
> pas de copie ailleurs. Un socle commun à tous les projets, plus **un** module « ce qu'on construit »
> choisi selon le type de projet.

## 0. Où chercher dans ce fichier

| Je cherche… | Section |
|---|---|
| Ce que tout dépôt doit avoir | [1. Socle commun](#1-socle-commun) |
| Ce qui change selon le projet (jeu, produit, outil, infra) | [2. Modules](#2-modules--ce-quon-construit) |
| Comment choisir le module, comment migrer un dépôt existant | [3. Choisir et migrer](#3-choisir-le-module-et-migrer) |
| Les chemins, lisibles par le code | [4. Chemins par rubrique](#4-chemins-par-rubrique-machine-lisible) |
| D'où vient le modèle, ce qu'on évite | [5. Exemples](#5-exemples--ce-quon-reprend-ce-quon-évite) |

## 1. Socle commun

Arborescence minimale, quel que soit le module :

```
AGENTS.md            # court, renvoie à docs/README.md (CLAUDE.md = lien ou 1 ligne « voir AGENTS.md »)
CHANGELOG.md         # généré depuis changes/
changes/             # un fragment par branche
docs/
  README.md          # index « où chercher quoi »
  adr/               # décisions : 0000-template.md, README.md (index + statut), NNNN-*.md
  plan/              # une phase par dossier : P<n>-<nom>/README.md, T-*.md, bilan.md
  dev/               # comment on travaille : README.md, tests, git, outillage
  <module>/          # ce qu'on construit, voir §2
.claude/rules/       # règles chargées par chemin (optionnel, voir 1.2)
```

### 1.1 `docs/README.md` — l'index « où chercher quoi »

- Un tableau à deux colonnes : **Je cherche…** → **Fichier**. Une ligne par question qu'on se pose
  vraiment (« pourquoi ce choix », « quoi faire ensuite », « comment lancer les tests »).
- C'est la seule porte d'entrée : tout fichier de `docs/` y est joignable en un ou deux liens.
- Il ne contient rien d'autre que des renvois. Pas de contenu, pas d'historique.

### 1.2 `AGENTS.md` / `CLAUDE.md` — courts

- **Un seul fichier d'instructions** : `AGENTS.md`. `CLAUDE.md` (et `GEMINI.md`, etc.) n'est qu'un
  lien symbolique ou une ligne « voir AGENTS.md ». Jamais trois textes qui divergent.
- Contenu : ce qu'est le projet en deux lignes, le renvoi à `docs/README.md`, les commandes de
  build/test, et **les erreurs typiques du projet** (« Bun ne recharge pas le service, redémarrer »).
- Pas d'histoire du projet, pas de décision argumentée (elle est dans un ADR, on y renvoie).
- Cible : moins de ~15 Ko. Les règles par zone vont dans `.claude/rules/<zone>.md` avec un
  `paths:` en frontmatter, chargées seulement quand on touche la zone (exemple d'origine : §5).

### 1.3 Ligne **Statut :** et statuts ✅ 🟡 ❓

- Tout fichier de `docs/` (hors index) commence, sous son titre, par une ligne
  `**Statut :** <emoji> <mot> — <date ou précision>`.
- Trois valeurs, pas plus :
  - ✅ **décidé** — on peut s'appuyer dessus.
  - 🟡 **piste** — proposé, pas validé ; ne pas construire dessus sans demander.
  - ❓ **ouvert** — question posée, pas de réponse.
- Les mêmes emojis marquent une ligne ou une mécanique dans un tableau (« F-037 ✅ »).
- Un ADR garde en plus son statut propre (Proposé / Accepté / Remplacé par NNNN), voir 1.4.

### 1.4 `docs/adr/` — décisions

- `0000-template.md` : Contexte · Décision · Options écartées (et pourquoi) · Conséquences.
  Les options écartées sont la raison d'être de l'ADR : c'est ce qui empêche de rouvrir le débat.
- `README.md` : index, une ligne par ADR — numéro, titre, statut (Proposé / Accepté / Remplacé par NNNN).
- Numérotation continue, `NNNN-titre-court.md`.
- **Un ADR accepté ne se modifie jamais** (sauf coquille). Une décision qui change → un nouvel ADR
  qui le remplace ; l'ancien reçoit seulement « Remplacé par NNNN » dans son statut.
- **Un seul endroit pour les décisions.** Un journal daté (`decisions.md`) est permis pour les
  arbitrages de séance trop petits pour un ADR, mais une décision n'est jamais aux deux endroits.

### 1.5 `docs/plan/` — par phase

Un dossier par phase, `P<n>-<nom-court>/` :

| Fichier | Contient |
|---|---|
| `README.md` | **Objectif** (une phrase) · **Démo de fin de phase** (ce qu'on montre, concrètement) · **Périmètre** dedans / dehors · **Tickets** (tableau : ticket, dépend de, statut) · références |
| `T-P<n>-NN-*.md` | Un ticket : but, critères d'acceptation, fichiers touchés |
| `bilan.md` | Écrit à la fin : ce qui est fait, ce qui ne l'est pas et pourquoi, ce qui part en phase suivante |

`docs/plan/README.md` liste les phases avec leur statut. Une phase close n'est pas réécrite : son
bilan fait foi. Sur un dépôt piloté par le board, la roadmap du board renvoie à ces dossiers.

### 1.6 `docs/dev/` — comment on travaille

`README.md` (index « où chercher » de la partie dev) puis un fichier par sujet : tests, git
(branches, commits), outillage, pipeline d'agents, installation du poste. Pas de « ce qu'on
construit » ici.

### 1.7 CHANGELOG à fragments

- Une branche n'écrit jamais `CHANGELOG.md` ni la version : elle ajoute `changes/<slug-de-branche>.md`
  (première ligne `bump: patch|minor|major`, puis `### Added` / `### Changed` / `### Fixed`, une
  ligne par changement). Un script sur `main` les replie en une entrée.
- Modèle : `changes/README.md` et l'ADR 0016 de Collie Board.
- Un projet sans version publiée peut s'en passer ; il garde alors son historique dans `git log`,
  pas dans un fichier tenu à la main.

### 1.8 Doc à jour dans la même PR

Une PR qui change un comportement, une décision ou un chemin met à jour la doc concernée **dans la
même PR**. « La doc suivra » veut dire « la doc ne suivra pas ».

### 1.9 Découpe au-delà de ~30 Ko

- Un fichier qui dépasse ~30 Ko (≈ 300 lignes) devient un dossier : `sujet/README.md` (sommaire)
  + un fichier par sous-sujet (`01-vision.md`, `02-format.md`…).
- Un journal qui grossit (dette, décisions) se découpe par période ou par thème, et l'ancien se
  ferme au lieu de s'allonger.
- On renvoie par un lien, on ne recopie pas d'un fichier à l'autre.

## 2. Modules « ce qu'on construit »

Un dépôt prend **un** module. Ses fichiers vivent sous `docs/` et sont tous joignables depuis
`docs/README.md`. Tous portent la ligne **Statut :**.

### 2.1 Jeu (exemple d'origine : §5)

| Chemin | Contient |
|---|---|
| `docs/gdd/` | Règles du jeu découpées par thème (`01-vision.md`, `03-roles.md`…), `questions.md` (Q-xx ouvertes), `decisions.md` (journal daté des arbitrages de design) |
| `docs/features/` | Catalogue `F-NNN`, un fichier par groupe + tableau dans `README.md` |
| `docs/scenes/` | Scènes racontées, `S-NNN-*.md` d'après `_template.md` : récit d'origine, temps forts, features extraites |
| `docs/maps/` | Une carte par fichier : plan, zones, flux |
| `docs/LORE.md` (ou `docs/lore/`) | Univers, noms, ton |
| `docs/ARCHITECTURE.md` (ou `docs/architecture/`) | Modules, réseau, systèmes |

### 2.2 Produit / SaaS (modèle : CrewDesign)

| Chemin | Contient |
|---|---|
| `docs/vision.md` | Pour qui, quel problème, ce qu'on ne fera pas |
| `docs/specs/` | Une spécification par fonctionnalité (`<fonctionnalite>.md`) : besoin, règles, cas limites, statut ; `README.md` = tableau des fonctionnalités et statuts |
| `docs/parcours/` | Parcours utilisateur, un par fichier (inscription, premier projet…) |
| `docs/risques.md` | Risques (sécurité, juridique, technique, marché) avec parade et statut |
| `docs/ARCHITECTURE.md` (ou `docs/architecture/`) | Services, données, déploiement |
| `docs/ops/` | Runbooks d'exploitation du service (voir 2.4 pour la forme) |

### 2.3 Outil / bibliothèque / plugin (modèle : Collie Board)

| Chemin | Contient |
|---|---|
| `README.md` | Ce que fait l'outil, installation, premier usage |
| `docs/usage/` | Guides par tâche (« faire X ») |
| `docs/reference/` | Référence d'API ou de CLI : chaque route / commande / option, vérifiée |
| `ARCHITECTURE.md` | Comment c'est construit, les pièges vérifiés |

Collie Board garde ses `.adr/`, `HERDR_API.md` et `ARCHITECTURE.md` à la racine : c'est une
**correspondance** (voir §3.2), pas un écart à corriger d'office.

### 2.4 Infra / ops

| Chemin | Contient |
|---|---|
| `docs/machines/` | Une machine par fichier : rôle, accès, services, ce qui en dépend |
| `docs/runbooks/` | Une procédure par fichier : quand l'utiliser, étapes numérotées, comment vérifier, comment revenir en arrière |
| `docs/reseau.md` | Topologie, noms, ports, qui parle à qui |
| `docs/incidents/` | Post-mortems datés : ce qui s'est passé, cause, ce qu'on a changé |

## 3. Choisir le module et migrer

### 3.1 Les questions que l'agent pose

Avant de proposer quoi que ce soit, l'agent lit le dépôt et pose (ou déduit, puis fait confirmer) :

1. **Type** — Qu'est-ce qu'on construit : un jeu, un produit utilisé par des clients, un outil /
   une bibliothèque / un plugin que d'autres intègrent, ou de l'infrastructure ?
2. **Public** — Qui lit cette doc : toi seul, une équipe, des contributeurs externes, des clients ?
   (Externe → `docs/usage/` et `docs/reference/` d'abord.)
3. **Solo ou équipe** — Travailles-tu seul (avec des agents) ou à plusieurs ? (Équipe → ADR et
   plan par phase obligatoires ; solo → ADR seulement pour ce qu'on serait tenté de rouvrir.)
4. **Existant** — Y a-t-il déjà une doc (dossiers, wiki, fichiers d'instructions d'agents) ? Lesquels
   font foi aujourd'hui ?

Projet hybride (un jeu avec un serveur exploité) : un module principal, et la rubrique manquante de
l'autre module empruntée telle quelle (`docs/runbooks/`). Jamais deux modules complets.

### 3.2 Dépôt existant : proposer, ne rien déplacer d'office

- L'agent **propose une correspondance** : un tableau « rubrique de la convention → fichier existant »,
  avec pour chaque ligne *garder tel quel*, *renommer*, *découper* ou *créer*.
- **Il ne déplace, ne renomme, ne supprime rien d'office.** Un chemin existant est souvent cité ailleurs
  (liens, scripts, skills, habitudes de l'opérateur).
- Une rubrique déjà couverte ailleurs est **mappée**, pas déplacée : `.adr/` peut rester `.adr/` si
  l'index le dit.
- La migration, si l'opérateur l'accepte, se fait **par PR** — une PR par lot cohérent (index + statuts ;
  découpe d'un gros fichier ; fusion des instructions d'agents), chacune relisible seule, liens réparés
  dans la même PR.
- Sur un dépôt neuf : l'agent crée le socle et le module choisi directement, avec des fichiers
  d'amorce courts (titre, ligne **Statut :** ❓, une phrase).

## 4. Chemins par rubrique (machine-lisible)

Le bloc ci-dessous est **le seul** bloc `json doc-paths` de ce fichier ; la page Documents et le
bilan de doc le lisent tel quel. `paths` : chemins relatifs à la racine du dépôt, un dossier se
termine par `/`, le premier qui existe gagne. `required` : la rubrique doit exister pour que le
bilan la compte présente. Un dépôt qui a fait une correspondance (§3.2) peut la déclarer dans
`docs/README.md` avec le même format ; elle prime sur ces chemins par défaut.

```json doc-paths
{
  "version": 1,
  "maxFileBytes": 30000,
  "statusLine": "**Statut :**",
  "statuses": { "✅": "décidé", "🟡": "piste", "❓": "ouvert" },
  "socle": [
    { "id": "index",        "label": "Où chercher quoi",       "paths": ["docs/README.md"],                      "required": true },
    { "id": "agents",       "label": "Instructions d'agents",   "paths": ["AGENTS.md", "CLAUDE.md"],             "required": true },
    { "id": "rules",        "label": "Règles par zone",         "paths": [".claude/rules/"],                     "required": false },
    { "id": "adr",          "label": "Décisions (ADR)",         "paths": ["docs/adr/", ".adr/"],                 "required": true },
    { "id": "plan",         "label": "Plan par phase",          "paths": ["docs/plan/", "plan/"],                "required": true },
    { "id": "dev",          "label": "Comment on travaille",    "paths": ["docs/dev/"],                          "required": true },
    { "id": "changelog",    "label": "Changelog",               "paths": ["CHANGELOG.md"],                       "required": false },
    { "id": "fragments",    "label": "Fragments de changelog",  "paths": ["changes/"],                           "required": false }
  ],
  "modules": {
    "jeu": [
      { "id": "gdd",          "label": "Règles du jeu",         "paths": ["docs/gdd/", "docs/GDD.md"],          "required": true },
      { "id": "features",     "label": "Features",              "paths": ["docs/features/"],                    "required": false },
      { "id": "scenes",       "label": "Scènes",                "paths": ["docs/scenes/"],                      "required": false },
      { "id": "maps",         "label": "Cartes",                "paths": ["docs/maps/"],                        "required": false },
      { "id": "lore",         "label": "Univers",               "paths": ["docs/lore/", "docs/LORE.md"],        "required": false },
      { "id": "architecture", "label": "Architecture",          "paths": ["docs/architecture/", "docs/ARCHITECTURE.md", "ARCHITECTURE.md"], "required": true }
    ],
    "produit": [
      { "id": "vision",       "label": "Vision",                "paths": ["docs/vision.md"],                    "required": true },
      { "id": "specs",        "label": "Spécifications",        "paths": ["docs/specs/", "specs/"],             "required": true },
      { "id": "parcours",     "label": "Parcours utilisateur",  "paths": ["docs/parcours/"],                    "required": false },
      { "id": "risques",      "label": "Risques",               "paths": ["docs/risques.md"],                   "required": false },
      { "id": "architecture", "label": "Architecture",          "paths": ["docs/architecture/", "docs/ARCHITECTURE.md", "ARCHITECTURE.md"], "required": true },
      { "id": "ops",          "label": "Exploitation",          "paths": ["docs/ops/"],                         "required": false }
    ],
    "outil": [
      { "id": "readme",       "label": "Présentation",          "paths": ["README.md"],                         "required": true },
      { "id": "usage",        "label": "Usage",                 "paths": ["docs/usage/"],                       "required": false },
      { "id": "reference",    "label": "Référence d'API",       "paths": ["docs/reference/"],                   "required": true },
      { "id": "architecture", "label": "Architecture",          "paths": ["ARCHITECTURE.md", "docs/ARCHITECTURE.md", "docs/architecture/"], "required": true }
    ],
    "infra": [
      { "id": "machines",     "label": "Machines",              "paths": ["docs/machines/"],                    "required": true },
      { "id": "runbooks",     "label": "Runbooks",              "paths": ["docs/runbooks/"],                    "required": true },
      { "id": "reseau",       "label": "Réseau",                "paths": ["docs/reseau.md"],                    "required": false },
      { "id": "incidents",    "label": "Incidents",             "paths": ["docs/incidents/"],                   "required": false }
    ]
  }
}
```

## 5. Exemples : ce qu'on reprend, ce qu'on évite

### Overgate (`~/git/perso/overgate`) — le modèle du socle

On reprend :
- `docs/dev/README.md` : un tableau « Je cherche… → Fichier », rien d'autre.
- `docs/plan/P<n>-*/` : `README.md` avec objectif, démo de fin de phase, périmètre dedans/dehors,
  tableau de tickets ; `T-P<n>-NN-*.md` ; `bilan.md` écrit avant la démo.
- `docs/adr/` avec `0000-template.md` et options écartées ; un ADR accepté ne se modifie pas.
- Statuts ✅ 🟡 ❓ partout ; le GDD découpé en `docs/gdd/NN-*.md`.
- `.claude/rules/*.md` avec `paths:` : les règles de la doc ne se chargent que quand on touche `docs/`.
- `CLAUDE.md` court (~5 Ko) qui renvoie aux règles.

On évite : quelques reliquats de fichiers racine (`docs/GDD.md`, `docs/FEATURES.md`) à côté de leur
version découpée — un sujet a un seul chemin.

### CrewDesign (`~/git/CrewDesign`) — le modèle du module produit

On reprend :
- `specs/` : une spécification par fonctionnalité (`spec-assemblage.md`, `spec-bom-nomenclature.md`…)
  et un index.
- `docs/ops/` : runbooks d'exploitation séparés du code.

On évite :
- **Fichiers de 100 Ko** : `plan/dette-technique.md` (~140 Ko), `plan/phase-12-workflow-documents.md`
  (~100 Ko), `plan/inbox-fil-sujet.md` (~50 Ko). Plus personne ne les lit en entier, un agent les
  tronque. → découpe à ~30 Ko (§1.9).
- **Décisions à deux endroits** : `plan/decisions.md` (~37 Ko) et `docs/adr/`. On ne sait plus
  lequel fait foi. → un seul endroit (§1.4).
- **Instructions d'agents triplées** : `AGENTS.md`, `CLAUDE.md` et `GEMINI.md` à la racine, chacun
  tenu à la main. → un seul texte, les autres en renvoient (§1.2).
