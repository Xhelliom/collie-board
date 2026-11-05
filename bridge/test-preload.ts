// Loaded before every `bun test` (bunfig.toml): `trustFolder` writes $CLAUDE_CONFIG_DIR/.claude.json.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "collie-claude-"));
