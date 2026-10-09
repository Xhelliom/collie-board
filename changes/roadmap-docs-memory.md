bump: minor

### Added
- Roadmap documentaire : détail Markdown par phase, journal de décisions ✅ décidé / 🟡 piste / ❓ ouvert (`POST /api/roadmap/decision`), exports « détaillée » (`format=md`) et « étape par étape » (`format=steps`, rendue depuis phases, lots et cartes)
- Orchestrateur : prompt de brainstorming (un thème à la fois, décisions écrites au fil de l'eau, phase « Cadrage »), note de mémoire par dépôt, jauge de contexte, alerte à 50 % et passage de main en deux taps (`/api/orchestrator/memory`, `/renew`)
