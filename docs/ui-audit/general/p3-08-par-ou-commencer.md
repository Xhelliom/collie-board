# Par où commencer

**Statut :** ✅ décidé — audit de l'interface, phase « Revue de l'UI » validée

Partie de [`UI_AUDIT.md`](../../../UI_AUDIT.md), qui en est le sommaire.

**Aujourd'hui, quelques lignes chacune, aucun risque** — c'est le lot qui rend l'app nettement plus
agréable pour le moins de travail :

1. **A1** — confirmer la suppression d'une carte. C'est de la perte de données, aujourd'hui, en un tap.
2. **E1 + E2 + E3 + E6a** — les trois bugs de drawer, **plus l'animation de fermeture**. Les trois
   premiers règlent la fermeture pendant la saisie et le scintillement ; le quatrième supprime la
   disparition instantanée, qui est la plus grosse part de la sensation de brutalité. ~45 lignes dans
   un seul fichier, avec les deux tests tactiles qui manquent pour qu'ils ne reviennent pas.
3. **A2 + A3** — le rouage à 20 px, et Settings qui ne montre pas l'état de la connexion.

**Ensuite, les vrais gains :**

4. **C1** — la refonte du composer : +30 % de largeur d'input, deux lignes de terminal rendues,
   toutes les cibles au standard. C'est la demande explicite de la carte.
5. **G1** — le contexte sur l'écran pane. C'est là qu'on décide de passer la main, et c'est le seul
   écran où le chiffre n'est pas affiché.
6. **B2** — pouvoir copier. Sur un outil qui sert à récupérer ce qu'un agent produit, c'est une
   lacune de fond.

**En parallèle, sans toucher au comportement** (Partie 3) :

7. **R1 + R5** — teinter les neutres, et les finitions à une ligne (`text-pretty`, `scroll-snap`,
   haptique). Une heure de travail pour le plus gros gain de ressenti du document.

**Les deux chantiers, à décider explicitement :**

8. **F1 + E7** — le board en quatre colonnes sur grand écran, et les feuilles ouvertes par la droite.
   Le seul endroit où le desktop apporte ce qu'un téléphone ne peut pas donner : tout voir d'un coup.
9. **E5** — la migration Vaul, **décidée**. Neuf sites d'appel, neuf tests à revoir, un ADR à
   écrire, et un build avant/après pour le bundle. C'est la seule décision de dépendance de tout ce
   document.
10. **D1** — la vue Lecture. C'est la seule réponse complète au problème du texte, et 60 % du code
    existe déjà — il est juste enterré derrière une icône et figé.
