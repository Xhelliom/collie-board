# 0057 — L'orchestrateur peut écrire l'objectif, sur l'accord oral de l'opérateur

**Status:** Accepted (tranché par l'opérateur le 10/11/2026) — amends
[ADR 0056](./0056-a-repo-has-one-objective-the-operator-sets-and-validates.md) (not edited: this is its successor on the one point below)

## Context

0056 réserve toute écriture de l'objectif à l'opérateur : « sinon l'orchestrateur se fixerait son propre but
et son propre budget ». À l'usage, l'objectif se **co-écrit dans la conversation** : l'opérateur dit ce qu'il
veut, l'orchestrateur le formule, propose des critères vérifiables et un budget. L'opérateur devait ensuite
recopier ce texte à la main dans le formulaire de la page Projet — un geste qui n'ajoutait aucun contrôle,
puisqu'il venait de dire oui.

## Decision

**Le « oui » de l'opérateur dans la conversation suffit ; l'orchestrateur écrit alors l'objectif lui-même.**

- Un pane agent peut `POST /api/goals` `{repoPath, text, criteria, budget?}`, aux mêmes règles que
  l'opérateur : actif si aucun objectif n'est ouvert, sinon `queued` (objectif suivant) — le bridge choisit,
  le pane n'a pas à dire `next` ; `409` si un suivant attend déjà. La création réveille l'orchestrateur comme
  celle de l'opérateur (`goal.created`).
- **La provenance est dérivée, jamais déclarée** (ADR 0010) : `origin = agent` vient du `x-collie-pane` de
  la requête, aucun corps ne peut le poser. Le bloc Objectif affiche « écrit par l'orchestrateur », et
  l'audit porte le pane.
- Un pane agent peut `PATCH` texte, critères et budget d'un objectif **`queued` ou `active` qu'un pane a
  écrit**. Un objectif de l'opérateur, ou un objectif en pause ou déclaré, reste à l'opérateur (`403`).
- **Le second chemin est un bouton** : l'outil `set_goal` du catalogue partagé (ADR 0042), offert dans un
  bloc `collie-buttons`. Il montre le texte et les critères, demande la confirmation à double appui, et
  c'est l'appui de l'opérateur — avec ses droits — qui crée l'objectif (sans marque `agent` : il l'a posé).

**Ce qui ne bouge pas** : la pause, la reprise, l'abandon, la **validation** (`achieve`), le démarrage d'un
suivant resté orphelin (`activate`) et sa suppression restent à l'opérateur seul (`403` à tout pane).
`claimed` n'est toujours qu'une proposition.

## What this rules out

**Un objectif écrit sans accord explicite.** La garantie n'est plus dans la route : elle est dans la consigne
(`SKILL.md`, le prompt de l'orchestrateur) et dans la trace — la marque « écrit par l'orchestrateur » sur le
bloc et le réveil qui suit la création rendent visible un objectif que l'opérateur n'aurait pas voulu, et il
garde seul le geste qui l'arrête (pause, abandon). C'est un affaiblissement assumé de 0056, pas un oubli.
**Une provenance attachée à un pane précis.** Un pane est éphémère (`session`), l'objectif durable (`card`) :
on retient *qu'un agent* l'a écrit, pas lequel — donc tout pane agent peut éditer un objectif `agent`.
**Un pane qui valide, met en pause ou abandonne** — même un objectif qu'il a écrit.

## Consequences

- Colonne `goal.origin` (`agent` ou NULL), ajoutée par migration ; les objectifs existants sont de l'opérateur.
- L'orchestrateur peut relever le budget d'un objectif actif qu'il a écrit. Les bornes de 0056 (lots, quota,
  échéance) s'appliquent toujours, et le passage en pause à la borne retire l'objectif de sa main.
