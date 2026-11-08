# 9. Ce qui est solide (et qu'il ne faut pas casser en corrigeant le reste)

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

Un audit qui ne liste que des défauts donne une fausse image. Ce qui suit est au-dessus de la
moyenne du métier et contraint les propositions de la Partie 2 :

- **Le gel du miroir** (`agent-chat.tsx:144-155`) : dès qu'on remonte pour lire, le texte est figé
  avec sa `revision`, en paire cohérente. C'est ce qui permet de lire un long message sans qu'il
  glisse hors de la fenêtre glissante.
- **Le garde-fou de course sur les prompts** (`agent-chat.tsx:312-339`) : un tap sur une option de
  menu re-lit le pane et re-dérive le menu avant d'envoyer la touche. Un menu qui a bougé annule le
  tap au lieu d'approuver la mauvaise option.
- **Le brouillon échoué sur la ligne `❯`** (`composer.tsx:128-263`) : détection, stabilisation sur
  1,5 s, suppression de l'écho de son propre envoi, aperçu en lecture seule, reprise explicite. Une
  centaine de lignes pour un cas limite que personne n'aurait vu venir — et qui corrompait les envois.
- **La frontière XSS, explicite et défendue** : texte d'agent → nœuds texte React, jamais de HTML.
  Écrit dans `CLAUDE.md`, redit dans `ansi-output.tsx:88` et `transcript-view.tsx:15`, et c'est la
  raison pour laquelle le parseur Markdown est écrit à la main plutôt qu'importé.
- **`safe-area-inset` systématique**, y compris en bas des feuilles et du composer.
- **La discipline de polling** : `useRevalidator` sur cadence adaptative, jamais de boucle
  parallèle, auto-guérison d'une revalidation bloquée (`use-polling.ts:79-88`), refus délibéré de
  se fier à `navigator.onLine` avec l'explication du bug réel qui l'a motivé.

---
