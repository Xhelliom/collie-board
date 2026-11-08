# 3. Couleur — une palette sans identité

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

**Tous les neutres sont à chroma exactement zéro.** Extrait de `index.css` :

```css
--background: oklch(0.145 0 0);   /* ← chroma 0 */
--card:       oklch(0.205 0 0);   /* ← chroma 0 */
--muted:      oklch(0.269 0 0);   /* ← chroma 0 */
--border:     oklch(1 0 0 / 12%); /* ← chroma 0 */
```

Sur **18 tokens neutres, 18 sont du gris parfaitement neutre**. Ce sont les valeurs par défaut du
thème « neutral » de shadcn, jamais modifiées.

C'est ce qui sépare une interface qui *fonctionne* d'une interface qui *a un caractère*. Les
interfaces qu'on cite en exemple (Linear, Vercel, Raycast, Arc) teintent toutes légèrement leurs
neutres — un chroma de 0,005 à 0,02 sur une teinte donnée. On ne le voit pas consciemment ; on
ressent que l'interface est « froide » ou « chaude », qu'elle a une signature. À chroma zéro, une
interface est propre et anonyme.

L'ironie est que **le projet sait le faire** : `--status-idle: oklch(0.62 0.02 250)` porte un chroma
de 0,02 sur une teinte bleue. Un seul token sur dix-huit a reçu ce traitement.

Et il y a un décalage de fond avec le produit : Collie a une mascotte, un chien qui galope en sprite
animé, un splash de démarrage soigné, un nom. **La personnalité de la marque s'arrête au sprite du
chien.** Tout le reste est un template gris.

Les cinq couleurs de statut, elles, sont bien pensées : chroma et luminosité ajustés séparément pour
le clair et le sombre, teintes distinctes et lisibles (`--status-blocked` 24° rouge,
`--status-working` 80° ambre, `--status-done` 152° vert). C'est la seule partie de la palette qui a
reçu une décision.

---
