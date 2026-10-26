# 0049 — Appairage de pairs par code, depuis l'UI

**Status:** Accepted
**Date:** 2026-10-26
**Amends:** [0046](./0046-multi-machine-un-collie-central-et-des-noeuds.md) § 2 et § 4 — `node.toml`
n'est plus écrit à la main : l'UI l'écrit, par des routes de l'opérateur, et le jeton y est rangé
haché. 0046 n'est pas éditée au-delà de sa ligne de statut.
**Précise:** [0048](./0048-board-partage-par-git-pair-a-pair-multi-utilisateur.md) § 4 (comment un
jeton émis par B arrive dans le `peers.toml` de A) · [0013](./0013-the-bridge-does-not-know-its-consumers.md)
(un appel sortant de plus, borné).
**Trail:** décision opérateur du 26/10 — *« un flux d'appairage simple dans l'UI web, sans éditer
`node.toml` à la main »*.

## Context

0046 § 2 a posé la confiance entre machines : un jeton par pair, dans `node.toml` côté machine
pilotée, dans `peers.toml` (le `nodes.toml` de 0046) côté machine qui pilote, `0600`, jamais en
base. 0048 § 4 a fait de chaque Collie un pair. Le lot 2 de 0046 a livré la surface
(`bridge/node.ts`) : `/api/node/*` est un 404 tant que `node.toml` ne déclare aucun pair, le jeton
est comparé en temps constant, l'environnement est nommé par le pair et résolu localement.

Ce qui manque est le geste. Aujourd'hui, appairer A (qui pilote) et B (piloté) demande de tirer un
jeton de ≥ 32 caractères, de l'écrire dans le `node.toml` de B avec un nom et des environnements
(chemin absolu du clone compris), de le recopier dans le `peers.toml` de A, de `chmod 600` les deux,
et de redémarrer les deux bridges. Chaque étape est une occasion de fuite (le jeton passe par un
presse-papiers, un terminal, souvent un chat) ou d'erreur muette (un mode `0644` ferme la surface
avec un simple avertissement dans le journal).

Les règles de la maison qui contraignent la réponse :

- **un jeton vaut un shell** sur la machine qui l'émet (0046 § 2) ;
- **aucun chemin ne voyage**, et un environnement n'est jamais un chemin tapé (0046 § 4) ;
- **pas de nouvelle boucle** ; `session` éphémère, jamais persisté ;
- **un réglage sensible est un geste de l'opérateur**, refusé à un pane d'agent (`x-collie-pane`),
  comme l'autonomie de l'orchestrateur (`bridge/orchestrator-routes.ts`) ;
- **le bridge ne connaît pas ses consommateurs** (0013), élargi par 0046 puis 0048 § 4 aux seuls
  pairs listés dans `peers.toml`.

## Decision

### 1. Le lien est orienté ; la réciprocité est un second appairage, au choix

**A pilote B si, et seulement si, B a accepté A** : B a émis le jeton, B l'a rangé dans son
`node.toml`, A le détient dans son `peers.toml`. Le lien ne dit rien dans l'autre sens. Les pairs
restent au même niveau (0048 § 4) : aucun n'est central, chacun peut être piloté, piloter, ou les
deux.

**La réciprocité est un second appairage, dans l'autre sens, avec les mêmes gestes.** Après un
appairage réussi, A propose *« Laisser B piloter cette machine aussi ? »*, qui ouvre simplement
« Inviter un pair » chez A. Rien n'est réciproque d'office, et rien ne l'est sans un code tapé chez
celui qui accepte.

**Écarté — un appairage réciproque en un seul échange** (A joint à sa demande un jeton qu'il émet
pour B). B écrirait alors son `peers.toml` sur la foi d'une requête réseau, et commencerait à
appeler une URL que A lui a déclarée : la route d'appairage deviendrait une écriture de config et
un client sortant déclenchés de l'extérieur. Deux gestes coûtent dix secondes ; une route de moins
qui écrit ne coûte rien.

### 2. Le flux

1. **Sur B (la machine pilotée)**, Réglages → Pairs → **« Inviter un pair »**. Le bridge de B tire
   un **code court** — 8 caractères base32 de Crockford (sans `I L O U`), affiché `XXXX-XXXX`,
   40 bits —, à **usage unique**, valable **10 minutes**. Il est gardé **en mémoire seulement**
   (un redémarrage l'annule) ; **une seule invitation ouverte à la fois** : en ouvrir une nouvelle
   ferme la précédente. L'écran montre le code, le compte à rebours, un bouton « Annuler ».
2. **Sur A (la machine qui pilote)**, Réglages → Pairs → **« Ajouter un pair »** : l'URL de B
   (celle de son `tailscale serve`, `https://…`) et le code. Le navigateur envoie les deux **à son
   propre bridge** ; c'est le bridge de A qui appelle `POST <url>/api/node/pair` avec
   `{ code, name }` (`name` = le nom de A, proposé).
3. **B vérifie le code** (§ 3), tire un jeton de 32 octets aléatoires (base64url), l'inscrit dans
   son `node.toml` sous le nom de A avec l'identité Tailscale vue (§ 4), et le **renvoie dans la
   réponse**, avec son propre nom.
4. **A range** `{ name: <nom de B>, url, token }` dans son `peers.toml` (`0600`), puis lance
   « Tester la connexion » (§ 6). Le navigateur ne reçoit que le résultat : nom de B, ses
   environnements, ou la raison de l'échec.

**Le jeton ne transite jamais par le navigateur** — ni celui de A, ni celui de B : il naît dans le
bridge de B, voyage de serveur à serveur sur le `serve` HTTPS de B, et meurt dans le `peers.toml`
de A. Aucune route ne le relit vers un client ; la liste des pairs n'en montre ni la valeur, ni un
préfixe.

**L'appel sortant de A, face à 0013.** 0048 § 4 borne les clients d'un pair aux pairs de son
`peers.toml`. Cet appel vise une URL qui n'y est pas encore : l'exception s'élargit d'**un seul
appel**, vers l'URL que l'opérateur vient de taper dans une route de l'opérateur (§ 5), et pas
d'un cran de plus. Il est borné : `https://` seulement, aucune redirection suivie, délai court,
corps de réponse limité à quelques kilo-octets et validé (un nom, un jeton de la bonne forme) avant
toute écriture. Rien n'est réessayé.

**Conflit de nom.** Le nom proposé par A est validé chez B (même alphabet qu'un nom
d'environnement) ; s'il est déjà pris par un pair de B, l'appairage est refusé avec sa raison. Le
code est consommé quand même (§ 3) : l'opérateur de B renomme ou révoque l'ancien, et réinvite.

### 3. La route d'appairage — une surface bornée et décrite

`POST /api/node/pair` est la **seule** route qu'un pair sans jeton puisse joindre. Sa surface :

- **404 hors invitation ouverte.** Sans invitation en cours, la route n'existe pas — même réponse
  qu'une route inconnue. Une machine qui n'invite jamais n'expose rien de plus qu'aujourd'hui.
- **Un seul essai par invitation : le code est consommé au premier essai, valide ou invalide.**
  La prise est synchrone (avant tout `await`) : deux requêtes simultanées ne peuvent pas toutes deux
  voir l'invitation ouverte. Un code faux ferme l'invitation et répond **404**, indistinct de
  « pas d'invitation » ; la route n'a que deux réponses, 404 ou le jeton. L'écran d'invitation de B
  passe à *« invitation brûlée par un essai invalide — <identité Tailscale vue> à HH:MM »*.
  Une chance sur 2⁴⁰, une fois, dans une fenêtre de 10 minutes ouverte à la main : aucun
  compteur ni limiteur de débit n'est nécessaire, et il n'y en a pas.
- **Comparaison en temps constant**, comme `peerFor()` : les deux côtés hachés à la même longueur
  pour `timingSafeEqual`.
- **Corps borné** (quelques centaines d'octets), deux champs exactement (`code`, `name`) ; tout
  autre champ est refusé par son nom, comme pour `/api/node/launch`. Aucun chemin, aucun
  environnement, aucune permission ne s'y déclare : A reçoit un jeton de **lecture**, rien de plus
  (§ 4).
- **`checkAccess` reste devant.** L'allowlist d'hôtes et `COLLIE_BOARD_TRUSTED_USER` s'appliquent ;
  seule la règle *« une écriture sans `Origin` depuis un hôte non loopback est refusée »* cède, sur
  cette route, au code — exactement comme elle cède au jeton sur le reste de `/api/node/*`
  (0046 § 2).

Le prix accepté : un tiers du tailnet qui sait qu'une invitation est ouverte peut la **brûler**
d'un essai. Il ne gagne rien, l'opérateur le voit (avec l'identité Tailscale de l'essai) et
réinvite.

**Écarté — un code consommé seulement au premier essai valide**, avec un nombre d'essais limité.
Il faut alors un compteur par invitation, un plafond, un message par essai restant — et un code
plus long pour le même risque. Brûler au premier essai donne la borne la plus simple à énoncer.

### 4. Ce que B enregistre — jeton haché, identité Tailscale, rien d'autre

**Dans `node.toml`, le jeton est rangé haché** : `token_sha256 = "<hex>"`, jamais en clair. Le
jeton fait 256 bits aléatoires : un SHA-256 sans sel suffit (pas de dictionnaire possible), et
`peerFor()` compare déjà des condensats. Une copie de `node.toml` (sauvegarde du dossier d'état,
`cat` dans un pane) ne donne donc plus accès à B. Le clair n'existe que dans le `peers.toml` de A,
qui doit le présenter. Un `token = "…"` en clair, écrit à la main sous 0046, reste lu ; l'UI n'écrit
que la forme hachée. Conséquence : B ne peut jamais réafficher un jeton ; un `peers.toml` perdu se
répare par un nouvel appairage.

**L'identité Tailscale vue est enregistrée et affichée.** `tailscale serve` injecte
`Tailscale-User-Login` (et `Tailscale-User-Name`) sur la requête d'appairage : B les inscrit sur
l'entrée du pair (`login = "…"`), avec la date. Cette entrée devient le *« quel login est attendu
pour quel jeton »* de 0048 § 5 : une requête portant ce jeton sous un autre login est refusée.
Une requête d'appairage **sans** identité (nœud taggé, proxy de la variante C/E) est acceptée,
mais la liste l'affiche *« aucune identité Tailscale »* et aucun login n'est lié au jeton — à
l'opérateur de juger.

**Le jeton donne la lecture, pas le lancement.** Après l'appairage, la permission `launch` d'un
environnement (0048 § 4) reste à cocher par l'opérateur de B, pour ce pair, dans la liste (§ 6).
Un appairage n'ouvre donc jamais le droit de lancer un agent.

### 5. Les écritures de config sont des routes de l'opérateur

Toute route qui écrit `node.toml` ou `peers.toml` — ouvrir/annuler une invitation, ajouter un
pair, révoquer, déclarer un environnement, accorder `launch` — est une **route de l'opérateur** :
refusée en **403** à une requête qui porte `x-collie-pane`, comme `PUT /api/orchestrator/autonomy`.
Elles ne sont ni dans le serveur MCP, ni documentées dans le skill comme une route d'agent (elles
sont listées, dans `bridge/skill.test.ts`, comme les routes de l'opérateur). Seule
`POST /api/node/pair` écrit depuis le réseau, et seulement l'entrée que l'invitation de l'opérateur
a autorisée d'avance.

Ce que vaut ce refus, dit franchement : il arrête un agent qui passe par le MCP ou le skill, pas un
pane qui forgerait une requête sans l'en-tête — la même limite que l'autonomie, sous le même modèle
(*le bridge est un accès shell distant*).

**Écriture et rechargement.** La route écrit le fichier entier, atomiquement (fichier temporaire
`0600` puis `rename`), puis **remplace la config en mémoire** avec celle qu'elle vient d'écrire :
le changement est actif sans redémarrage, sans surveillance de fichier, sans boucle — *rechargé à
l'écriture*. Une édition à la main reste possible et se prend, comme aujourd'hui, au redémarrage.
Pour ne pas l'écraser en silence, la route compare le condensat du fichier sur disque à celui
qu'elle a chargé : s'ils diffèrent, elle refuse (**409**, *« `node.toml` modifié à la main —
redémarrez le bridge »*). L'UI réécrit le fichier : les commentaires écrits à la main n'y
survivent pas, et l'écran le dit.

**Écarté — surveiller le fichier** (`fs.watch`, ou un relu périodique). Un relu périodique est une
boucle ; `fs.watch` est un flux d'événements de plus à tenir, inégal d'une plateforme à l'autre
(Windows, 0046 § 7), pour un fichier que l'UI est désormais seule à écrire en usage normal.

### 6. Liste, environnements, test

- **Liste des pairs.** Chez B (*qui me pilote*) : nom, identité Tailscale vue à l'appairage, date,
  environnements où ce pair peut lancer, **« Révoquer »** (supprime l'entrée ; le jeton est mort à
  la réponse). Chez A (*qui je pilote*) : nom, URL, date, « Tester la connexion »,
  **« Oublier »** (supprime l'entrée de `peers.toml`). Révoquer chez B ne prévient pas A : son
  prochain appel reçoit 401, la liste de A le montre *« jeton refusé »*. Le dernier contact, s'il
  est affiché, est de l'état vivant : en mémoire, jamais écrit.
- **Environnements, choisis, jamais tapés.** Chez B, un environnement se déclare en choisissant
  **un dépôt parmi les dépôts connus du board** (ceux que liste déjà le sélecteur de dépôt) et **un
  agent** parmi les adaptateurs connus (`adapters/agents.toml`), plus un nom. Le bridge résout le
  chemin depuis sa propre liste ; aucune route n'accepte un chemin. C'est la règle de 0046 § 4
  (*aucun chemin ne voyage*) étendue au navigateur de l'opérateur lui-même.
- **« Tester la connexion »**, chez A : le bridge de A appelle `GET <url>/api/node/environments`
  avec le jeton et rend une des issues : *joint — B offre N environnements* · *jeton refusé (401)* ·
  *surface fermée (404)* · *injoignable*. Rien n'est réessayé ni planifié : c'est un bouton.

### 7. Options écartées

**Écarté — l'approbation sans code** (A demande, B voit *« A veut s'appairer — Accepter ? »*). La
route d'appairage serait ouverte en permanence à des demandes non sollicitées ; B accumulerait des
demandes en attente à afficher, à notifier et à faire expirer (une alerte du board qui doit savoir
se retirer, 0011) ; et un « Accepter » tapé sur un téléphone ne prouve pas que la demande vient de
la machine qu'on croit. Le code prouve que l'opérateur a lu un écran de B et tapé sur A : les deux
machines sont sous ses mains au même moment.

**Écarté — le jeton copié à la main** (B affiche le jeton, l'opérateur le colle sur A). C'est le
geste d'aujourd'hui sans l'édition de fichier : le jeton passe par le navigateur, le presse-papiers,
souvent un chat ou un gestionnaire de presse-papiers synchronisé — partout où un shell sur B ne
devrait jamais aller. Et B devrait pouvoir le réafficher, donc le garder en clair.

**Écarté — un QR code.** Les deux machines appairées sont le plus souvent des postes sans caméra ;
le QR passerait par le téléphone, donc par un troisième appareil. S'il porte le jeton, c'est
l'option précédente ; s'il porte le code, il n'apporte rien à 8 caractères qui se tapent. Rien
n'empêche de l'ajouter plus tard comme simple rendu du code, sans toucher au protocole.

## Consequences

- **Coûts acceptés.** Une route joignable sans jeton, 404 hors des 10 minutes qu'ouvre l'opérateur
  et brûlée au premier essai. Un appel sortant vers une URL tapée, une fois. Un `node.toml` réécrit
  par l'UI, sans ses commentaires. Un jeton perdu côté A ne se récupère pas : on réappaire.
- **Ce qui reste vrai.** Aucun jeton en base, ni dans le navigateur, ni en clair chez qui l'émet ;
  aucun chemin ne voyage ; aucune boucle ; `checkAccess` devant tout ; un Collie qui n'invite
  jamais expose exactement la surface d'aujourd'hui ; lancer chez B reste une permission à part,
  donnée par B, bornée par son autonomie (0048 § 4).
- **À mettre à jour quand ça atterrit** : `README.md` (section multi-machine : le geste remplace
  l'édition), le skill (routes de l'opérateur listées), `bridge/node.ts` (lecture de
  `token_sha256` et `login`).
- **Ce qui justifierait de revenir dessus.** Des invitations brûlées à répétition par un tiers (un
  code plus long, ou une ACL tailnet documentée, plutôt qu'un compteur) ; des tailnets différents
  (0048, question ouverte 1) où l'identité Tailscale vue n'est plus celle qu'on attend ; un besoin
  d'appairer sans que l'opérateur ait les deux écrans sous la main.
