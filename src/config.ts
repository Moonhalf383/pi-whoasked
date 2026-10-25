import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.ts";
export { DEFAULT_CONFIG };

export interface Rule {
  name: string;
  pattern: string;
  flags?: string;
  correctionPrompt: string;
  enabled?: boolean;
}

export interface Config {
  enabled: boolean;
  maxRetries: number;
  rules: Rule[];
}

export interface CompiledRule extends Rule {
  regex: RegExp;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules.filter((rule) => rule.enabled !== false).map((rule) => {
    let regex: RegExp;
    try {
      // Global scanning lets the matcher skip empty alternatives and still find a
      // subsequent nonempty hit. Sticky matching, if explicitly requested, is preserved.
      const flags = rule.flags ?? "u";
      regex = new RegExp(rule.pattern, flags.includes("g") ? flags : `${flags}g`);
    } catch (error) {
      throw new Error(`Invalid regex for rule "${rule.name}": ${String(error)}`);
    }
    if (regex.test("")) throw new Error(`Rule "${rule.name}" must not match empty input`);
    regex.lastIndex = 0;
    return { ...rule, regex };
  });
}

/** Each supplied rules array replaces the previous array, rather than merging by name. */
export function parseConfig(value: unknown, base: Config = DEFAULT_CONFIG): Config {
  const raw = object(value, "Configuration");
  const unknown = Object.keys(raw).filter((key) => !["enabled", "maxRetries", "rules"].includes(key));
  if (unknown.length) throw new Error(`Unknown configuration fields: ${unknown.join(", ")}`);
  const enabled = raw.enabled === undefined ? base.enabled : boolean(raw.enabled, "enabled");
  const maxRetries = raw.maxRetries === undefined ? base.maxRetries : raw.maxRetries;
  if (typeof maxRetries !== "number" || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries must be a nonnegative safe integer");
  }
  let rules = base.rules;
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) throw new Error("rules must be an array");
    const names = new Set<string>();
    rules = raw.rules.map((value, index) => {
      const rule = object(value, `rules[${index}]`);
      const extra = Object.keys(rule).filter((key) => !["name", "pattern", "flags", "correctionPrompt", "enabled"].includes(key));
      if (extra.length) throw new Error(`rules[${index}] has unknown fields: ${extra.join(", ")}`);
      const name = nonempty(rule.name, `rules[${index}].name`);
      if (names.has(name)) throw new Error(`Duplicate rule name: ${name}`);
      names.add(name);
      const result: Rule = {
        name,
        pattern: nonempty(rule.pattern, `${name}.pattern`),
        correctionPrompt: nonempty(rule.correctionPrompt, `${name}.correctionPrompt`),
      };
      if (rule.flags !== undefined) {
        if (typeof rule.flags !== "string") throw new Error(`${name}.flags must be a string`);
        result.flags = rule.flags;
      }
      if (rule.enabled !== undefined) result.enabled = boolean(rule.enabled, `${name}.enabled`);
      return result;
    });
  }
  const config = { enabled, maxRetries, rules };
  // Validate disabled rules too: enabling one later should not reveal a latent syntax error.
  compileRules(rules.map((rule) => ({ ...rule, enabled: true })));
  return config;
}

export interface LoadedConfig {
  config: Config;
  paths: string[];
}

/** Explicit CLI path is exclusive. Otherwise: defaults < personal < trusted project. */
export async function loadConfig(options: {
  cwd: string;
  agentDir: string;
  trusted: boolean;
  explicitPath?: string;
}): Promise<LoadedConfig> {
  const candidates = options.explicitPath
    ? [resolve(options.cwd, options.explicitPath)]
    : [join(options.agentDir, "whoasked.json"), ...(options.trusted ? [join(options.cwd, ".pi", "whoasked.json")] : [])];
  let config = parseConfig({});
  const paths: string[] = [];
  for (const path of candidates) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (!options.explicitPath && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Unable to read ${path}: ${String(error)}`);
    }
    try {
      config = parseConfig(JSON.parse(text), config);
    } catch (error) {
      throw new Error(`${path}: ${String(error)}`);
    }
    paths.push(path);
  }
  return { config, paths };
}
