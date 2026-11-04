bump: patch

### Fixed
- Sécurité : une Origin loopback n'est acceptée en écriture que sur le port du bridge (ou listée dans `COLLIE_BOARD_ALLOWED_ORIGINS`) — une page locale ne peut plus taper dans un terminal (upstream b4d3b01)
