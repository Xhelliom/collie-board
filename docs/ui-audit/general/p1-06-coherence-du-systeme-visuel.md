# 6. Cohérence du système visuel

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## 6.1 Le mode clair est du code mort

`index.html:2` force `<html lang="en" class="dark">` **en dur**. Les ~20 tokens de la palette claire
(`index.css:6-32`) ne sont donc **jamais atteints**, et `prefers-color-scheme` n'est lu nulle part.

Ce n'est pas un bug — c'est un choix défendable pour une app qu'on ouvre la nuit depuis son lit.
C'est un **piège** : la moitié du fichier de tokens décrit une réalité qui n'existe pas, et
plusieurs composants portent des variantes `dark:` (`markdown-text.tsx:28`) qui suggèrent le
contraire. Soit on assume et on supprime, soit on branche.

## 6.2 Deux surfaces échappent aux tokens

`bg-zinc-800` en dur dans le header (`app-header.tsx:66`) et dans le composer
(`composer.tsx:454`) — les deux seules surfaces de l'application qui ne suivent pas `--background`.
Ce sont, ironiquement, les deux surfaces de chrome permanentes. Ajouté à `bg-zinc-500/40` dans
`collie-home.tsx:47`.

De même, `text-yellow-500` pour les avertissements dans trois blocs de dialogue
(`multi-select-block.tsx:161`, `preview-select-block.tsx:193`, `wizard-block.tsx:216`) alors qu'il
existe un token `--status-working` prévu exactement pour cet usage (`index.css:28`).

## 6.3 La page Settings a son propre header

`routes/settings.tsx:57-69` monte un `<header>` copié-collé au lieu d'`AppHeader`. Conséquences :

- pas de marque Collie ni de retour à l'accueil par le logo ;
- **pas d'indicateur de connexion** — ni le galop du chien, ni la bannière.

C'est le seul écran de l'app où l'on ne peut pas voir que le pont ne répond plus. Or c'est
précisément l'écran où l'on va quand quelque chose ne va pas : il héberge `ConnectionInfo`, le
diagnostic de connexion (`settings.tsx:112`).

Le commentaire d'`AppHeader` dit pourtant l'intention (`app-header.tsx:51-56`) : *« The single header
shell every screen mounts […] so no caller can forget it »*. Un appelant l'a oublié.

## 6.4 Aucun moyen de copier quoi que ce soit

Recherche de `navigator.clipboard` dans `web/src/` : **une seule occurrence**, dans la bannière de
mise à jour (`update-banner.tsx`), pour copier une commande shell.

Il n'y a donc pas de bouton copier :

- sur le miroir terminal, ni sur une ligne de sortie ;
- sur un bloc de code du transcript (`markdown-text.tsx:100-106`) — pourtant `<pre>`, donc
  identifiable ;
- sur un chemin de fichier, un nom de branche (`card-tile.tsx:66`), un `cwd`.

Et la sélection manuelle, la seule voie restante, est doublement pénalisée sur mobile : le miroir
est un `<pre>` à défilement horizontal (`ansi-output.tsx:81`), et le tap sur le miroir **ouvre le
clavier** (`agent-chat.tsx:484-490`) — le code prend soin de ne pas le faire quand une sélection est
en cours, mais il faut avoir réussi la sélection d'abord.

Sur un outil dont le but est de piloter un agent depuis son téléphone, ne pas pouvoir récupérer un
chemin ou une commande que l'agent vient d'écrire est une lacune de fond.

## 6.5 Une seule barrière d'erreur pour toute l'application

`router.tsx:33` : un unique `errorElement: <RootError />`, à la racine. Aucune route enfant n'a le
sien. Une erreur de loader ou de rendu dans **n'importe quel** écran — un pane, une carte,
l'historique — vide donc l'application entière et propose « Reload » (`root.tsx:96-118`). On perd
le board et l'accueil parce qu'un pane a eu un souci.

---
