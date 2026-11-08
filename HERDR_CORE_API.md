# HERDR_CORE_API.md — herdr-core (`hc`) vu depuis Collie Board

Sonde du 2026-11-05. `hc 0.1.18`, `herdr-app 0.1.13`, Claude Code `2.1.318`, sur l'hôte de déploiement
(Linux). Le contrat herdr 0.9.5 que le bridge parle aujourd'hui reste [`HERDR_API.md`](HERDR_API.md).

**Installer hc pour Collie Board (Linux, Windows) : [§8](#8-installer-et-démarrer-hc-pour-collie-board).**

Chaque fait porte une étiquette :

- **[mesuré]** — commande lancée, sortie recopiée (abrégée avec `…`, chemins de test raccourcis en `$WT`).
- **[doc]** — lu dans `hc --help`, `hc --skill`, `hc schema` ou `~/.config/herdr-app/AGENTS.md`, pas rejoué.
- **[supposé]** — déduction, ni mesurée ni écrite par herdr.

Banc d'essai : un dépôt git jetable et un worktree `$WT` (branche `wt1`) dans le scratchpad, un
`hc events` qui tournait en arrière-plan pendant toute la séance. Rien n'a été créé dans le core de
l'utilisateur en dehors de terminaux nommés `probe*`/`kid`/`envp`, tous tués et supprimés à la fin.

---

## 0. Ce qu'est herdr-core, en trois lignes

→ [`docs/reference/herdr-core-api/00-ce-qu-est-herdr-core-en-trois-lignes.md`](docs/reference/herdr-core-api/00-ce-qu-est-herdr-core-en-trois-lignes.md)

## 1. Le statut de Claude Code dans hc

→ [`docs/reference/herdr-core-api/01-le-statut-de-claude-code-dans-hc.md`](docs/reference/herdr-core-api/01-le-statut-de-claude-code-dans-hc.md)

## 2. Envoyer un prompt : les courses de herdr 0.9 existent-elles encore ?

→ [`docs/reference/herdr-core-api/02-envoyer-un-prompt-les-courses-de-herdr-0-9-exist.md`](docs/reference/herdr-core-api/02-envoyer-un-prompt-les-courses-de-herdr-0-9-exist.md)

## 3. Worktrees, labels, attente, parent/enfant, machines

→ [`docs/reference/herdr-core-api/03-worktrees-labels-attente-parent-enfant-machines.md`](docs/reference/herdr-core-api/03-worktrees-labels-attente-parent-enfant-machines.md)

## 4. Tableau de correspondance herdr 0.9 → hc

→ [`docs/reference/herdr-core-api/04-tableau-de-correspondance-herdr-0-9-hc.md`](docs/reference/herdr-core-api/04-tableau-de-correspondance-herdr-0-9-hc.md)

## 5. Sans plugin herdr : installer, démarrer, mettre à jour le bridge

→ [`docs/reference/herdr-core-api/05-sans-plugin-herdr-installer-demarrer-mettre-a-jo.md`](docs/reference/herdr-core-api/05-sans-plugin-herdr-installer-demarrer-mettre-a-jo.md)

## 6. Conclusion (une page)

→ [`docs/reference/herdr-core-api/06-conclusion-une-page.md`](docs/reference/herdr-core-api/06-conclusion-une-page.md)

## 7. Windows (Collie Windows, ADR 0050)

→ [`docs/reference/herdr-core-api/07-windows-collie-windows-adr-0050.md`](docs/reference/herdr-core-api/07-windows-collie-windows-adr-0050.md)

## 8. Installer et démarrer hc pour Collie Board

→ [`docs/reference/herdr-core-api/08-installer-et-demarrer-hc-pour-collie-board.md`](docs/reference/herdr-core-api/08-installer-et-demarrer-hc-pour-collie-board.md)
