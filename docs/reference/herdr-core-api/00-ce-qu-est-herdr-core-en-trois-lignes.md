# 0. Ce qu'est herdr-core, en trois lignes

**Statut :** ✅ décidé — vérifié contre herdr-core (hc)

Partie de [`HERDR_CORE_API.md`](../../../HERDR_CORE_API.md), qui en est le sommaire.

- Un **core** par utilisateur (et par machine) tient des **terminaux** (`t1`, `t2`… ou un nom). Pas
  d'espaces, pas d'onglets, pas de panneaux, pas de worktrees : ça, c'est `herdr-app` (la fenêtre), qui
  range les terminaux qui portent les labels `herdr.space=`/`herdr.tab=` **[doc]**.
- **Le statut d'un agent est annoncé par le programme lui-même** (OSC 7501) : `idle`, `working`,
  `done`, `blocked`, `error`. hc ne lit plus l'écran pour deviner **[doc]**.
- API : JSON-RPC 2.0, une ligne par message, sur `$XDG_RUNTIME_DIR/herdr-core/default.sock`. **[mesuré]**

```
$ ls $XDG_RUNTIME_DIR/herdr-core
default.holder.0d898bde.sock  default.sock
$ hc server status
{"core":{"id":"352054c9…","name":"stephane-dellpromax14…"},"live":1,"pid":72484,"version":"0.1.18",…}
```

## Protocole — différent de herdr 0.9 **[mesuré]**

**La connexion est persistante** : plusieurs requêtes sur la même socket, ids numériques acceptés.
C'est l'inverse de herdr 0.9 (une requête par connexion, `id` chaîne obligatoire).

```
$ python3 (3 requêtes sur une connexion : hello, terminal.list, terminal.get)
hello          {"id":0,"result":{"features":["framed","attach","events","status","shell",…],"generation":1,"methods":[…]}}
terminal.list  {"error":{"code":-32602,"data":{"kind":"invalid_params"},"message":"invalid type: sequence, expected a map"}}
terminal.get   {"id":2,"result":{"address":"t3","argv":["claude"],…}}
```

- `labels` en filtre est un **objet** `{"collie.card":"abc"}`, pas une liste. Avec un objet :
  `terminal.list {"labels":{"collie.card":"abc"}}` → `['t3']` **[mesuré]**.
- Erreurs : `{error:{data:{kind, hint}}}`, `kind` stable ; codes de sortie CLI 3 `not_found`,
  9 `blocked`, 10 `status_mismatch`, 11 `finished` **[doc ; 9 et 10 mesurés ci-dessous]**.
- `hc schema` = document OpenRPC complet (31 méthodes) **[mesuré]**. Liste : `hello`, `server.status|stop|restart`,
  `terminal.run|list|get|kill|rm|keep|label|read|attach|send|wait|keys|interrupt|put`, `templates.list`,
  `machine.exec|add|list|connect|rename|rm`, `file.read|write|edit`, `doc.get|set`, `events.subscribe`,
  `rpc.discover`.
- `events.subscribe` (filtrable par `terminal`, `labels`, `children_of`) envoie un instantané puis
  chaque changement, avec un `seq` monotone et des `heartbeat` **[mesuré]**. Types vus : `created`,
  `foreground`, `status`, `title`, `turn`, `size`, `finished`. **[doc]** en plus : `lost`, `restarted`,
  `keep`, `removed`, `labels`, `doc`.

---
