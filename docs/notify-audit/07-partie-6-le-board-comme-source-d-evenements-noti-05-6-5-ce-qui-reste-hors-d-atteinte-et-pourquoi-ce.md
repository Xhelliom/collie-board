# 6.5 Ce qui reste hors d'atteinte, et pourquoi ce n'est pas un manque de courage

**Statut :** ✅ décidé — audit des notifications, règle reprise par l'ADR 0011

Partie de [`NOTIFY_AUDIT.md`](../../NOTIFY_AUDIT.md), qui en est le sommaire.

**B9 est le seul événement réellement extérieur de tout le board**, et le seul dont le déclencheur
n'existe pas : l'état d'une PR ne se lit qu'en appelant `gh`, `prStatusFor` ne le fait qu'à l'ouverture
de la carte, et le détecter en continu serait un poll réseau — interdit par la contrainte dure. Le
tailer ne peut rien pour lui : GitHub n'écrit pas dans notre journal. La seule ouverture honnête est un
**webhook** (un événement entrant, pas une boucle), ce qui suppose une porte d'entrée ; or Collie n'en
gère qu'une, `tailscale serve`, et [ADR 0001](../../.adr/0001-one-managed-front-door.md) ferme cette
discussion. **Donc : non, et ça le reste tant que la posture d'ingress ne change pas.**

Deux autres non-décisions, assumées :

- ~~**Aucun ADR n'est écrit pour §6.1.** Un ADR ferme une option qu'on reproposera ; ici l'arbitrage
  *ouvre* — il autorise le board à émettre. Ce qui mériterait un ADR est l'inverse (« le board ne
  notifie jamais »), et ce n'est pas ce qui est tranché. La règle de §6.1, si elle est implémentée, a
  sa place en trois lignes dans `CLAUDE.md` §The board, à côté de « pas de nouvelle boucle ».~~
  **Revu le 2026-09-01 : [ADR 0011](../../.adr/0011-the-board-may-raise-an-alert-that-can-retract.md).**
  La permission ouvre, mais tout ce qui y est attaché *ferme*, et c'est là que se trouvent les options
  qu'on repropose : le second canal, la préférence par événement, le mot de digest par événement, le
  fait qui notifie sans savoir comment il s'arrête. La règle de trois lignes est bien dans `CLAUDE.md`,
  et elle lie maintenant l'ADR pour l'argument, comme `.adr/README.md` le demande. Le recensement
  événement par événement reste ici — c'est de l'audit, pas de la décision.
- **Le prédicat de rétraction n'est pas spécifié événement par événement.** La colonne « Rétraction »
  de §6.3 en donne l'intention ; sa forme exacte (lue sur la carte à chaque tick, ou armée une fois et
  vérifiée à l'affichage) est un choix d'implémentation qui appartient à la carte qui le fera.
