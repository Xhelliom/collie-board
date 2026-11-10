# Deployment variants

**Statut :** ✅ décidé — guide d'usage de Collie Board

Partie de [`README.md`](../../README.md), qui en est le sommaire.

The bridge always binds **loopback only**; what changes between deployments is *what sits in front
of it* and *how a request proves who it is*. Five supported shapes — Tailscale by **person** (A),
a co-located proxy by **device** (B), a reverse proxy as the sole front door (C), an **off-host**
identity proxy reached over the tailnet (D), or any other mesh or tunnel
([E](10-deployment-variants-05-variant-e-any-other-mesh-or-tunnel-netbird-zerot.md)). Pick one.
