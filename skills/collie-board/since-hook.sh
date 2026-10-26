#!/usr/bin/env bash
# Shim for UserPromptSubmit hooks installed before #170, which still call this path.
exec bun "$(dirname "$0")/since-hook.ts" "$@"
