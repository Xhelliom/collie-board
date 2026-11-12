// What the repo settings offer as a default model per harness. READ, never run: Claude's aliases and
// efforts; OpenCode's own files — its models.dev catalogue cache, the providers its config declares
// and the providers it holds credentials for. Read when the settings open, never polled. A missing or
// broken file is an empty list (the field stays free), never an error.
//
// auth.json holds API keys: only its top-level NAMES are kept; nothing else of it is read further,
// logged or returned.

import { readFileSync } from "node:fs";
import { posix } from "node:path";

import { EFFORTS } from "./templates.ts";

export interface ModelChoice {
  id: string;
  name?: string;
  /** The variants the model takes (OpenCode `#variant`, Claude `--effort`); empty = none offered. */
  efforts: string[];
}
export interface ProviderChoice {
  id: string;
  name?: string;
  models: ModelChoice[];
}

/** Claude Code's aliases resolve themselves, so the list does not age with each release. */
export const CLAUDE_CHOICES: ProviderChoice[] = [
  { id: "anthropic", name: "Anthropic", models: ["sonnet", "opus", "haiku", "fable"].map((id) => ({ id, efforts: EFFORTS })) },
];

/** JSONC → JSON: comments and trailing commas out, strings untouched. Pure. */
export function stripJsonc(text: string): string {
  return text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? "")
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_, str: string | undefined, close: string | undefined) => str ?? close ?? "");
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A models.dev model's effort values (`reasoning_options[{type:"effort", values}]`). Pure. */
const catalogEfforts = (m: Obj): string[] => strs(((m.reasoning_options as unknown[] | undefined) ?? []).map(obj).find((o) => o.type === "effort")?.values);
/** A config model's variants: v2 `capabilities.reasoning.effort`, v1 `variants` keys. Pure. */
const configEfforts = (m: Obj): string[] => {
  const v2 = strs(obj(obj(m.capabilities).reasoning).effort);
  return v2.length ? v2 : Object.keys(obj(m.variants));
};

/**
 * OpenCode's providers: the config's (`providers` in v2, `provider` in v1) and the credentialed
 * ones (`authNames`), each with its config models then its catalogue models. Pure.
 */
export function opencodeChoices(config: unknown, catalog: unknown, authNames: string[]): ProviderChoice[] {
  const conf = obj(config);
  const confProviders = obj(conf.providers ?? conf.provider);
  const cat = obj(catalog);
  const ids = [...new Set([...Object.keys(confProviders), ...authNames])];
  return ids.map((id) => {
    const cp = obj(confProviders[id]);
    const kp = obj(cat[id]);
    const models = new Map<string, ModelChoice>();
    for (const [mid, m] of Object.entries(obj(cp.models))) models.set(mid, { id: mid, name: str(obj(m).name), efforts: configEfforts(obj(m)) });
    for (const [mid, m] of Object.entries(obj(kp.models))) if (!models.has(mid)) models.set(mid, { id: mid, name: str(obj(m).name), efforts: catalogEfforts(obj(m)) });
    return { id, name: str(cp.name) ?? str(kp.name), models: [...models.values()] };
  });
}

function readJson(path: string, jsonc = false): unknown {
  try {
    const text = readFileSync(path, "utf8");
    return JSON.parse(jsonc ? stripJsonc(text) : text);
  } catch {
    return null;
  }
}

/** Read OpenCode's three files where it keeps them ($XDG_* first, as it does). */
export function readOpencodeChoices(env: Record<string, string | undefined> = process.env, home: string = process.env.HOME ?? ""): ProviderChoice[] {
  const xdg = (k: string, fallback: string) => posix.join(env[k] || posix.join(home, fallback), "opencode");
  const confDir = xdg("XDG_CONFIG_HOME", ".config");
  const config = readJson(posix.join(confDir, "opencode.jsonc"), true) ?? readJson(posix.join(confDir, "opencode.json"), true);
  const catalog = readJson(posix.join(xdg("XDG_CACHE_HOME", ".cache"), "models.json"));
  // Names only: the parsed object (keys) is dropped right here.
  const authNames = Object.keys(obj(readJson(posix.join(xdg("XDG_DATA_HOME", ".local/share"), "auth.json"))));
  return opencodeChoices(config, catalog, authNames);
}
