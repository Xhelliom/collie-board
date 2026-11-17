#!/usr/bin/env bash
# The repo's gate (`bun run check`). Typechecks always; runs the suites unless the pre-push already ran
# them green on this very commit (scripts/tests-passed.sh) — CI stays the net. Its last line says which.
set -euo pipefail
cd "$(dirname "$0")/.."
bun run typecheck
(cd web && bun run typecheck)
sha="$(git rev-parse --short HEAD)"
if bash scripts/tests-passed.sh; then
  echo "check: typecheck green; tests skipped — the pre-push ran them green on $sha"
  exit 0
fi
bun run test
(cd web && bun run test)
echo "check: typecheck and tests green — run here, the pre-push had not validated $sha"
