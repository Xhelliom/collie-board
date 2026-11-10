# Upstream — where this fork comes from

**Statut :** ✅ décidé — le fork est indépendant ([ADR 0059](./.adr/0059-le-fork-est-independant-ni-briques-proposees-ni-rebase.md), 2026-11-10)

## Origin

Collie Board was born as a fork of [`AltanS/collie`](https://github.com/AltanS/collie): the bridge,
the security model, the PWA and the Herdr socket adapter all started there. The attribution stays:
MIT licence, Altan Sarisin's copyright in [`LICENSE`](./LICENSE) with the fork's below it, and the
« A fork of Collie » section of the [`README`](./README.md).

## Point of divergence

The last commit the two histories share is
[`85f777b7`](https://github.com/AltanS/collie/commit/85f777b7221dfe924e9066ba7177520aaead1fb9)
(2026-07-10, « Fix mobile terminal mirror rendering and viewport blowout »). Everything after it on
either side is separate work: `git merge-base` against `AltanS/collie` still answers that commit.

## No longer synchronised

- **Nothing is rebased on upstream.** There is no « upstream file » any more: every file here is
  ours and is edited as such. Upstream's fixes, security ones included, do not arrive on their own.
- **Nothing is offered back.** No brick, no pull request.
- **An upstream idea is taken by hand**, rewritten here, like an idea from anywhere else.
- No `upstream` remote is needed to work on this repo.

## Archives

- The ledger of bricks once meant for upstream, one file each:
  [`docs/archive/upstream/`](./docs/archive/upstream/UPSTREAM_PRS.md).
- The former content of this page (the table of touched upstream files, the contact and marketplace
  notes): `git show 40f95d861:UPSTREAM.md`.
