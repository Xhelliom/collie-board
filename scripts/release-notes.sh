#!/usr/bin/env bash
# The GitHub Release notes for one version: its CHANGELOG section, then the update commands — the
# in-app update banner links to that page, so it has to say exactly how to update.
# Usage: scripts/release-notes.sh 0.146.0 > notes.md
set -euo pipefail

version="${1:?usage: release-notes.sh <x.y.z>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# This version's CHANGELOG block: everything between its `## [x.y.z]` heading and the next.
section="$(awk -v ver="$version" '
  $0 ~ ("^## \\[" ver "\\]") { grab = 1; next }
  grab && /^## \[/ { exit }
  grab { print }
' "$ROOT/CHANGELOG.md" || true)"

if [ -n "$section" ]; then
  printf '%s\n\n' "$section"
fi
cat <<'EOF'
## Update

Update the plugin — pulls, rebuilds, restarts, and re-links (runs from any directory):

```
herdr plugin action invoke update --plugin herdr.collie-board
```

Or just restart the bridge to pick up an already-built change:

```
herdr plugin action invoke restart --plugin herdr.collie-board
```
EOF
