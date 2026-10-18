#!/usr/bin/env bash
# Claude Code UserPromptSubmit hook: what moved in the orchestrator's repo since its last turn, read
# from `GET /api/orchestrator/since` and printed as context for the turn. Silent everywhere else — the
# bridge answers 204 to any pane that is not an orchestrator — and when nothing moved. Never blocks:
# every failure exits 0 with nothing printed. The cursor (a ts) lives in a file per pane.
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
B=${COLLIE_BOARD_URL:-http://127.0.0.1:${COLLIE_BOARD_PORT:-8788}}
H=(-H "x-collie-pane: $HERDR_PANE_ID")
[ -n "${COLLIE_BOARD_DEVICE_HEADER:-}" ] && [ -n "${COLLIE_BOARD_DEVICE:-}" ] && H+=(-H "$COLLIE_BOARD_DEVICE_HEADER: $COLLIE_BOARD_DEVICE")
f=${XDG_STATE_HOME:-$HOME/.local/state}/collie-board/since-$HERDR_PANE_ID
r=$(curl -sf -m 3 "${H[@]}" "$B/api/orchestrator/since?since=$(cat "$f" 2>/dev/null)") || exit 0
[ -n "$r" ] || exit 0
cursor=$(jq -r '.cursor // empty' <<<"$r" 2>/dev/null) || exit 0
[ -n "$cursor" ] && mkdir -p "${f%/*}" && echo "$cursor" >"$f"
jq -r '.summary | select(. != null and . != "")' <<<"$r" 2>/dev/null
exit 0
