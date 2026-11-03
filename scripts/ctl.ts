// Control entry point for Collie Board — the one command every Herdr action runs, on every platform:
//
//     bun scripts/ctl.ts <command> [args]
//
// Herdr refuses two actions with the same id even when their `platforms` don't overlap, and has no
// per-platform `command` — so `invoke start` can only mean the same argv everywhere. That argv is
// this file. On Linux and macOS it hands the command, untouched, to `collie-board-ctl.sh`, which
// still owns those platforms; on Windows it runs the command itself. ADR 0050 has the reasoning,
// ADR 0046 §7 the plan: this file catches up with the shell script, which then goes away.
//
// What runs natively on Windows today (lot 1): build, start, stop, restart, uninstall, status, url,
// version, logs, push-test. `setup` and the `tailscale serve` front door come in the next lot; until
// then the bridge is published by hand (README → Windows).
//
// Supervision on Windows is a scheduled task — "at log on, only when the user is logged on", not
// elevated — never a service: a service runs in session 0, with no desktop, and the point of a
// Windows node is an agent driving desktop apps (ADR 0046 §7). The task runs `ctl.ts _run`, a
// small supervisor that restarts the bridge when it dies, which is what systemd's Restart=always
// does on Linux.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PLUGIN_ID = "herdr.collie-board";
export const TASK_NAME = "CollieBoard";
const ROOT = resolve(dirname(import.meta.path), "..");

// ── pure helpers (unit-tested on every platform) ─────────────────────────────────────────────────

/**
 * The plugin `.env`, read the way `set -a; . .env` reads the simple lines it holds: `KEY=value`,
 * an optional `export `, one pair of matching quotes stripped, `#` comments and blank lines skipped,
 * and an unquoted value cut at ` #`. No `$VAR` expansion — Windows has no shell to do it for us, and
 * a value that needs one is a value to write out in full.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2] ?? "";
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

export interface ConfigDirDeps {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  /** `herdr plugin config-dir <id>`, or undefined when herdr isn't there or says nothing. */
  herdrConfigDir: () => string | undefined;
  exists: (path: string) => boolean;
}

/**
 * Where the plugin `.env` lives — resolved the SAME way however we're launched, in the same order as
 * `collie-board-ctl.sh`: the dir Herdr injects → Herdr's CLI → Herdr's conventional dir if it holds a
 * `.env` → `~/.config/collie-board`. Two entry points reading two different files is the bug this
 * order exists to prevent.
 */
export function resolveConfigDir(d: ConfigDirDeps): string {
  if (d.env.HERDR_PLUGIN_CONFIG_DIR) return d.env.HERDR_PLUGIN_CONFIG_DIR;
  const fromHerdr = d.herdrConfigDir()?.trim();
  if (fromHerdr) return fromHerdr;
  const conventional =
    d.platform === "win32"
      ? join(d.env.APPDATA ?? join(d.home, "AppData", "Roaming"), "herdr", "plugins", "config", PLUGIN_ID)
      : join(d.home, ".config", "herdr", "plugins", "config", PLUGIN_ID);
  if (d.exists(join(conventional, ".env"))) return conventional;
  return join(d.home, ".config", "collie-board");
}

/** `Self.DNSName` from `tailscale status --json`, without its trailing dot; "" when unreadable. */
export function dnsNameFromStatus(statusJson: string): string {
  try {
    const name = JSON.parse(statusJson)?.Self?.DNSName;
    return typeof name === "string" ? name.replace(/\.$/, "") : "";
  } catch {
    return "";
  }
}

/** The URL a phone opens — same three shapes as `bridge_url` in `collie-board-ctl.sh`. */
export function bridgeUrl(dnsName: string, mode: string, port: number): string {
  if (!dnsName) return `http://127.0.0.1:${port} (Tailscale name unavailable)`;
  return mode === "http" ? `http://${dnsName}:${port}` : `https://${dnsName}`;
}

const tomlVersion = (text: string) => /^\s*version\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? "";
const jsonVersion = (text: string) => /"version"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? "";
const readOr = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/**
 * What Collie is actually serving: the built bundle's stamp (`web/dist/build-info.json`, the id the
 * PWA footer reports), e.g. `0.16.0+3441656`; else the manifest's version, tagged as not built.
 */
export function collieVersion(root: string): string {
  const info = readOr(join(root, "web", "dist", "build-info.json"));
  const v = jsonVersion(info);
  if (v) {
    const sha = /"sha"\s*:\s*"([^"]*)"/.exec(info)?.[1];
    return sha ? `${v}+${sha}` : v;
  }
  const manifest = tomlVersion(readOr(join(root, "herdr-plugin.toml")));
  return manifest ? `${manifest} (manifest; web not built)` : "unknown";
}

/**
 * `scripts/check-version.sh`, for a platform without bash: the three version files and the newest
 * CHANGELOG heading must agree. Returns the lines to print; `ok` decides the build.
 */
export function checkVersions(root: string): { ok: boolean; lines: string[] } {
  const toml = tomlVersion(readOr(join(root, "herdr-plugin.toml")));
  if (!toml) return { ok: false, lines: ["✗ could not read version from herdr-plugin.toml"] };
  const pkg = jsonVersion(readOr(join(root, "package.json")));
  const web = jsonVersion(readOr(join(root, "web", "package.json")));
  const log = /^##\s*\[([0-9][^\]]*)\]/m.exec(readOr(join(root, "CHANGELOG.md")))?.[1] ?? "";
  if (pkg === toml && web === toml && log === toml) {
    return { ok: true, lines: [`✓ version ${toml} consistent across manifest, package.json, web/package.json, CHANGELOG`] };
  }
  const note = (k: string, v: string) => `  ${k.padEnd(18)} ${v}`;
  return {
    ok: false,
    lines: [
      "✗ version mismatch — all four must equal the canonical herdr-plugin.toml version:",
      note("herdr-plugin.toml", `${toml}  (canonical)`),
      note("package.json", pkg || "<missing>"),
      note("web/package.json", web || "<missing>"),
      note("CHANGELOG.md", log || "<missing>"),
      "  → bump all three files to the same version and add a matching CHANGELOG entry.",
    ],
  };
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** One argument for a Windows command line (CommandLineToArgvW rules, for the paths we pass). */
const winQuote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : s);

export interface TaskSpec {
  /** `DOMAIN\user` — the task runs as this user, in their own session, and only at their logon. */
  userId: string;
  bun: string;
  root: string;
  /** The Herdr socket `start` was invoked against, recorded like the systemd unit records it. */
  socket?: string;
}

/**
 * The scheduled task's definition. Every line here is a decision:
 * - `LogonTrigger` for this user only, `InteractiveToken`: the task runs in the user's session
 *   (desktop, COM, the same integrity as the apps an agent drives), and only while they're logged on
 *   — never "whether the user is logged on or not", which is session 0.
 * - `LeastPrivilege`: never elevated — an elevated client can't attach to the user's non-elevated
 *   apps over COM.
 * - `ExecutionTimeLimit PT0S`: the default (72 h) would kill a bridge that's simply been up for 3 days.
 * - `IgnoreNew`: a second run while one is up is a no-op, like `systemctl start` on an active unit.
 * - `conhost --headless`: a console app run from a task opens a window (a Terminal tab on Windows
 *   11); headless conhost gives it a console nobody sees.
 * - The task starts from a fresh logon environment — which is also what fixes the PATH trap of a
 *   bridge started from a shell older than the Git install.
 */
export function taskXml(t: TaskSpec): string {
  const args = ["--headless", t.bun, join(t.root, "scripts", "ctl.ts"), "_run", ...(t.socket ? [`--socket=${t.socket}`] : [])];
  const user = xmlEscape(t.userId);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Collie Board web bridge (${PLUGIN_ID}). Managed by scripts/ctl.ts: herdr plugin action invoke start|stop|uninstall --plugin ${PLUGIN_ID}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>${xmlEscape(args.map(winQuote).join(" "))}</Arguments>
      <WorkingDirectory>${xmlEscape(t.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export interface Banner {
  ready: boolean;
  version: string;
  service: string;
  port: number;
  env: Record<string, string | undefined>;
  tailnetUrl: string;
}

/** The "is Collie up?" summary `start` and `status` share — same lines as `print_status_banner`. */
export function statusBanner(b: Banner): string[] {
  const lines = [""];
  lines.push(
    b.ready
      ? `  ✓ Collie is running  ·  v${b.version}`
      : `  ⚠ Collie isn't answering on :${b.port} yet (v${b.version}) — check 'bun scripts/ctl.ts logs'`,
  );
  lines.push(`    service   ${b.service}`);
  lines.push(`    local     http://127.0.0.1:${b.port}`);
  if (b.env.COLLIE_BOARD_SKIP_SERVE === "1") {
    lines.push(
      b.env.COLLIE_BOARD_PUBLIC_URL
        ? `    proxy     ${b.env.COLLIE_BOARD_PUBLIC_URL}`
        : "    proxy     (COLLIE_BOARD_SKIP_SERVE=1 — set COLLIE_BOARD_PUBLIC_URL to your reverse-proxy URL)",
    );
  } else {
    lines.push(`    tailnet   ${b.tailnetUrl}`);
  }
  lines.push("");
  return lines;
}

/** The image name on the first row of `tasklist /FO CSV /NH` — undefined when no process matched (an INFO line, no row). */
export function tasklistImage(csv: string): string | undefined {
  const first = csv.split(/\r?\n/).find((l) => l.startsWith('"'));
  return first ? /^"([^"]*)"/.exec(first)?.[1] : undefined;
}

// ── processes ────────────────────────────────────────────────────────────────────────────────────

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run argv (never a shell), capture its output. A missing binary is code 127, not a throw. */
export function run(argv: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): RunResult {
  try {
    const p = Bun.spawnSync(argv, { cwd: opts.cwd, env: opts.env as Record<string, string> | undefined, stdout: "pipe", stderr: "pipe" });
    return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e) };
  }
}

/** Run argv with the terminal attached; the exit code. */
async function runLoud(argv: string[], cwd: string, env?: Record<string, string | undefined>): Promise<number> {
  const p = Bun.spawn(argv, { cwd, env: env as Record<string, string> | undefined, stdio: ["inherit", "inherit", "inherit"] });
  return await p.exited;
}

/** True once something accepts a TCP connection on the loopback port — polled up to `timeoutMs`. */
export async function waitForPort(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((done) => {
      const s = connect({ host: "127.0.0.1", port });
      s.once("connect", () => (s.destroy(), done(true)));
      s.once("error", () => (s.destroy(), done(false)));
    });
    if (ok || Date.now() >= deadline) return ok;
    await Bun.sleep(200);
  }
}

// ── context ──────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  root: string;
  configDir: string;
  env: Record<string, string | undefined>;
  port: number;
  serveMode: string;
  bun: string;
  pidFile: string;
  logFile: string;
}

function loadCtx(): Ctx {
  const configDir = resolveConfigDir({
    env: process.env,
    home: homedir(),
    platform: process.platform,
    herdrConfigDir: () => {
      const r = run(["herdr", "plugin", "config-dir", PLUGIN_ID]);
      return r.code === 0 ? r.stdout : undefined;
    },
    exists: existsSync,
  });
  const legacy = join(homedir(), ".config", "collie-board");
  if (resolve(configDir) !== resolve(legacy) && existsSync(join(legacy, ".env"))) {
    console.error(`note: ignoring legacy ${legacy}/.env — config now lives in ${join(configDir, ".env")} (move it there).`);
  }
  // The .env wins over the inherited environment, as `set -a; . .env` and systemd's EnvironmentFile do.
  const env: Record<string, string | undefined> = { ...process.env, ...parseEnv(readOr(join(configDir, ".env"))) };
  const port = Number(env.COLLIE_BOARD_PORT || 8788);
  return {
    root: ROOT,
    configDir,
    env,
    port,
    serveMode: env.COLLIE_BOARD_SERVE_MODE || "https",
    bun: process.execPath,
    pidFile: join(configDir, "collie.pid"),
    logFile: join(configDir, "collie.log"),
  };
}

function tailnetUrl(c: Ctx): string {
  const r = run(["tailscale", "status", "--json"]);
  return bridgeUrl(r.code === 0 ? dnsNameFromStatus(r.stdout) : "", c.serveMode, c.port);
}

// ── Windows: the scheduled task and its supervisor ───────────────────────────────────────────────

const schtasks = (...args: string[]) => run(["schtasks", ...args]);
const taskExists = () => schtasks("/Query", "/TN", TASK_NAME).code === 0;

/** The supervisor's pid, if the pidfile names a live bun — a stale pid now owned by anything else is not ours. */
function supervisorPid(c: Ctx): number | undefined {
  const pid = Number(readOr(c.pidFile).trim());
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const image = tasklistImage(run(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]).stdout);
  return image && /^bun(\.exe)?$/i.test(image) ? pid : undefined;
}

function serviceLine(c: Ctx): string {
  const pid = supervisorPid(c);
  if (pid) return `scheduled task (${TASK_NAME}) · running (pid ${pid})`;
  if (taskExists()) return `scheduled task (${TASK_NAME}) · registered, not running`;
  return "not supervised";
}

async function printBanner(c: Ctx, waitMs = 5000) {
  const ready = await waitForPort(c.port, waitMs);
  const lines = statusBanner({
    ready,
    version: collieVersion(c.root),
    service: serviceLine(c),
    port: c.port,
    env: c.env,
    tailnetUrl: tailnetUrl(c),
  });
  console.log(lines.join("\n"));
}

function currentUserId(): string {
  const r = run(["whoami"]);
  const who = r.stdout.trim();
  if (r.code === 0 && who) return who;
  return `${process.env.USERDOMAIN ?? "."}\\${process.env.USERNAME ?? ""}`;
}

async function build(c: Ctx): Promise<number> {
  if (c.env.SKIP_VERSION_CHECK !== "1") {
    const v = checkVersions(c.root);
    (v.ok ? console.log : console.error)(v.lines.join("\n"));
    if (!v.ok) return 1;
  }
  const bun = c.bun;
  const web = join(c.root, "web");
  // Both trees before the typecheck — the root one resolves @types/bun from the ROOT node_modules,
  // which a fresh Herdr checkout doesn't have (issue #9).
  for (const [argv, cwd] of [
    [[bun, "install"], c.root],
    [[bun, "install"], web],
  ] as const) {
    if ((await runLoud([...argv], cwd)) !== 0) return 1;
  }
  if (c.env.SKIP_TYPECHECK !== "1") {
    if ((await runLoud([bun, "run", "typecheck"], c.root)) !== 0) return 1;
    if ((await runLoud([bun, "run", "typecheck"], web)) !== 0) return 1;
  }
  // Staged build + swap, so a failed build never empties the web/dist the bridge serves from disk.
  const staging = join(web, "dist-staging");
  rmSync(staging, { recursive: true, force: true });
  if ((await runLoud([bun, "run", "build", "--", "--outDir", "dist-staging", "--emptyOutDir"], web)) !== 0) return 1;
  rmSync(join(web, "dist"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  renameSync(staging, join(web, "dist"));
  return 0;
}

async function ensureBuild(c: Ctx) {
  if (existsSync(join(c.root, "web", "dist", "index.html"))) return;
  console.log("building web UI (first run)…");
  if ((await build(c)) !== 0) console.error("warn: web build failed; API will run but the UI will 503 until built");
}

async function startWindows(c: Ctx): Promise<number> {
  await ensureBuild(c);
  mkdirSync(c.configDir, { recursive: true });
  // Re-registered on every start, like the unit file is rewritten: it records the bun and the
  // checkout of THIS start, so a moved install or a new bun is picked up.
  const xmlPath = join(c.configDir, "collie-board-task.xml");
  writeFileSync(xmlPath, Buffer.from("﻿" + taskXml({ userId: currentUserId(), bun: c.bun, root: c.root, socket: c.env.HERDR_SOCKET_PATH }), "utf16le"));
  const created = schtasks("/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F");
  if (created.code !== 0) {
    console.error(`error: could not register the scheduled task ${TASK_NAME}:\n${(created.stderr || created.stdout).trim()}`);
    return 1;
  }
  if (supervisorPid(c)) {
    console.log(`bridge already running (scheduled task: ${TASK_NAME})`);
  } else {
    const ran = schtasks("/Run", "/TN", TASK_NAME);
    if (ran.code !== 0) {
      console.error(`error: could not run the scheduled task ${TASK_NAME}:\n${(ran.stderr || ran.stdout).trim()}`);
      return 1;
    }
    console.log(`bridge started (scheduled task: ${TASK_NAME}, at logon, not elevated)`);
  }
  if (c.env.COLLIE_BOARD_SKIP_SERVE !== "1") {
    console.error(
      `note: on Windows, Collie doesn't publish tailscale serve yet — the bridge is on 127.0.0.1:${c.port} only.\n` +
        `      Publish it yourself (README → Windows), or set COLLIE_BOARD_SKIP_SERVE=1 behind your own front door.`,
    );
  }
  // First start can be a cold one (bun boot + SQLite open); give it longer than a restart needs.
  await printBanner(c, 10_000);
  return 0;
}

function stopWindows(c: Ctx): number {
  // The tree first, while the supervisor is alive: `/T` walks from a live parent, so ending the task
  // first could kill the supervisor alone and leave the bridge orphaned on the port.
  const pid = supervisorPid(c);
  if (pid) run(["taskkill", "/PID", String(pid), "/T", "/F"]);
  if (taskExists()) {
    schtasks("/End", "/TN", TASK_NAME);
    // `stop` disables, like `systemctl --user disable --now`: a stopped bridge stays stopped at the next logon.
    schtasks("/Change", "/TN", TASK_NAME, "/DISABLE");
  }
  rmSync(c.pidFile, { force: true });
  console.log("bridge stopped");
  return 0;
}

function uninstallWindows(c: Ctx): number {
  stopWindows(c);
  if (taskExists()) schtasks("/Delete", "/TN", TASK_NAME, "/F");
  rmSync(join(c.configDir, "collie-board-task.xml"), { force: true });
  console.log(`✓ uninstalled: bridge stopped, scheduled task ${TASK_NAME} removed`);
  console.log(`  kept: ${join(c.configDir, ".env")} and the checkout — delete those to remove every trace`);
  console.log("  tailscale serve is not managed on Windows yet: remove a mapping you published by hand yourself");
  return 0;
}

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * The supervisor the task runs: start the bridge, and start it again 5 s after it dies — systemd's
 * Restart=always + RestartSec=5. Its pid is the pidfile; `stop` kills it with its whole tree.
 */
async function superviseWindows(c: Ctx, args: string[]): Promise<number> {
  mkdirSync(c.configDir, { recursive: true });
  writeFileSync(c.pidFile, String(process.pid));
  const socket = args.find((a) => a.startsWith("--socket="))?.slice("--socket=".length);
  const env = {
    ...c.env,
    COLLIE_BOARD_PORT: String(c.port),
    HERDR_PLUGIN_CONFIG_DIR: c.configDir,
    ...(socket ? { HERDR_SOCKET_PATH: socket } : {}),
  };
  for (;;) {
    try {
      if (existsSync(c.logFile) && statSync(c.logFile).size > LOG_ROTATE_BYTES) {
        renameSync(c.logFile, `${c.logFile}.1`);
      }
    } catch {
      /* a locked or vanished log is not a reason to stop supervising */
    }
    const fd = openSync(c.logFile, "a");
    const started = Date.now();
    const code = await new Promise<number | null>((done) => {
      const child = spawn(c.bun, ["run", join(c.root, "bridge", "index.ts")], {
        cwd: c.root,
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
      });
      child.once("exit", (code) => done(code));
      child.once("error", () => done(null));
    });
    closeSync(fd);
    writeFileSync(c.logFile, `[ctl] bridge exited (code ${code}) after ${Math.round((Date.now() - started) / 1000)}s; restarting in 5s\n`, { flag: "a" });
    await Bun.sleep(5000);
  }
}

function tailLog(c: Ctx, n: number): number {
  const text = readOr(c.logFile);
  if (!text) {
    console.log("(no log)");
    return 0;
  }
  console.log(text.split(/\r?\n/).slice(-n - 1).join("\n"));
  return 0;
}

// ── dispatch ─────────────────────────────────────────────────────────────────────────────────────

const USAGE = "usage: bun scripts/ctl.ts {setup|start|stop|restart|uninstall|update|version|push-test|build|serve|unserve|status|url|logs}";

/** Commands that exist in collie-board-ctl.sh but not yet natively on Windows — and what to do meanwhile. */
const NOT_YET_ON_WINDOWS: Record<string, string> = {
  setup: "write the plugin .env by hand (COLLIE_BOARD_TRUSTED_USER, COLLIE_BOARD_PUBLIC_HOSTS — README → Configure)",
  serve: "publish it yourself: tailscale serve --bg <port>  (README → Windows)",
  unserve: "remove the mapping you published: tailscale serve --https=443 off",
  update: "herdr plugin update, then: herdr plugin action invoke restart --plugin herdr.collie-board",
};

export interface MainDeps {
  platform: NodeJS.Platform;
  /** Hand the command to the bash script, terminal attached; its exit code. */
  delegate: (args: string[]) => Promise<number>;
  windows: (cmd: string, rest: string[]) => Promise<number>;
  err: (line: string) => void;
}

/** The whole routing decision, injectable so it's tested on every platform. */
export async function main(argv: string[], d: MainDeps): Promise<number> {
  const [cmd = "", ...rest] = argv;
  if (d.platform !== "win32") return d.delegate(argv);
  if (cmd in NOT_YET_ON_WINDOWS) {
    d.err(`collie-board: '${cmd}' is not available on Windows yet — ${NOT_YET_ON_WINDOWS[cmd]}`);
    return 2;
  }
  return d.windows(cmd, rest);
}

async function windows(cmd: string, rest: string[]): Promise<number> {
  const c = loadCtx();
  switch (cmd) {
    case "build":
      return build(c);
    case "start":
      return startWindows(c);
    case "stop":
      return stopWindows(c);
    case "restart":
      stopWindows(c);
      return startWindows(c);
    case "uninstall":
      return uninstallWindows(c);
    case "_run":
      return superviseWindows(c, rest);
    case "status":
      await printBanner(c);
      if (c.env.COLLIE_BOARD_SKIP_SERVE === "1") {
        console.log("  serve config: skipped (COLLIE_BOARD_SKIP_SERVE=1)");
      } else {
        const s = run(["tailscale", "serve", "status"]);
        console.log("  serve config:");
        if (s.code === 0) console.log(s.stdout.trimEnd().replace(/^/gm, "    "));
      }
      return 0;
    case "url":
      console.log(tailnetUrl(c));
      return 0;
    case "version":
      console.log(collieVersion(c.root));
      return 0;
    case "logs":
      return tailLog(c, Number(rest[0]) || 50);
    case "push-test":
      return runLoud([c.bun, "run", join(c.root, "scripts", "push-test.ts"), ...rest], c.root, c.env);
    default:
      console.error(USAGE);
      return 2;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), {
    platform: process.platform,
    delegate: (args) => runLoud(["bash", join(ROOT, "scripts", "collie-board-ctl.sh"), ...args], process.cwd()),
    windows,
    err: (line) => console.error(line),
  });
  process.exit(code);
}
