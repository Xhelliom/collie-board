# 37. 🔵 The web bundle goes out gzipped, precompressed at build

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

`serveStatic` sent every asset raw: the 963 KB main chunk (268 KB gzipped) and the 89 KB stylesheet
(15 KB) — about 5.5 s on a phone at first load and after every release. The build now writes an
`x.gz` beside each text asset of the output dir, and the bridge sends it, with `Content-Encoding: gzip`
and `Vary: Accept-Encoding`, to a client that accepts gzip. Nothing is compressed per request; CSP and
cache headers are untouched. Generic — it knows no card.

| | |
|---|---|
| Commit | *Assets web servis précompressés en gzip (audit perf #9)* |
| Files | `web/vite-gzip.ts` (new), `bridge/precompressed.ts` (+ test, new), `web/vite.config.ts` (one import, one plugin), `web/tsconfig.json` (include), `bridge/server.ts` (`serveStatic` takes `Accept-Encoding`, three lines) |
| Extraction | **Clean cherry-pick**. |

---
