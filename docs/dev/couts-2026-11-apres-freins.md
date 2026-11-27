# Les freins tiennent-ils ? — une semaine après (20 au 27 novembre 2026)

**Statut :** 📏 remesure de [Où part le quota](./couts-2026-11.md) — rien n'est changé ; la note
conclut sur les freins 1 et 3, la décision revient à l'opérateur.

Freins en place depuis le 19/11 au soir : **#513** (pas de revue copilote sur une carte de lot),
**#514** (lead vidé avant chaque demande, Sonnet par défaut), **#515** (agents des cartes lancés avec
moins de MCP et de plugins). Pas appliqués : **frein 1** (cartes en Sonnet — collie-board reste réglé
sur `opus`) et **frein 3** (renouveler l'orchestrateur).

## En bref

- **Le lead coûte 3 fois moins** : 37,5 M → 12,6 M pondérés sur la semaine, contexte médian
  106 k → 51 k, 100 % Sonnet. Par carte servie : 0,21 M → 0,13 M (−40 % à modèle égal, ≈ −60 % en
  comptant le prix Sonnet). **Au-dessus de l'estimation** (−25 M sur deux semaines, soit −12 M/semaine).
- **Le copilote s'est tu** : 15,9 M → 0,0 M (une revue dans la semaine, contre 25 à 70 par jour avant).
  Estimé −44 % de son coût, constaté −100 % : presque toutes les cartes sont maintenant des cartes de lot.
- **Le socle d'un agent de carte a baissé de 9 à 13 k**, pas de 25 k : départ médian 66 k → 57 k sur
  collie-board, 78 k → 65 k sur CrewDesign. Gain ≈ 7 M sur la semaine, ≈ 3 % du board.
- **La part d'Opus dans le board passe de 75 % à 40 %** — mais **pas grâce aux freins** : CrewDesign
  a fait tourner 78 % de ses cartes en Sonnet. Les cartes collie-board sont toujours 100 % Opus.
- **Frein 1 : à rouvrir.** Sur CrewDesign, la même semaine, une carte Sonnet coûte 1,87 M contre
  2,97 M pour une carte Opus (−37 % à modèle égal), pour 5 points de suivis et relances en plus.
- **Frein 3 : le renouvellement, non ; le modèle, en réserve.** Les compactions ont déjà ramené le
  95ᵉ centile du contexte de 721 k à 199 k ; il ne reste que ≈ 10 M/semaine à gagner par une règle de
  renouvellement. L'orchestrateur est devenu le plus gros poste Opus du board (47 %).

## Méthode

Celle de la [première mesure](./couts-2026-11.md#méthode), rejouée par
[`couts-mesure.py`](./couts-mesure.py) sur une copie de `board.db` :

- **Avant** = la semaine du 12/11 22 h au 19/11 22 h ; **après** = du 20/11 0 h au 27/11 0 h. Deux
  semaines de sept jours, pour comparer des volumes égaux.
- **Contrôle** : la même règle rejouée sur la fenêtre d'origine (5–19/11) donne 1 071 M pondérés contre
  1 018 M publiés (+5 %, des transcripts réécrits depuis). Les ordres de grandeur tiennent.
- **Le volume a changé** : 178 cartes ont tourné la semaine d'avant, 100 la semaine d'après (collie-board
  104 → 25, CrewDesign 39 → 75). Les totaux bruts baissent surtout pour ça ; les comparaisons qui
  comptent sont **par carte, par appel ou par demande**.
- **Pondéré** = à modèle égal, comme avant. Le gain d'un passage Opus → Sonnet s'y voit seulement
  par le volume ; le facteur de prix (Opus ≈ 1,7 × Sonnet) reste une **hypothèse**, cité à part.
- Simplifié par rapport à la première note : les **renvois du lead** ne sont pas séparés des autres
  **suivis** de carte (les deux sont comptés dans « suivi »).

## Avant / après par poste

### Tous dépôts, une semaine chacun

| Poste | Avant | Après | Écart | Contexte médian / appel (avant → après) |
|---|---:|---:|---:|---:|
| Agents des cartes (tous sous-postes) | 270,8 M | 155,7 M | −42 % | 130 k → 150 k |
| Orchestrateurs | 71,7 M | 40,9 M | −43 % | 218 k → 165 k |
| Lead | 37,5 M | 12,6 M | −66 % | 106 k → 51 k |
| Copilote | 15,9 M | 0,0 M | −100 % | 88 k → — |
| Étape Reviewer (flux) | 13,1 M | 0 | | |
| Cartes de mesure / remesure | 8,8 M | 10,6 M | | |
| **Board** | **417,8 M** | **219,8 M** | **−47 %** | |
| Sessions manuelles (racine + worktrees sans carte) | 190,7 M | 90,2 M | −53 % | |
| **Total** | **608,5 M** | **310,0 M** | | |
| Part du board | 69 % | 71 % | | |

La part du board ne bouge pas : il a baissé autant que les sessions manuelles, dans une semaine où
tout a moins tourné. (Sur les deux semaines de la première note, le board faisait 54 % : la semaine
du 5 au 12 portait l'essentiel des sessions manuelles `overgate`.)

### Rapporté à l'activité

| Mesure | Avant | Après | Écart |
|---|---:|---:|---:|
| Lead, pondéré par carte servie (tous dépôts) | 0,21 M | 0,13 M | −40 % |
| Lead, part Opus | 79 % | 0 % | |
| Lead, contexte 95ᵉ centile | 219 k | 64 k | |
| Lead, conversations distinctes | 43 | 208 | (un `/clear` par demande) |
| Carte collie-board (Opus), pondéré moyen | 0,88 M | 0,59 M | −33 % |
| Carte CrewDesign Opus, pondéré moyen | 2,78 M | 2,97 M | +7 % |
| Carte CrewDesign Sonnet, pondéré moyen | — | 1,87 M | |
| Départ d'un agent de carte, collie-board (médiane / 5ᵉ c.) | 66 k / 35 k | 57 k / 54 k | −9 k |
| Départ d'un agent de carte, CrewDesign (médiane) | 78 k | 65 k | −13 k |
| Orchestrateur, pondéré par appel | 35 k | 23 k | −33 % |
| Orchestrateur collie-board, contexte médian / 95ᵉ c. / max | 224 / 721 / 850 k | 151 / 199 / 213 k | |
| Orchestrateur CrewDesign, contexte médian / 95ᵉ c. / max | 240 / 499 / 552 k | 170 / 309 / 352 k | |

Le 5ᵉ centile collie-board d'avant (35 k) tient à quelques départs atypiques, non examinés ; la
médiane est le bon repère.

### Part d'Opus

| | Avant | Après |
|---|---:|---:|
| Board, tous postes | 75 % | 40 % |
| Cartes collie-board | 85 % | 100 % |
| Cartes CrewDesign | 65 % (35 % Fable) | 21 % (78 % Sonnet) |
| Orchestrateurs | 100 % | 100 % |
| Lead | 79 % | 0 % |

Dans le board d'après, Opus pèse 87 M : **orchestrateurs 41 M**, cartes 46 M (dont collie-board 15 M).

## Gain réel contre gain estimé

Estimations de la première note, ramenées à une semaine (la moitié des deux semaines).

| Frein | Estimé / semaine | Constaté | Verdict |
|---|---:|---:|---|
| 2 — agents légers (#515) | ≈ 30 M par 25 k retirés | ≈ 7 M (9 à 13 k retirés) | tient, plus petit que prévu : le socle restant (≈ 55 k) n'est pas retirable par cette voie |
| 4 — lead vidé + Sonnet (#514) | ≈ 12 M | 25 M de moins sur une semaine creuse ; −40 % par carte à modèle égal | **au-dessus** |
| 5 — pas de revue copilote en lot (#513) | ≈ 5 M | ≈ 16 M (le copilote ne tourne plus) | **au-dessus** ; vérifier que le tri et la correction des cartes manuelles servent encore |

Les cartes collie-board coûtent un tiers de moins (0,88 → 0,59 M) alors qu'elles sont restées en
Opus : le socle réduit n'en explique qu'une petite part (≈ 10 k × 36 appels × 0,1 ≈ 0,04 M par
carte) ; le reste tient à des cartes plus courtes cette semaine-là (contexte médian par appel
109 k → 91 k).

## Conclusion sur les freins non appliqués

### Frein 1 — cartes en Sonnet : **à rouvrir, pour collie-board**

- CrewDesign a fait l'essai sans le vouloir : 58 cartes Sonnet et 10 cartes Opus la même semaine.
  Une carte Sonnet y coûte **−37 %** à modèle égal (≈ −60 % si le facteur de prix 1,7 tient).
- Le prix payé : suivis + relances à **16 %** du coût d'une carte Sonnet contre **11 %** pour Opus.
  C'est la marge que la première note prévoyait d'absorber.
- Collie-board est réglé `model: opus` pour le dépôt (`repo_pref`) : ses 25 cartes de la semaine ont
  toutes tourné en Opus. Le passer en Sonnet et garder *Implementer (Opus)* pour les cartes difficiles
  rendrait, au volume de la semaine d'avant (87 M de cartes), **≈ 30 M à modèle égal, ≈ 50 M avec le
  facteur de prix**. C'est aujourd'hui le plus gros gain restant.
- À suivre pendant deux lots : la part « suivi + relance » des cartes collie-board (aujourd'hui 11 %).

### Frein 3 — renouveler l'orchestrateur : **non pour le renouvellement, en réserve pour le modèle**

- Aucune remise à neuf dans la semaine (une seule conversation par orchestrateur) ; ce sont les
  **compactions** (3 sur collie-board, 7 sur CrewDesign) qui ont plafonné le contexte : 95ᵉ centile
  721 k → 199 k, coût par appel −33 %. L'essentiel du gain visé par la règle est déjà là.
- Ce qui reste : ramener la médiane de ~165 k à ~110 k ≈ 1 750 appels × 55 k × 0,1 ≈ **10 M/semaine**,
  moins une écriture de cache à chaque redémarrage, au prix du fil récent avec l'opérateur. Le bouton
  *Repartir à neuf* suffit pour les fins de lot.
- L'orchestrateur est maintenant **le plus gros poste Opus du board** (41 M sur 87 M). Le passer en
  Sonnet rendrait ≈ 17 M/semaine **si** le facteur de prix tient — à essayer **après** le frein 1,
  pour ne pas mêler deux changements de modèle dans la même mesure.

## Refaire la mesure

```bash
sqlite3 ~/.local/state/collie-board/board.db ".backup copie.db"
python3 -I docs/dev/couts-mesure.py copie.db > mesure.json   # fenêtres : WINDOWS en tête du script
```
