# 0062 — Le copilote est actif à l'installation, jamais allumé par une mise à jour

**Status:** Accepted
**Date:** 2026-11-20
**Supersedes:** la raison du défaut « off » du copilote (règle de `CLAUDE.md` « stays off by default », commentaire de `boardCopilot` dans `bridge/config.ts`).

## Context

Le copilote était éteint par défaut : c'est un second agent qui consomme le même abonnement que les
workers, et dépenser le quota de quelqu'un en arrière-plan n'était pas un défaut qu'on devait hériter
en mettant à jour. Mais le copilote est devenu le centre de Collie Board (reformulation d'une dictée en
cartes, revue après `done`) : une installation neuve qui ne l'a pas passe à côté de l'essentiel, et la
raison du « off » ne visait que la mise à jour, pas l'installation.

## Decision

- Une **installation neuve** l'active : `.env.example` porte `COLLIE_BOARD_COPILOT=on`, et `setup`
  (comme le `cp .env.example` manuel) crée le `.env` à partir de lui.
- Le **défaut du code reste `false`** (`envBool("COLLIE_BOARD_COPILOT", false)`). Une installation
  existante a déjà son `.env`, que `setup` ne réécrit jamais : sans la ligne, elle reste éteinte ;
  avec, elle garde sa valeur. Une mise à jour ne change donc jamais le réglage.
- L'éteindre se fait comme avant : `COLLIE_BOARD_COPILOT=off` dans le `.env`.

Ne pas basculer le défaut du code à `true` : ce serait allumer le copilote, et dépenser le quota, sur
chaque installation existante qui n'avait jamais écrit la ligne — exactement ce que l'ancien défaut
interdisait.

## Consequences

- Deux « défauts » coexistent : celui du fichier d'exemple (on) et celui du code (off). Le second ne
  sert qu'aux `.env` antérieurs ; ne pas les « aligner ».
- Le copilote reste sérialisé à une requête et relit depuis `--stat` : le garde-fou de quota tient
  toujours, seul le point de départ change.
- Une installation neuve dépense du quota dès sa première carte. Si cela gêne, la réponse est la
  ligne `off`, pas un retour au défaut éteint.
