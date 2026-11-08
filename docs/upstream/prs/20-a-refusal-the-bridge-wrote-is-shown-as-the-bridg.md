# 20. 🔵 A refusal the bridge wrote is shown as the bridge wrote it

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

The bridge answers every refusal it decides itself with `{"ok":false,"error":"…","kind":"…"}`, where
`error` is a sentence written for a person ("3 agents already running — finish or hand one off
first"). `api.ts` then threw `"<path> → <status> <body>"`, so a phone showed a url, a status code,
and — off the right edge, past the JSON braces — the only half that says what to do. Reported exactly
that way: *"I get an error message /api/etc, something like that."*

| | |
|---|---|
| Commit | `5a7514c` *fix(web): a refusal shows the bridge's sentence, not the url and the status code* |
| Files | `web/src/lib/api.ts` (`errorDetail` → `apiError`), `web/src/lib/api.test.ts` |
| Extraction | **Clean cherry-pick.** No card in sight — every `{ok:false,error}` responder upstream (`/reply`, `/keys`, `/upload`, the pane routes) gains the same thing. |

One function, at the single place the message is built, so no caller has to remember to unwrap it —
the fork had a `boardErrorMessage()` helper doing exactly that unwrapping, and the bug was the four
call sites that used it next to the ones that didn't. A body that isn't JSON, or JSON without a
string `error`, keeps the old `<path> → <status> <body>` form: a proxy's html or a bare 502 has
nothing better to offer, and that prefix is what makes it diagnosable.

---
