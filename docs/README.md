# Où chercher quoi — Collie Board

Module de la [convention](./conventions/DOC_CONVENTION.md) : **outil / plugin**. Dépôt tenu en solo
avec des agents. Les fichiers racine (`.adr/`, `ARCHITECTURE.md`, `HERDR_API.md`…) restent à leur
place : ils sont **mappés** ici (bloc `doc-paths` en bas), pas déplacés.

| Je cherche… | Fichier |
|---|---|
| Ce que fait Collie Board, l'installer, le premier usage | [`README.md`](../README.md) |
| Les règles du dépôt pour un agent, les pièges de build | [`CLAUDE.md`](../CLAUDE.md) |
| Comment on travaille : tests, versions, hooks, outillage | [`dev/README.md`](./dev/README.md) |
| Comment c'est construit, les pièges vérifiés | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Pourquoi ce choix, ce qu'on a écarté | [`.adr/`](../.adr/) ([index](../.adr/README.md)) |
| Quoi faire ensuite : la roadmap, les phases | [`plan/roadmap.md`](./plan/roadmap.md) · [`plan/etapes.md`](./plan/etapes.md) |
| Ce qu'a donné un lot terminé | [`plan/lots/`](./plan/lots/) |
| Les routes HTTP du board (cartes, roadmap, notifications…) | [`skills/collie-board/SKILL.md`](../skills/collie-board/SKILL.md) |
| L'API du socket herdr 0.9, vérifiée | [`HERDR_API.md`](../HERDR_API.md) |
| L'API de herdr-core (hc), la correspondance 0.9 → hc | [`HERDR_CORE_API.md`](../HERDR_CORE_API.md) |
| Quels agents marchent, à quel niveau | [`AGENT_COMPAT.md`](../AGENT_COMPAT.md) |
| Ajouter un agent | [`HARNESS_CONTRIBUTING.md`](../HARNESS_CONTRIBUTING.md) |
| Ce que le fork change par rapport à upstream, le coût de rebase | [`UPSTREAM.md`](../UPSTREAM.md) |
| Les briques proposables à upstream | [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md) |
| Ce qui notifie, et pourquoi (audit) | [`NOTIFY_AUDIT.md`](../NOTIFY_AUDIT.md) |
| Les constats d'interface (audits) | [`UI_AUDIT.md`](../UI_AUDIT.md) · [`ui-audit/`](./ui-audit/) |
| Faire tourner un nœud sous Windows | [`multi-machine/reconnaissance-windows.md`](./multi-machine/reconnaissance-windows.md) |
| Ce qui a changé, version par version | [`CHANGELOG.md`](../CHANGELOG.md) · fragments en attente : [`changes/`](../changes/) |
| La convention de doc elle-même | [`conventions/DOC_CONVENTION.md`](./conventions/DOC_CONVENTION.md) |
| Les pages sur mesure du projet | [`pages/`](./pages/) |

## Correspondance avec la convention

Lue par la page Documents et le bilan de doc ; elle remplace les chemins par défaut de la
convention (§4). Le plan par phase est celui du board : ses exports `plan/roadmap.md`,
`plan/etapes.md` et `plan/lots/` tiennent lieu de dossiers `P<n>-*/`. La référence d'API est
répartie entre le skill (routes du board, testé par `bridge/skill.test.ts`) et les deux
`HERDR_*_API.md` (socket).

```json doc-paths
{
  "version": 1,
  "maxFileBytes": 30000,
  "statusLine": "**Statut :**",
  "statuses": { "✅": "décidé", "🟡": "piste", "❓": "ouvert" },
  "socle": [
    { "id": "index",     "label": "Où chercher quoi",       "paths": ["docs/README.md"],          "required": true },
    { "id": "agents",    "label": "Instructions d'agents",  "paths": ["CLAUDE.md", "AGENTS.md"],  "required": true },
    { "id": "rules",     "label": "Règles par zone",        "paths": [".claude/rules/"],          "required": false },
    { "id": "adr",       "label": "Décisions (ADR)",        "paths": [".adr/", "docs/adr/"],      "required": true },
    { "id": "plan",      "label": "Plan par phase",         "paths": ["docs/plan/"],              "required": true },
    { "id": "dev",       "label": "Comment on travaille",   "paths": ["docs/dev/", "HARNESS_CONTRIBUTING.md"], "required": true },
    { "id": "changelog", "label": "Changelog",              "paths": ["CHANGELOG.md"],            "required": false },
    { "id": "fragments", "label": "Fragments de changelog", "paths": ["changes/"],                "required": false }
  ],
  "modules": {
    "outil": [
      { "id": "readme",       "label": "Présentation",    "paths": ["README.md"],                         "required": true },
      { "id": "usage",        "label": "Usage",           "paths": ["docs/usage/"],                       "required": false },
      { "id": "reference",    "label": "Référence d'API", "paths": ["docs/reference/", "skills/collie-board/SKILL.md", "HERDR_API.md", "HERDR_CORE_API.md"], "required": true },
      { "id": "architecture", "label": "Architecture",    "paths": ["ARCHITECTURE.md", "docs/architecture/"], "required": true }
    ]
  }
}
```
