import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";

// Keep the shipped presets as the single source of rule patterns.
const chinese = JSON.parse(readFileSync(new URL("../configs/zh-CN.strict.json", import.meta.url), "utf8")) as Config;
const english = JSON.parse(readFileSync(new URL("../configs/en.strict.json", import.meta.url), "utf8")) as Config;

// The Chinese preset has the same categories except for the English caveat group.
// Use English labels/prompts in the bilingual default; prompts preserve the reply language.
const chineseDefaults = chinese.rules.map((rule, index) => {
  const counterpart = english.rules[index === chinese.rules.length - 1 ? english.rules.length - 1 : index];
  return { ...rule, name: `${counterpart.name} [zh]`, correctionPrompt: counterpart.correctionPrompt };
});
const englishDefaults = english.rules.map((rule) => ({ ...rule, name: `${rule.name} [en]` }));

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  maxRetries: 2,
  rules: [
    ...chineseDefaults.slice(0, -1),
    ...englishDefaults.slice(0, -1),
    chineseDefaults.at(-1)!,
    englishDefaults.at(-1)!,
  ],
};
