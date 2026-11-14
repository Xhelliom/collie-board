#!/usr/bin/env bash
# Version consistency gate for Collie.
#
# The plugin's version lives in three files that MUST agree, plus a matching CHANGELOG entry:
#   - herdr-plugin.toml   (canonical — this is what Herdr reads)
#   - package.json        (bridge / Bun server)
#   - web/package.json    (PWA frontend)
#   - CHANGELOG.md        (newest "## [x.y.z]" heading)
#
# Exits non-zero with a clear message on any mismatch. Run by `collie-board-ctl.sh build` and the
# pre-commit hook. See CLAUDE.md → "Versioning" for the policy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `sed -n '…{s//\1/p;q;}'` stops itself at the first match: a `| head -1` closes the pipe on a big
# file, sed takes SIGPIPE and pipefail+set -e kill the script with 141 and no message.
toml_v="$(sed -n '/^[[:space:]]*version[[:space:]]*=/{s/^[[:space:]]*version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p;q;}' "$ROOT/herdr-plugin.toml")"
pkg_v="$(sed -n '/"version"[[:space:]]*:/{s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p;q;}' "$ROOT/package.json")"
web_v="$(sed -n '/"version"[[:space:]]*:/{s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p;q;}' "$ROOT/web/package.json")"
log_v="$(sed -n '/^##[[:space:]]*\[[0-9]/{s/^##[[:space:]]*\[\([0-9][^]]*\)\].*/\1/p;q;}' "$ROOT/CHANGELOG.md" 2>/dev/null || true)"

fail=0
note() { printf '  %-18s %s\n' "$1" "$2"; }

if [ -z "$toml_v" ]; then echo "✗ could not read version from herdr-plugin.toml" >&2; exit 1; fi

if [ "$pkg_v" != "$toml_v" ] || [ "$web_v" != "$toml_v" ] || [ "$log_v" != "$toml_v" ]; then
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "✗ version mismatch — all four must equal the canonical herdr-plugin.toml version:" >&2
  note "herdr-plugin.toml" "$toml_v  (canonical)"
  note "package.json" "${pkg_v:-<missing>}"
  note "web/package.json" "${web_v:-<missing>}"
  note "CHANGELOG.md" "${log_v:-<missing>}"
  echo "  → bump all three files to the same version and add a matching CHANGELOG entry." >&2
  exit 1
fi

echo "✓ version $toml_v consistent across manifest, package.json, web/package.json, CHANGELOG"
