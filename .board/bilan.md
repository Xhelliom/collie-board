# Bilan — lots : l'orchestrateur notifie

## Fait
- `bridge/lot-push.ts` (pure) : `lotHoldsPush` — retient l'alerte d'une carte d'un lot lancé non terminé (et la fin de lot `run:`) si le réglage est actif ET qu'un orchestrateur vit pour le dépôt (`findOrchestrator`), lu au tir : s'il meurt, les alertes suivantes repartent en push. Les `note:` ne sont jamais retenues.
- Crochet `hold` dans `NotificationCoordinator` (une alerte retenue n'entre ni dans le slot ni dans le digest) ; `onFire(alert, pushed)` ; branché dans `index.ts`, rien dans `server.ts`.
- `NotifyPrefs.lots` (défaut true) + ligne dans Réglages (i18n fr/en).
- `pushed: boolean` sur chaque entrée du log (requis) ; faits bell-only (`tell()`, arrêt d'autonomie) = false.
- Brief de l'orchestrateur : UNE notif de bilan en fin de lot, UNE question par carte bloquée.
- ADR 0039 (+ note dans 0013), fragment `changes/` minor.
- Tests : `lot-push.test.ts`, `notify-log.test.ts` (hold), prefs, prompt. Bridge 1407 pass, web 1750 pass, build/typecheck OK.

## Non fait / à savoir
- Snooze non compté dans `pushed` (le sink coupe après la décision) — documenté ADR 0039.
- Les « Copilot review » sont déjà bell-only dans le code (`tell()`), donc `pushed=false` toujours, lot ou non ; le constat de 14/10 les voyait dans la cloche.
- Une note d'un worker (POST /api/board/notify) n'est pas retenue pendant un lot (indistinguable de celle de l'orchestrateur côté coordinateur sans critère de plus) — à trancher si gênant.
- `UPSTREAM.md` (liste des fichiers upstream touchés) non mis à jour : notifications.ts, notify-log.ts, index.ts touchés.
