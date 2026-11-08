# D — Les deux vraies décisions

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

## D1. Une vue « Lecture » live — la réponse de fond au problème du texte

C'est la piste qui résout **simultanément** les trois griefs de la carte sur le texte : le double
wrap, les tableaux, et « une interface qui réécrit le markdown proprement ».

**L'idée** : le miroir terminal et le transcript ne sont pas deux écrans, ce sont **deux modes du
même écran**. Une bascule dans le header du pane :

```
[ Terminal ]  [ Lecture ]
```

- **Terminal** — le miroir actuel, inchangé. Fidèle au TUI, avec ses boutons natifs, ses grammaires
  de dialogue, son alignement de colonnes. C'est le mode pour *piloter*.
- **Lecture** — les derniers tours du transcript rendus par `MarkdownText`, avec le composer normal
  en dessous. C'est le mode pour *lire ce que l'agent a écrit*.

Pourquoi c'est la bonne réponse plutôt qu'un rafistolage du wrap : le transcript n'a **jamais été
coupé**. Le markdown y est tel que Claude l'a produit, à la source. Il n'y a pas de dé-wrap à
deviner, pas d'heuristique de recollage, pas de largeur de pane à connaître (§3.4). Le texte
reflue à la largeur du téléphone parce qu'il n'a jamais eu d'autre largeur.

**Ce que ça demande, honnêtement :**

1. **Un transcript incrémental côté bridge.** `pageEntries` ne pagine qu'en arrière (`before`,
   `bridge/transcript.ts:358-371`). Il faut un `after` (ou un `since`) pour ne tirer que les tours
   nouveaux à chaque poll. C'est symétrique de ce qui existe, et le fichier JSONL est déjà lu ligne
   à ligne.
2. **Une revalidation ciblée.** Le `shouldRevalidate: () => false` actuel (`router.tsx:53`) est
   correct pour l'archive complète ; le mode Lecture aurait besoin d'un loader distinct qui ne
   demande que la queue (les *N* derniers tours), léger à tirer toutes les 1,5 s.
3. **La bascule et son état**, à ranger avec les autres préférences d'affichage
   (`use-display-prefs.ts`), donc persistée par appareil.
4. **Les dialogues restent au Terminal.** Un menu de prompt Claude n'existe **que** dans le TUI —
   le transcript ne le contient pas. Le mode Lecture doit donc soit basculer automatiquement vers
   Terminal quand `dialogPresent` devient vrai (le signal existe déjà, `agent-chat.tsx:191-199`),
   soit afficher un bandeau « une question attend — passer au terminal ». **Ne pas traiter ce
   point, c'est livrer un mode où l'agent peut se bloquer sans qu'on le voie.**

Ce n'est pas un petit chantier. Mais c'est le seul qui traite la cause plutôt que les symptômes, il
réutilise du code déjà écrit et testé (`MarkdownText`, `TranscriptView`, le parseur), et il
laisse le miroir terminal intact pour ce qu'il fait bien.

**Note sur la contrainte du fork** (`CLAUDE.md`, *The board*) : la surface upstream touchée serait
`bridge/transcript.ts` (ajout d'un `after`) et `router.tsx`. Le reste vit dans de nouveaux fichiers.
Le `after` sur le transcript est par ailleurs générique — il marche sans qu'aucune carte soit en
vue — donc c'est un candidat pour `UPSTREAM_PRS.md`.

## D2. Trancher sur le mode clair

Trois issues, à choisir explicitement plutôt qu'à laisser pourrir :

1. **Assumer le sombre** : supprimer les tokens `:root` clairs de `index.css:6-32` et les variantes
   `dark:` orphelines. Le fichier de tokens redevient une description honnête de la réalité.
   C'est le choix ponytail, et probablement le bon pour une app de chevet.
2. **Suivre le système** : retirer `class="dark"` de `index.html:2`, poser la classe au boot depuis
   `prefers-color-scheme`. Il faut alors auditer les contrastes en clair, corriger les `bg-zinc-800`
   du §6.2, et vérifier le miroir ANSI — dont les couleurs viennent du terminal et sont pensées pour
   un fond sombre. **C'est plus de travail qu'il n'y paraît**, précisément à cause du miroir.
3. **Un réglage explicite** dans Settings (clair / sombre / système). Même coût que (2), plus l'UI.

L'important est que ce soit décidé. En l'état, la moitié du système de couleurs est du code mort
qui ment sur ses intentions.

---
