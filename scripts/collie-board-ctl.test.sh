#!/usr/bin/env bash
# Lifecycle tests for scripts/collie-board-ctl.sh — the first coverage the control script has ever had.
# Everything the script shells out to (tailscale, systemctl) is faked on a scratch PATH, with a
# throwaway $HOME and config dir, so these run anywhere and touch nothing real.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CTL="${ROOT}/scripts/collie-board-ctl.sh"
BASE_PATH="$PATH"
TMP_ROOT="$(mktemp -d)"

cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  [ "$1" = "$2" ] || fail "expected '$2', got '$1'"
}

# Permission bits, portably: `stat -c` is GNU, `stat -f` is BSD (macOS). Collie targets both.
file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%A' "$1"
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "expected output to contain '$2'" ;;
  esac
}

setup_case() {
  CASE_DIR="${TMP_ROOT}/$1"
  HOME_DIR="${CASE_DIR}/home"
  CONFIG_DIR="${CASE_DIR}/config"
  BIN_DIR="${CASE_DIR}/bin"
  mkdir -p "$HOME_DIR" "$CONFIG_DIR" "$BIN_DIR"
  cat > "${BIN_DIR}/systemctl" <<'EOF'
#!/bin/sh
exit 1
EOF
  chmod +x "${BIN_DIR}/systemctl"
}

run_ctl() {
  HOME="$HOME_DIR" \
  HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" \
  PATH="${BIN_DIR}:${BASE_PATH}" \
  bash "$CTL" "$@"
}

# A fake `tailscale` whose serve state lives in a JSON file the test can read and rewrite — so a test
# can stage any ownership situation (ours, someone else's, absent) and assert what the script did.
install_fake_tailscale() {
  TS_STATUS="${CASE_DIR}/tailscale-status.json"
  printf '{}\n' > "$TS_STATUS"
  cat > "${BIN_DIR}/tailscale" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = status ] && [ "\${2:-}" = --json ]; then
  echo '{"Self":{"DNSName":"host.example."}}'
  exit 0
fi
if [ "\${1:-}" = serve ] && [ "\${2:-}" = status ] && [ "\${3:-}" = --json ]; then
  cat "$TS_STATUS"
  exit 0
fi
if [ "\${1:-}" = serve ] && [[ " \$* " == *" --bg "* ]]; then
  target="\${!#}"
  listener=443
  protocol=HTTPS
  for arg in "\$@"; do
    case "\$arg" in
      --http=*) listener="\${arg#--http=}"; protocol=HTTP ;;
    esac
  done
  cat > "$TS_STATUS" <<JSON
{"TCP":{"\${listener}":{"\${protocol}":true}},"Web":{"host.example:\${listener}":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:\${target}"}}}}}
JSON
  exit 0
fi
if [ "\${1:-}" = serve ] && [[ " \$* " == *" off "* ]]; then
  printf '{}\n' > "$TS_STATUS"
  exit 0
fi
exit 2
EOF
  chmod +x "${BIN_DIR}/tailscale"
}


# `setup` exists for exactly one reason: to derive the two security settings people skip. So that is
# what it gets tested on — the derivation, and the refusal to touch config someone already owns.
test_setup_writes_the_security_config() {
  setup_case setup-fresh
  cat > "${BIN_DIR}/tailscale" <<'EOF'
#!/bin/sh
if [ "$1" = status ] && [ "$2" = --json ]; then
  echo '{"Self":{"DNSName":"host.example.ts.net.","UserID":1},"User":{"1":{"LoginName":"me@example.com"}},"CertDomains":["host.example.ts.net"]}'
  exit 0
fi
exit 2
EOF
  cat > "${BIN_DIR}/herdr" <<'EOF'
#!/bin/sh
[ "$1" = plugin ] && [ "$2" = list ] && { echo "No plugins installed."; exit 0; }
[ "$1" = plugin ] && [ "$2" = link ] && exit 0
[ "$1" = plugin ] && [ "$2" = config-dir ] && { echo "$HERDR_PLUGIN_CONFIG_DIR"; exit 0; }
exit 0
EOF
  chmod +x "${BIN_DIR}/tailscale" "${BIN_DIR}/herdr"
  mkdir -p "${HOME_DIR}/.config/herdr" && : > "${HOME_DIR}/.config/herdr/herdr.sock"
  # A socket, not a regular file — the preflight checks for one.
  rm -f "${HOME_DIR}/.config/herdr/herdr.sock"
  python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" \
    "${HOME_DIR}/.config/herdr/herdr.sock"

  out="$(run_ctl setup 2>&1)" || fail "setup exited non-zero: $out"
  env_file="${CONFIG_DIR}/.env"
  [ -f "$env_file" ] || fail "setup wrote no .env"
  assert_contains "$(cat "$env_file")" "COLLIE_BOARD_TRUSTED_USER=me@example.com"
  assert_contains "$(cat "$env_file")" "COLLIE_BOARD_PUBLIC_HOSTS=host.example.ts.net"
  # HTTPS IS available here, so it must not force the http fallback.
  case "$(cat "$env_file")" in
    *$'\n'COLLIE_BOARD_SERVE_MODE=http*) fail "forced http mode despite a valid cert domain" ;;
  esac
  # Owner-only: it names the trusted tailnet identity.
  assert_eq "$(file_mode "$env_file")" "600"
  # And it must not start or publish anything.
  assert_contains "$out" "Nothing is running or published yet"

  echo "  setup: derives the security config from tailscale"
}

test_setup_falls_back_to_http_without_a_cert() {
  setup_case setup-nocert
  cat > "${BIN_DIR}/tailscale" <<'EOF'
#!/bin/sh
if [ "$1" = status ] && [ "$2" = --json ]; then
  echo '{"Self":{"DNSName":"host.example.ts.net.","UserID":1},"User":{"1":{"LoginName":"me@example.com"}},"CertDomains":[]}'
  exit 0
fi
exit 2
EOF
  cat > "${BIN_DIR}/herdr" <<'EOF'
#!/bin/sh
[ "$1" = plugin ] && [ "$2" = list ] && { echo "No plugins installed."; exit 0; }
exit 0
EOF
  chmod +x "${BIN_DIR}/tailscale" "${BIN_DIR}/herdr"
  mkdir -p "${HOME_DIR}/.config/herdr"
  python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" \
    "${HOME_DIR}/.config/herdr/herdr.sock"

  run_ctl setup >/dev/null 2>&1 || fail "setup exited non-zero"
  assert_contains "$(cat "${CONFIG_DIR}/.env")" "COLLIE_BOARD_SERVE_MODE=http"

  echo "  setup: falls back to http when the tailnet has no cert"
}

test_setup_never_rewrites_existing_config() {
  setup_case setup-existing
  cat > "${BIN_DIR}/tailscale" <<'EOF'
#!/bin/sh
if [ "$1" = status ] && [ "$2" = --json ]; then
  echo '{"Self":{"DNSName":"host.example.ts.net.","UserID":1},"User":{"1":{"LoginName":"me@example.com"}},"CertDomains":["host.example.ts.net"]}'
  exit 0
fi
exit 2
EOF
  cat > "${BIN_DIR}/herdr" <<'EOF'
#!/bin/sh
[ "$1" = plugin ] && [ "$2" = list ] && { echo "No plugins installed."; exit 0; }
exit 0
EOF
  chmod +x "${BIN_DIR}/tailscale" "${BIN_DIR}/herdr"
  mkdir -p "${HOME_DIR}/.config/herdr"
  python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" \
    "${HOME_DIR}/.config/herdr/herdr.sock"

  printf 'COLLIE_BOARD_PORT=9999\n' > "${CONFIG_DIR}/.env"
  out="$(run_ctl setup 2>&1)" || fail "setup exited non-zero: $out"
  assert_eq "$(cat "${CONFIG_DIR}/.env")" "COLLIE_BOARD_PORT=9999"
  # It must SAY what is missing rather than silently editing.
  assert_contains "$out" "COLLIE_BOARD_TRUSTED_USER=me@example.com"
  assert_contains "$out" "COLLIE_BOARD_PUBLIC_HOSTS=host.example.ts.net"

  echo "  setup: reports missing settings instead of overwriting a user's .env"
}


# Herdr runs plugin actions in a non-interactive shell, so bun's installer entry in ~/.zshrc does
# not apply. Resolving bun from PATH alone made `start` fail with "bun not found" on a completely
# standard install — this is that regression.
test_bun_resolves_outside_path() {
  setup_case bun-offpath
  mkdir -p "${HOME_DIR}/.bun/bin"
  printf '#!/bin/sh\nexit 0\n' > "${HOME_DIR}/.bun/bin/bun"
  chmod +x "${HOME_DIR}/.bun/bin/bun"
  cat > "${BIN_DIR}/tailscale" <<'EOF'
#!/bin/sh
exit 2
EOF
  cat > "${BIN_DIR}/herdr" <<'EOF'
#!/bin/sh
[ "$1" = plugin ] && [ "$2" = list ] && { echo "No plugins installed."; exit 0; }
exit 0
EOF
  chmod +x "${BIN_DIR}/tailscale" "${BIN_DIR}/herdr"
  mkdir -p "${HOME_DIR}/.config/herdr"
  python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" \
    "${HOME_DIR}/.config/herdr/herdr.sock"

  # A PATH with NO bun on it, exactly like a herdr plugin action gets. BUN_INSTALL is cleared
  # explicitly: it is set in most dev shells, it points at the REAL ~/.bun, and it is earlier in
  # resolve_bun's chain than ~/.bun/bin — so leaving it set makes this case pass against the
  # developer's own bun and prove nothing.
  out="$(HOME="$HOME_DIR" HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" PATH="${BIN_DIR}:/usr/bin:/bin" \
    BUN_INSTALL= \
    HERDR_SOCKET_PATH="${HOME_DIR}/.config/herdr/herdr.sock" \
    bash "$CTL" setup 2>&1)" || fail "setup failed with bun off PATH: $out"
  assert_contains "$out" "✓ bun          ${HOME_DIR}/.bun/bin/bun"

  echo "  bun: resolved from ~/.bun/bin when it is not on PATH"
}

# Publishing must move cleanly between ports and modes, and must never clobber a root mount Collie
# didn't create.
test_tailscale_cutovers_and_collisions() {
  setup_case tailscale
  install_fake_tailscale

  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=8787
EOF
  run_ctl serve > "${CASE_DIR}/start-8787.out"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" \
    'http:8787|host.example:8787|http://127.0.0.1:8787'

  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=9999
EOF
  run_ctl serve > "${CASE_DIR}/start-9999.out"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" \
    'http:9999|host.example:9999|http://127.0.0.1:9999'

  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SKIP_SERVE=1
COLLIE_BOARD_PORT=9999
EOF
  run_ctl serve > "${CASE_DIR}/to-proxy.out"
  [ ! -e "${CONFIG_DIR}/tailscale-managed-handler" ] || fail "Tailscale ownership survived proxy cutover"
  assert_eq "$(cat "$TS_STATUS")" '{}'

  collision='{"TCP":{"8787":{"HTTP":true}},"Web":{"host.example:8787":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7000"}}}}}'
  printf '%s\n' "$collision" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=8787
EOF
  if run_ctl serve > "${CASE_DIR}/collision.out" 2>&1; then
    fail "unowned Tailscale root collision was overwritten"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$collision"
  [ ! -e "${CONFIG_DIR}/tailscale-managed-handler" ] || fail "collision created ownership state"

  opposite_https='{"TCP":{"8787":{"HTTPS":true}},"Web":{"host.example:8787":{"Handlers":{"/other":{"Proxy":"http://127.0.0.1:7002"}}}}}'
  printf '%s\n' "$opposite_https" > "$TS_STATUS"
  if run_ctl serve > "${CASE_DIR}/opposite-https.out" 2>&1; then
    fail "HTTP publication replaced an unrelated HTTPS sibling listener"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$opposite_https"

  opposite_http='{"TCP":{"443":{"HTTP":true}},"Web":{"host.example:443":{"Handlers":{"/other":{"Proxy":"http://127.0.0.1:7003"}}}}}'
  printf '%s\n' "$opposite_http" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=https
COLLIE_BOARD_PORT=8787
EOF
  if run_ctl serve > "${CASE_DIR}/opposite-http.out" 2>&1; then
    fail "HTTPS publication replaced an unrelated HTTP sibling listener"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$opposite_http"
  [ ! -e "${CONFIG_DIR}/tailscale-managed-handler" ] || fail "protocol mismatch created ownership state"

  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=8787
EOF

  # Once we own a root, someone replacing it out from under us must stop teardown cold: removing a
  # handler we no longer own would unpublish a service that isn't ours.
  printf '{}\n' > "$TS_STATUS"
  run_ctl serve > "${CASE_DIR}/owned.out"
  owned_state="$(cat "${CONFIG_DIR}/tailscale-managed-handler")"
  protocol_replacement='{"TCP":{"8787":{"HTTPS":true}},"Web":{"host.example:8787":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
  printf '%s\n' "$protocol_replacement" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SKIP_SERVE=1
COLLIE_BOARD_PORT=8787
EOF
  if run_ctl serve > "${CASE_DIR}/protocol-replacement.out" 2>&1; then
    fail "protocol-only Tailscale root replacement was removed"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$protocol_replacement"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" "$owned_state"
  replacement='{"TCP":{"8787":{"HTTP":true}},"Web":{"host.example:8787":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7001"}}}}}'
  printf '%s\n' "$replacement" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SKIP_SERVE=1
COLLIE_BOARD_PORT=8787
EOF
  if run_ctl serve > "${CASE_DIR}/replacement.out" 2>&1; then
    fail "externally replaced Tailscale root was removed"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$replacement"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" "$owned_state"
}

test_missing_tailscale_cli() {
  setup_case tailscale-missing
  ln -s "$(command -v dirname)" "${BIN_DIR}/dirname"
  ln -s "$(command -v tr)" "${BIN_DIR}/tr"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_PORT=8787
EOF

  set +e
  HOME="$HOME_DIR" \
  HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" \
  PATH="$BIN_DIR" \
  /bin/bash "$CTL" serve > "${CASE_DIR}/missing.out" 2>&1
  rc=$?
  set -e

  [ "$rc" -ne 0 ] || fail "missing Tailscale CLI reported success"
  output="$(cat "${CASE_DIR}/missing.out")"
  assert_contains "$output" 'tailscale not found'
  case "$output" in
    *"open:"*) fail "missing Tailscale CLI printed an open URL" ;;
  esac
}

# If the ownership record can't be deleted, teardown must report failure and KEEP the record —
# dropping it would orphan a live mapping with nothing left that knows Collie owns it.
test_state_delete_failures() {
  setup_case state-delete-failures
  cat > "${BIN_DIR}/tailscale" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "${BIN_DIR}/tailscale"

  local tailscale_state="${CONFIG_DIR}/tailscale-managed-handler"
  printf 'http:8787|host.example:8787|http://127.0.0.1:8787\n' > "$tailscale_state"

  local harness="${CASE_DIR}/harness.sh"
  cat > "$harness" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$HOME_DIR"
export HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR"
export PATH="$BIN_DIR:$BASE_PATH"
source "$CTL"
have_systemd() { return 1; }
TAILSCALE_HANDLER_FILE="$tailscale_state"
rm() { return 1; }

tailscale_root_fingerprint() { echo absent; }
if stop_tailscale_serve; then
  exit 91
fi
[ -f "$tailscale_state" ] || exit 92

tailscale_root_fingerprint() { echo 'http|proxy:http://127.0.0.1:8787'; }
remove_tailscale_handler() { return 0; }
if stop_tailscale_serve; then
  exit 93
fi
[ -f "$tailscale_state" ] || exit 94
EOF

  bash "$harness" > "${CASE_DIR}/delete-failure.out" 2>&1
}

# An install that predates ownership tracking has Collie's OWN root mount and no record of it.
# Publishing must adopt that mount, not refuse it — refusing breaks start/restart/update on every
# deployment that upgrades into this feature.
test_adopts_preexisting_collie_mount() {
  setup_case adopt-preexisting
  install_fake_tailscale

  local preexisting='{"TCP":{"8787":{"HTTP":true}},"Web":{"host.example:8787":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
  printf '%s\n' "$preexisting" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=8787
EOF
  [ ! -e "${CONFIG_DIR}/tailscale-managed-handler" ] || fail "fixture already had ownership state"

  run_ctl serve > "${CASE_DIR}/adopt-http.out" 2>&1 ||
    fail "serve refused to adopt Collie's own pre-existing HTTP mount"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" \
    'http:8787|host.example:8787|http://127.0.0.1:8787'

  # Same for the HTTPS default, whose mount lives on :443 while the proxy target stays $PORT.
  setup_case adopt-preexisting-https
  install_fake_tailscale
  printf '%s\n' '{"TCP":{"443":{"HTTPS":true}},"Web":{"host.example:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}' > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_PORT=8787
EOF
  run_ctl serve > "${CASE_DIR}/adopt-https.out" 2>&1 ||
    fail "serve refused to adopt Collie's own pre-existing HTTPS mount"
  assert_eq "$(cat "${CONFIG_DIR}/tailscale-managed-handler")" \
    'https:443|host.example:443|http://127.0.0.1:8787'

  # Negative control: a root mount proxying somewhere ELSE is still refused, so adoption can't be
  # used to justify clobbering a stranger's mapping.
  setup_case adopt-negative-control
  install_fake_tailscale
  foreign='{"TCP":{"8787":{"HTTP":true}},"Web":{"host.example:8787":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7000"}}}}}'
  printf '%s\n' "$foreign" > "$TS_STATUS"
  cat > "${CONFIG_DIR}/.env" <<'EOF'
COLLIE_BOARD_SERVE_MODE=http
COLLIE_BOARD_PORT=8787
EOF
  if run_ctl serve > "${CASE_DIR}/adopt-foreign.out" 2>&1; then
    fail "adoption swallowed a foreign root mount"
  fi
  assert_eq "$(cat "$TS_STATUS")" "$foreign"
  [ ! -e "${CONFIG_DIR}/tailscale-managed-handler" ] || fail "foreign mount created ownership state"
}

# A failed front door must not abort `start` — the bridge is up on loopback and the banner still has
# to print, which is what the README's troubleshooting flow tells people to read.
test_serve_failure_does_not_abort_start() {
  setup_case serve-failure-start
  local harness="${CASE_DIR}/harness.sh"
  cat > "$harness" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$HOME_DIR"
export HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR"
export PATH="$BIN_DIR:$BASE_PATH"
source "$CTL"
ensure_build() { return 0; }
have_systemd() { return 1; }
BUN=/bin/true
cmd_serve() { echo "error: simulated serve failure" >&2; return 1; }
print_status_banner() { echo "BANNER"; }
cmd_start
EOF
  bash "$harness" > "${CASE_DIR}/start.out" 2>&1 ||
    fail "a failing cmd_serve aborted cmd_start"
  assert_contains "$(cat "${CASE_DIR}/start.out")" 'BANNER'
}

# ── update: the checkout can be in either of the two shapes Collie Board is installed in ─────────
#
# `herdr plugin install` does NOT clone: it runs `git init` + `git fetch --depth 1 origin HEAD` +
# `git checkout --detach FETCH_HEAD`, so the plugin lives in a detached, shallow checkout with no
# remote-tracking refs. `git pull --ff-only` cannot work there ("You are not currently on a branch").
# These stage both shapes for real, against a local origin, and drive the actual git logic.
git_q() { git -c user.name=collie-test -c user.email=test@example.invalid "$@"; }

# A local origin plus the two checkout shapes. Echoes nothing; sets ORIGIN_DIR.
stage_origin() {
  ORIGIN_DIR="${CASE_DIR}/origin"
  mkdir -p "$ORIGIN_DIR"
  git_q -C "$ORIGIN_DIR" init -q -b main
  echo "v1" > "${ORIGIN_DIR}/VERSION"
  echo "lock-v1" > "${ORIGIN_DIR}/bun.lock"
  git_q -C "$ORIGIN_DIR" add -A
  git_q -C "$ORIGIN_DIR" commit -qm "first"
}

# One more upstream commit, so an update has something to move to.
advance_origin() {
  echo "v2" > "${ORIGIN_DIR}/VERSION"
  git_q -C "$ORIGIN_DIR" add -A
  git_q -C "$ORIGIN_DIR" commit -qm "second"
}

# Run update_checkout() against an arbitrary checkout, with the control script's own PLUGIN_ROOT
# repointed at it (sourcing computes PLUGIN_ROOT from BASH_SOURCE, so it must be overridden after).
run_update_checkout() {
  local root="$1" harness="${CASE_DIR}/update-harness.sh"
  cat > "$harness" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$HOME_DIR"
export HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR"
export PATH="$BIN_DIR:$BASE_PATH"
source "$CTL"
PLUGIN_ROOT="$root"
update_checkout
EOF
  bash "$harness" 2>&1
}

# The regression: a Herdr-managed checkout must advance — even with a tracked file dirtied by the
# build (`bun install` can rewrite the committed lockfiles), which a plain checkout would refuse on,
# re-breaking update permanently. It must stay detached and stay shallow.
test_update_advances_a_herdr_managed_checkout() {
  setup_case update-managed
  stage_origin
  local root="${CASE_DIR}/managed"
  mkdir -p "$root"
  # Verbatim what herdr's plugin_install does (src/cli/plugin.rs, git_checkout).
  git_q -C "$root" init -q
  git_q -C "$root" remote add origin "$ORIGIN_DIR"
  git_q -C "$root" fetch -q --depth 1 origin HEAD
  git_q -C "$root" checkout -q --detach FETCH_HEAD
  advance_origin
  echo "rewritten-by-bun-install" > "${root}/bun.lock"

  local out; out="$(run_update_checkout "$root")" || fail "update_checkout failed: $out"
  assert_contains "$out" "Herdr-managed checkout"
  assert_eq "$(git -C "$root" rev-parse HEAD)" "$(git -C "$ORIGIN_DIR" rev-parse HEAD)"
  assert_eq "$(cat "${root}/VERSION")" "v2"
  assert_eq "$(cat "${root}/bun.lock")" "lock-v1"   # --force discarded the build's rewrite
  assert_eq "$(git -C "$root" rev-parse --is-shallow-repository)" "true"
  git -C "$root" symbolic-ref -q HEAD >/dev/null 2>&1 &&
    fail "managed checkout should still be detached"
  # Idempotent: a second update with nothing new upstream is a no-op, not an error.
  run_update_checkout "$root" >/dev/null || fail "second update_checkout failed"
}

# The other shape — a dev clone linked with `herdr plugin link`. It is on a branch, so it must still
# fast-forward, keep its branch, and keep its full history (no --depth truncation).
test_update_fast_forwards_a_linked_clone() {
  setup_case update-linked
  stage_origin
  advance_origin
  local root="${CASE_DIR}/clone"
  git_q clone -q "$ORIGIN_DIR" "$root"
  git_q -C "$ORIGIN_DIR" commit -q --allow-empty -m "third"

  local out; out="$(run_update_checkout "$root")" || fail "update_checkout failed: $out"
  assert_contains "$out" "git pull --ff-only"
  assert_eq "$(git -C "$root" rev-parse HEAD)" "$(git -C "$ORIGIN_DIR" rev-parse HEAD)"
  assert_eq "$(git -C "$root" symbolic-ref --short HEAD)" "main"
  assert_eq "$(git -C "$root" rev-list --count HEAD)" "3"
  assert_eq "$(git -C "$root" rev-parse --is-shallow-repository)" "false"
}

# A checkout that isn't a git repo at all (a copied tree) must fail with the reinstall command, not a
# raw git error about a missing origin.
test_update_reports_a_non_git_checkout() {
  setup_case update-non-git
  local root="${CASE_DIR}/plain"; mkdir -p "$root"
  set +e
  local out; out="$(run_update_checkout "$root")"; local rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "update_checkout on a non-git tree reported success"
  assert_contains "$out" "herdr plugin install Xhelliom/collie-board"
}

# `herdr plugin link` re-registers the plugin as source.kind=local, and Herdr then REFUSES
# `herdr plugin install` — which is the only other way a managed install can be refreshed. So the
# re-link must fire for a linked clone and never for a managed checkout.
test_registry_refresh_skips_a_managed_checkout() {
  setup_case update-relink
  local calls="${CASE_DIR}/herdr.calls"
  cat > "${BIN_DIR}/herdr" <<EOF
#!/bin/sh
echo "\$@" >> "$calls"
exit 0
EOF
  chmod +x "${BIN_DIR}/herdr"
  stage_origin
  local managed="${CASE_DIR}/managed" clone="${CASE_DIR}/clone"
  mkdir -p "$managed"
  git_q -C "$managed" init -q
  git_q -C "$managed" remote add origin "$ORIGIN_DIR"
  git_q -C "$managed" fetch -q --depth 1 origin HEAD
  git_q -C "$managed" checkout -q --detach FETCH_HEAD
  git_q clone -q "$ORIGIN_DIR" "$clone"

  local harness="${CASE_DIR}/relink-harness.sh"
  cat > "$harness" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOME="$HOME_DIR"
export HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR"
export PATH="$BIN_DIR:$BASE_PATH"
source "$CTL"
PLUGIN_ROOT="\$1"
refresh_registry
EOF
  assert_contains "$(bash "$harness" "$managed")" "registry left alone"
  [ ! -s "$calls" ] || fail "re-linked a Herdr-managed checkout (would block \`herdr plugin install\`)"
  bash "$harness" "$clone" > /dev/null
  assert_contains "$(cat "$calls")" "plugin link ${clone}"
}

test_tailscale_cutovers_and_collisions
test_missing_tailscale_cli
test_state_delete_failures
test_adopts_preexisting_collie_mount
test_serve_failure_does_not_abort_start

test_bun_resolves_outside_path
test_setup_writes_the_security_config
test_setup_falls_back_to_http_without_a_cert
test_setup_never_rewrites_existing_config

test_update_advances_a_herdr_managed_checkout
test_update_fast_forwards_a_linked_clone
test_update_reports_a_non_git_checkout
test_registry_refresh_skips_a_managed_checkout

echo "collie-board-ctl lifecycle tests: passed"
