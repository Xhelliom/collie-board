# B — Peu de code, à évaluer avant de trancher

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## B1. `recent-unwrapped` — la piste la plus courte, et la plus piégeuse

Un mot à changer dans `bridge/server.ts:430`, et herdr renvoie la sortie **sans les coupes du
terminal**. Le double wrap du §3.1 disparaît : le CSS `pre-wrap` du miroir devient alors la *seule*
coupe, à la largeur réelle du téléphone. C'est exactement ce que demande la carte.

**Pourquoi ce n'est pas un simple remplacement.** Tout le sous-système `lib/harness/claude/` — la
détection des menus de prompt, des wizards, des dialogues de prévisualisation, du multi-select, et
le `stripChrome` qui retire la boîte d'input de Claude du miroir — **reconnaît des boîtes dessinées
en box-drawing**, dont la géométrie dépend de lignes de largeur fixe. Dé-wrapper peut :

- casser la détection des dialogues → plus de boutons natifs, retour au pilotage clavier ;
- casser `extractStatusLine` et `extractInputDraft` (`agent-chat.tsx:164-207`) → la statusline
  disparaît, et le brouillon échoué du §9 cesse d'être détecté ;
- déclencher le `dialogPresent` à tort ou à travers, ce qui **bloque les envois** (`composer.tsx:287`).

**Comment l'évaluer sans risque** : ajouter `recent-unwrapped` comme *source alternative* derrière
la bascule « Raw terminal » qui existe déjà (`use-display-prefs.ts:14-19`) — cette bascule désactive
déjà toutes les grammaires Claude, donc dans ce mode il n'y a rien à casser. On obtient un mode
« prose lisible, sans boutons natifs » testable en une session réelle, et la décision se prend sur
des faits.

**Verdict (mesuré le 2026-07-30, herdr 0.7.x, hôte à 236 colonnes).** Fait, et la réponse est non.

Deux faits sont tombés en le branchant pour de vrai :

1. **Ce n'était pas « un mot à changer ».** Le socket refuse `recent-unwrapped` : le nom sur le fil
   est `recent_unwrapped`, en snake_case, alors que le CLI annonce le tiret dans `--source`. Le type
   de `herdr-client.ts:114` et `HERDR_API.md` portaient tous les deux le tiret. Le remplacement
   direct décrit ci-dessus aurait rendu `invalid_request` à chaque lecture de pane.
2. **Sur un pane Claude, dé-wrapper ne change rien.** Quatre panes Claude mesurés à travers le
   bridge : 129 → 129, 97 → 97, 129 → 129, 91 → 91 lignes, et **zéro** ligne au-delà de 236
   colonnes dans les deux sources. La raison est structurelle : la TUI de Claude coupe elle-même sa
   prose à la largeur du terminal avant que le PTY ne la voie, donc il ne reste aucune coupure de
   terminal à défaire. Le double wrap du §3.1 existe bien, mais sa première coupe appartient à
   Claude — `recent_unwrapped` ne peut pas y toucher.

Le gain n'est réel que sur un pane **shell** : 599 → 501 lignes, 96 lignes logiques au-delà de 236
colonnes (une sortie de dev-server crachant du JSON d'une ligne). C'est appréciable pour lire un log
au téléphone, et sans rapport avec le problème que B1 prétendait résoudre.

La source alternative est donc livrée derrière la bascule (elle ne coûte rien et sert aux panes
shell), mais **B1 ne réduit pas le double wrap du transcript Claude**. Le seul correctif reste D1.

## B2. Copier

Deux gestes, deux endroits :

- **blocs de code du transcript** (`markdown-text.tsx:100-106`) : un petit bouton copier dans
  l'angle du `<pre>`. Le contenu est déjà une chaîne dans l'AST, donc c'est `navigator.clipboard
  .writeText(block.text)` et un ✓ éphémère. Le patron visuel existe dans `update-banner.tsx`.
- **miroir terminal** : un bouton dans la rangée View qui copie le buffer affiché. La chaîne est
  déjà là (`display` dans `agent-chat.tsx:154`).

`navigator.clipboard` exige un contexte sécurisé — comme le PWA et le push, déjà (`push.ts`). Sur
HTTP simple il faut donc désactiver le bouton plutôt que l'afficher mort ; le code de `push.ts` a
déjà le patron de détection.

## B3. Le handle qui ne sert à rien

`agent-chat.tsx:721` : passer la condition de `> 0` à `> 1`. 34 px rendus au miroir sur tous les
panes solitaires, et une affordance en moins qui ne menait nulle part.

---
