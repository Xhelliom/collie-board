bump: minor

### Added
- Réglages → Pairs : « Inviter un pair » (code à usage unique, 10 min, compte à rebours) et « Ajouter un pair » (URL + code, réciprocité proposée) — ADR 0049
- `POST /api/node/pair`, 404 hors invitation, brûlée au premier essai, comparaison en temps constant
- Liste des pairs (identité Tailscale, date, révocation immédiate, test de connexion, oubli) ; routes `/api/peers/*` refusées à un `x-collie-pane`

### Changed
- `node.toml` range les jetons hachés (`token_sha256`), lie le login Tailscale vu à l'appairage et borne le lancement par pair (`launch`) ; rechargé à l'écriture, sans redémarrage
- `node.toml` et `peers.toml` sortent de la sauvegarde, dans les deux sens
