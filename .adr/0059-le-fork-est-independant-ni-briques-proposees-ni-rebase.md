# 0059 — Le fork est indépendant : ni briques proposées à l'amont, ni rebase

**Status:** Accepted (tranché par l'opérateur le 10/11/2026) — remplace en partie
[0024](./0024-the-board-speaks-the-operators-language-through-a-typed-catalog.md) (la clause « fichiers de
l'amont »), et rend caduques les règles de synchro de `CLAUDE.md`, `UPSTREAM.md` et `UPSTREAM_PRS.md`

## Context

Collie Board est né comme fork de [`AltanS/collie`](https://github.com/AltanS/collie), avec deux
engagements : rester **rebasable** (surface étroite sur les fichiers de l'amont, tenue à jour dans la
table de `UPSTREAM.md`, alimentée par un `### Upstream` dans chaque fragment) et **rendre** à l'amont ce
qui était générique (le registre `UPSTREAM_PRS.md`, une brique par fichier, mise à jour dans le commit
même).

Aucune ADR ne portait ces engagements : ils vivaient dans `CLAUDE.md` (« Keep the upstream surface
narrow », « A change that would help upstream goes in the ledger ») et dans ces deux fichiers. Plusieurs
ADR s'appuyaient dessus pour chiffrer un coût.

Ce que ça a donné : aucune brique soumise (le dépôt n'est pas un fork GitHub, il fallait un troisième
dépôt pour ouvrir une PR), aucun rebase, une ligne `bridge/server.ts` de la table devenue illisible, et
[0052](./0052-collie-v2-sur-herdr-core.md) qui prévoit que le fork cesse de parler le protocole de
l'amont. La règle coûtait à chaque carte et ne payait jamais.

## Decision

**Le fork est un projet indépendant.**

- **On ne propose plus de briques à `AltanS/collie`.** `UPSTREAM_PRS.md` et `docs/upstream/prs/` sont
  gelés : une archive, plus un registre (depuis déplacés sous `docs/archive/upstream/`). Aucune carte
  n'y ajoute d'entrée.
- **On ne rebase plus sur l'amont.** Il n'y a plus de « fichier de l'amont » : tout fichier du dépôt est
  le nôtre et se modifie comme tel. La table de `UPSTREAM.md` est gelée, et un fragment ne porte plus de
  `### Upstream`.
- **Une idée de l'amont se reprend à la main**, réécrite ici, comme n'importe quelle idée venue
  d'ailleurs — sans obligation de suivre ses versions.
- **L'attribution ne bouge pas** : licence MIT, copyright d'Altan dans `LICENSE`, section « A fork of
  Collie » du README.

Ce qui reste, pour une autre raison : **un comportement nouveau va dans un nouveau fichier, branché par
un hook, pas dans `server.ts` / `index.ts`**. Ce n'est plus un coût de rebase ; c'est que ces deux
fichiers sont ceux que toutes les cartes en vol se disputent.

## Ce que ça rend caduc ailleurs

Ces ADR ne sont pas réécrites ; seules les phrases ci-dessous ne tiennent plus.

| ADR | Ce qui tombe |
| --- | --- |
| [0024](./0024-the-board-speaks-the-operators-language-through-a-typed-catalog.md) | « tout fichier de l'amont reste en anglais codé en dur » et « si l'amont livre son catalogue, le fork l'adopte » — déjà entamé par [0038](./0038-settings-gallery-history-artifacts-join-the-catalog.md) |
| [0038](./0038-settings-gallery-history-artifacts-join-the-catalog.md) | le § Cost : plus de risque de conflit au rebase |
| [0003](./0003-vaul-owns-the-sheet-gesture.md), [0008](./0008-the-user-unit-cannot-have-a-mount-namespace.md), [0011](./0011-the-board-may-raise-an-alert-that-can-retract.md), [0050](./0050-every-action-runs-ctl-ts-because-herdr-allows-one-command-per-id.md) | les conséquences « à consigner dans `UPSTREAM.md` » / « brique N du registre » |
| [0052](./0052-collie-v2-sur-herdr-core.md) | « `UPSTREAM.md` devra dire ce qui reste partageable » : rien, c'est tranché ici |

## Consequences

- Une carte ne paie plus la synchro : ni table, ni `### Upstream`, ni registre.
- Les correctifs de l'amont (sécurité comprise) n'arrivent plus par rebase. Le socle — porte unique,
  même origine, CSP — est à nous d'entretenir ; les règles de sécurité de `CLAUDE.md` restent entières.
- `scripts/release.ts` sait encore replier un `### Upstream` dans `UPSTREAM.md`. Sans fragment qui en
  porte, ce code ne fait rien — mais la table n'existe plus dans `UPSTREAM.md` : un fragment qui en
  porterait un ferait échouer la release ; l'enlever est une carte à part (changement fonctionnel, avec fragment).
- À revoir si l'amont et le fork reconvergent sur un même moteur — peu probable après 0052.
