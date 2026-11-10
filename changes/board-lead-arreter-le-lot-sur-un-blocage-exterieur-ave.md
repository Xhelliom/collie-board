bump: minor

### Added
- Lead : verdict « bloqué par l'extérieur » {raison, geste de l'opérateur} — le lot s'arrête aussitôt avec cette raison, sans consommer de round
- Ce halt est levable par l'orchestrateur sous autonomie ou objectif actif, dans la limite de 3 reprises

### Changed
- Prompt du lead : utiliser ce verdict dès le 2e constat identique d'un blocage extérieur
