bump: minor

### Added
- Partage du board d'un dépôt par git (ADR 0048 §1, §6) : interrupteur dans les réglages du projet, off par défaut, refusé à un pane agent
- Activation : sauvegarde, fetch, import des entités (commit « import ») ou reconstruction depuis le journal existant
- Désactivation : outbox et `journal_field` vidées, branche distante intacte ; avertissement avant réactivation
- État du partage : à jour, N non envoyés, lecture seule, hors ligne ; branche existante signalée
