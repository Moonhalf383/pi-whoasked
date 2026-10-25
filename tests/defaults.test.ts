import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileRules, DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

const english = parseConfig(JSON.parse(await readFile(new URL("../configs/en.strict.json", import.meta.url), "utf8")));
const chinese = parseConfig(JSON.parse(await readFile(new URL("../configs/zh-CN.strict.json", import.meta.url), "utf8")));
const compiled = compileRules(DEFAULT_CONFIG.rules);
function match(text: string) {
  return compiled.find((rule) => { rule.regex.lastIndex = 0; return rule.regex.test(text); });
}

test("defaults promote the whole Chinese preset and enable English rules", () => {
  assert.equal(compiled.length, 17);
  assert.deepEqual(DEFAULT_CONFIG.rules.filter((r) => r.name.endsWith("[zh]")).map((r) => r.pattern), chinese.rules.map((r) => r.pattern));
  assert.deepEqual(DEFAULT_CONFIG.rules.filter((r) => r.name.endsWith("[en]")).map((r) => r.pattern), english.rules.map((r) => r.pattern));
  for (const rule of DEFAULT_CONFIG.rules) {
    assert.ok(!/\p{Script=Han}/u.test(rule.name + rule.correctionPrompt));
    assert.match(rule.correctionPrompt, /original language/);
  }
  assert.ok(compiled.at(-2)?.name.includes("fallback"));
  assert.ok(compiled.at(-1)?.name.includes("fallback"));
});

test("English forms select specific groups before the broad fallback", () => {
  const groups = [
    ["Phantom contrasts", [
      "It's not a bug, it's a feature.", "It’s not a bug—it’s a feature.",
      "This isn't a bug. It's a feature.", "You're not confused—you're learning.",
      "IT IS NOT X; IT IS Y", "Not just speed, but reliability.",
      "This is not just speed, it is reliability.", "Not X but Y", "rather than", "instead of",
    ]],
    ["Unsupported accusations of repackaging", ["repackaging", "passing off", "reinventing the wheel", "masquerading as"]],
    ["Defensive evidence qualifiers", ["cannot claim", "CAN’T CLAIM", "shouldn't assume", "must not infer", "not claiming", "without assuming"]],
    ["Unsolicited replacement disclaimers", ["not a substitute for", "not a replacement for", "cannot replace", "can't replace"]],
    ["Invented exclusive causality", ["the only reason", "the sole cause", "a single factor", "Correlation doesn’t necessarily imply causation"]],
    ["Unsolicited action exclusions", ["cannot yet", "can't yet", "won’t engage", "no longer", "should not continue"]],
    ["Hypothetical implications", ["That doesn’t mean", "this does not necessarily imply", "it doesn't prove", "not equivalent to", "isn't the same as"]],
    ["Formulaic caveats", ["One caveat", "one important distinction", "one thing I’d caution against", "it is important to remember", "to be clear"]],
    ["Broad negation fallback", ["cannot", "can't", "must not", "mustn’t"]],
  ] as const;
  for (const [name, samples] of groups) {
    for (const sample of samples) assert.equal(match(sample)?.name, `${name} [en]`, sample);
  }
});

test("all Chinese categories still match with English default labels", () => {
  for (const text of ["而不是", "重新包装", "不据此", "不能替代", "唯一原因", "不参与", "这不意味着", "不得"]) {
    assert.ok(match(text)?.name.endsWith("[zh]"), text);
  }
});

test("English boundaries and bounded clauses avoid unrelated words and long spans", () => {
  for (const text of [
    "The project has unit and integration tests.", "The scanner is ready.",
    "Butter and notable improvements.", "It is not ready.", "A clear result.",
    `Not ${"x".repeat(161)} but Y`, "Not X. The next sentence mentions but.",
  ]) assert.equal(match(text), undefined, text);
});

test("existing user rules replace bilingual defaults without implicit migration", () => {
  assert.deepEqual(parseConfig(chinese).rules, chinese.rules);
  assert.equal(parseConfig({ maxRetries: 1 }).rules.length, 17);
  assert.equal(parseConfig({ rules: [] }).rules.length, 0);
});
