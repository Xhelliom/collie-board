#!/usr/bin/env bash
# Install the collie-board skill by linking it into Claude's skills directory.
#
# The skill documents the board's HTTP API for the agents that use it, so it lives WITH that API
# (skills/collie-board/SKILL.md) and is versioned, reviewed and tested with it — bridge/skill.test.ts
# fails when a route is added and the skill is not told. A copy under ~/.claude would drift; a link
# cannot. Safe to run again: it does nothing when the link is already right, and an existing real
# directory is moved aside, never deleted.
#
#   scripts/install-skill.sh            # → ~/.claude/skills/collie-board
#   CLAUDE_SKILLS_DIR=/some/dir scripts/install-skill.sh
#
# A replaced copy is kept in ~/.claude/skills-backup, NOT beside the link: a second directory holding a
# SKILL.md of the same name inside the skills directory would be loaded as a duplicate skill.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/skills/collie-board"
DEST_DIR="${CLAUDE_SKILLS_DIR:-${HOME}/.claude/skills}"
DEST="${DEST_DIR}/collie-board"
BACKUP_DIR="${CLAUDE_SKILLS_BACKUP_DIR:-${DEST_DIR}/../skills-backup}"

[ -f "${SRC}/SKILL.md" ] || { echo "error: ${SRC}/SKILL.md is missing" >&2; exit 1; }
mkdir -p "$DEST_DIR"

if [ -L "$DEST" ] && [ "$(readlink -f "$DEST")" = "$(readlink -f "$SRC")" ]; then
  echo "already linked: ${DEST} -> ${SRC}"
  exit 0
fi

if [ -L "$DEST" ]; then
  rm "$DEST" # a stale link points nowhere useful: replace it
elif [ -e "$DEST" ]; then
  mkdir -p "$BACKUP_DIR"
  backup="${BACKUP_DIR}/collie-board.$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$backup"
  echo "moved the existing copy aside: ${backup}"
fi

ln -s "$SRC" "$DEST"
echo "linked: ${DEST} -> ${SRC}"
