import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  maxRetries: 2,
  rules: [
    {
      name: "不能声称",
      pattern: "不能声称",
      correctionPrompt: "请重新回答原问题。直接说明事实、证据和必要的局限，删除无端引入的‘不能声称’式防御性声明。保留与问题相关的实质信息，不要提及本次校正。",
    },
    {
      name: "无端引入冒充关系",
      pattern: "不将[^。！？\\n]{1,40}冒充为",
      correctionPrompt: "请重新回答原问题。删除无端引入的‘冒充’指控或防御性声明，直接陈述有依据的信息和相关局限。不要引入原问题没有涉及的对立，不要提及本次校正。",
    },
  ],
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
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
      throw new Error(`规则「${rule.name}」的正则无效：${String(error)}`);
    }
    if (regex.test("")) throw new Error(`规则「${rule.name}」不能匹配空字符串`);
    regex.lastIndex = 0;
    return { ...rule, regex };
  });
}

/** Each supplied rules array replaces the previous array, rather than merging by name. */
export function parseConfig(value: unknown, base: Config = DEFAULT_CONFIG): Config {
  const raw = object(value, "配置");
  const unknown = Object.keys(raw).filter((key) => !["enabled", "maxRetries", "rules"].includes(key));
  if (unknown.length) throw new Error(`未知配置字段：${unknown.join(", ")}`);
  const enabled = raw.enabled === undefined ? base.enabled : boolean(raw.enabled, "enabled");
  const maxRetries = raw.maxRetries === undefined ? base.maxRetries : raw.maxRetries;
  if (typeof maxRetries !== "number" || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries 必须是非负安全整数");
  }
  let rules = base.rules;
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) throw new Error("rules 必须是数组");
    const names = new Set<string>();
    rules = raw.rules.map((value, index) => {
      const rule = object(value, `rules[${index}]`);
      const extra = Object.keys(rule).filter((key) => !["name", "pattern", "flags", "correctionPrompt", "enabled"].includes(key));
      if (extra.length) throw new Error(`rules[${index}] 未知字段：${extra.join(", ")}`);
      const name = nonempty(rule.name, `rules[${index}].name`);
      if (names.has(name)) throw new Error(`重复规则名称：${name}`);
      names.add(name);
      const result: Rule = {
        name,
        pattern: nonempty(rule.pattern, `${name}.pattern`),
        correctionPrompt: nonempty(rule.correctionPrompt, `${name}.correctionPrompt`),
      };
      if (rule.flags !== undefined) {
        if (typeof rule.flags !== "string") throw new Error(`${name}.flags 必须是字符串`);
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
      throw new Error(`无法读取 ${path}：${String(error)}`);
    }
    try {
      config = parseConfig(JSON.parse(text), config);
    } catch (error) {
      throw new Error(`${path}：${String(error)}`);
    }
    paths.push(path);
  }
  return { config, paths };
}
