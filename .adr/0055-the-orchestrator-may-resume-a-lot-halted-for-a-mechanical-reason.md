# 0055 — L'orchestrateur peut reprendre un lot arrêté pour une raison mécanique

**Status:** Accepted — amends [ADR 0017](./0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md) (« resuming is the operator's gesture ») and extends [ADR 0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md) (not edited: this is their successor)

## Context

`POST /api/runs/<id>/resume` refusait tout appel portant `x-collie-pane` : un halt rend la carte à
l'opérateur, la reprendre était son geste. En pratique, la plupart des halts n'appellent aucune décision :
une PR pas à jour avec sa base, un pre-push rouge, un lead muet, du travail non commité, un démarrage
raté. Autonomie allumée, le dépôt restait pourtant à l'arrêt jusqu'au retour de l'opérateur, pour un
geste qu'il fait sans réfléchir. Décidé par l'opérateur le 09/11/2026.

## Decision

**Sous autonomie allumée** (ADR 0030), la reprise est aussi acceptée **du pane orchestrateur du dépôt**
(`findOrchestrator()` sur le snapshot — pas n'importe quel pane agent : un worker du lot ne se reprend
pas lui-même), quand **chaque** halt qu'elle lèverait est mécanique.

**La classification est une fonction pure, `mechanicalHalt()`** (`bridge/resume.ts`), sur le payload
du `run.halted` :

- mécanique : PR refusée « not up to date / out of date / behind », push refusé (pre-push, `failed to
  push`), `uncommitted work`, `start failed:`, aucun agent venu dans le pane, `leadSilent: true` ;
- de décision, **toujours l'opérateur** : tours du lead épuisés, « finished, yet the branch has no
  commit », et tout ce qui n'est pas reconnu (verdicts, PR fermée, CI rouge…). Les motifs de décision
  sont testés d'abord : un halt qui cite la réponse du worker ne devient pas mécanique par ses mots.

**Borne : `MAX_AUTO_RESUMES` = 3 reprises autonomes par lot.** Chaque geste marque ses `run.resumed`
d'un `auto` (son horodatage) ; on compte les gestes distincts. Au-delà : 403, la reprise redevient le
geste de l'opérateur (qui, lui, n'est jamais borné). Une constante, pas un réglage : personne n'en a
demandé un.

**Inchangé** : autonomie éteinte → 403 comme avant ; lot d'un autre poste → 403 (`lotOwnerRefusal`,
ADR 0048 §7), avant toute classification. L'audit `run.resume` porte `autonomous: true`.

## Consequences

- Un halt mécanique ne bloque plus un dépôt autonome ; un halt qui se répète (pre-push toujours rouge)
  revient à l'opérateur après trois reprises.
- Un nouveau texte de halt est **de décision par défaut** : il faut l'ajouter à `mechanicalHalt()` (et
  à son test) pour que l'orchestrateur puisse le lever.
- Rien ne réveille l'orchestrateur pour reprendre : c'est lui qui lit `halted` dans `GET /api/runs` et
  demande, le bridge juge à la demande.
