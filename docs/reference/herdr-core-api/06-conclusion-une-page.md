# 6. Conclusion (une page)

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

## Ce qui se simplifie

- **Le statut de Claude est fourni, juste, et sans réglage.** OSC 7501 natif dans Claude Code
  2.1.318 : `idle/working/done/blocked`, plus `kind` (`question`/`permission`), `msg` (la question,
  la commande à approuver, l'activité en cours), `title`, et un compteur `turn`. Toute la détection par
  écran (`blocked` deviné, extrait de question, fin de tour) peut tomber.
- **Plus de shell intermédiaire.** `terminal.run` lance l'agent avec sa tâche en argument : les deux
  courses de `launchAgent` (rc du shell, agent pas encore cible) disparaissent.
- **`send` dit s'il a pris** (`started`), refuse un agent `blocked`, sait `--if idle`. `promptAndConfirm`
  passe de « taper, attendre, relire, re-taper » à « envoyer, lire `started` ».
- **Les labels portent la carte** (`collie.card=<id>`), filtrables à la source : adoption/idempotence
  sans `worktree.open`.
- **Une connexion persistante** au lieu d'une connexion par requête ; un seul flux d'événements, numéroté.
- **Parent/enfant natif** : les sous-agents d'une carte deviennent visibles (`children_of`).

## Ce qui manque dans hc

- **Worktrees** (à faire nous-mêmes en git — `bridge/git.ts` le fait déjà en partie).
- **Espaces / onglets / focus / layout** : n'existent que dans herdr-app, pilotable par `herdr-app do`
  mais seulement fenêtre ouverte **[doc]**. Tout ce que le board range « par workspace » doit être
  rangé par label ou par dépôt.
- **Notifications** (`agent.notify`) : rien côté hc ; nos push/cloche restent seuls.
- **Lecture colorée** : `terminal.read` est du texte nu ; garder l'ANSI demande `terminal.attach`.
- **Plugins et actions** : remplacés par `ctl.ts` + lanceur (§5).
- **`HERDR_PANE_ID`** : devient `HC_TERMINAL_ID` ; la provenance `agent` (ADR 0010) en dépend.
- **Statut des autres agents** (Codex, opencode, pi) : à mesurer un par un ; rien sans OSC 7501.
- **Écrans qui tiennent un agent « idle »** : sous herdr 0.9, « Teach auto mode about your
  environment? » se dit `idle` ; le bridge relit l'écran au passage à idle et le dit `blocked`
  (`web/src/lib/harness/claude/holding-screens.ts`, `bridge/state-engine.ts`). Même besoin sous hc,
  à mesurer : ce que dit OSC 7501 devant ce dialogue, et lire l'écran par `terminal.read` sinon.

## Ce qui bloque une V2

1. **L'écran de confiance fait quitter Claude** sur un `Enter` aveugle (choix par défaut « No, exit »
   en 2.1.318, mesuré). Un worktree par carte = un dossier neuf par carte. Il faut décider *avant* la
   V2 : pré-approuver le dossier, ou tâche dans l'argv + `down enter` explicite quand `reported` reste
   `false`. **Probablement déjà vrai pour le bridge 0.9 actuel** — à vérifier en priorité, hors V2.
2. **Le modèle « workspace/onglet » du board** (snapshot, UI, regroupements) n'a pas d'équivalent hc :
   c'est la plus grosse réécriture (`state-engine`, `herdr-client`, une bonne part du web).
3. **Les autres harnais** : sans OSC 7501 chez eux, la V2 serait Claude-seulement — à moins de garder
   l'adaptateur écran comme repli pour eux.
4. **Coexistence** : rien n'oblige à basculer d'un coup — **[supposé]** un second client `hc` derrière
   la même interface que `HerdrClient`, choisi par config, permettrait de faire tourner les deux pendant
   la migration. C'est la voie que la règle « garder la surface amont étroite » impose de toute façon.

---
