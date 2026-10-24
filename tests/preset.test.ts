import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileRules, parseConfig } from "../src/config.ts";

const raw = JSON.parse(await readFile(new URL("../configs/zh-CN.strict.json", import.meta.url), "utf8"));
const config = parseConfig(raw);
const rules = compileRules(config.rules);
const match = (text: string) => rules.find((rule) => {
  rule.regex.lastIndex = 0;
  return rule.regex.test(text);
});

test("strict Chinese preset covers every requested pattern and keeps specific prompts first", () => {
  assert.equal(config.enabled, true);
  assert.equal(config.maxRetries, 2);
  assert.equal(rules.length, 8);
  const groups = [
    ["而不是", "不是一个目标，而是另一个目标"],
    ["不把", "不将已有结果冒充为结论", "重新包装", "扩张为", "重新发明"],
    ["不据此", "不宣称", "不预设", "不得声称", "不能声称"],
    ["不能替代"],
    ["唯一原因"],
    ["尚不能", "不应继续", "不进入", "不参与", "不再"],
    ["这不意味着", "这并不意味着", "此不代表", "这不代表", "这并不代表", "不等于"],
    ["不能", "不得"],
  ];
  for (const [index, samples] of groups.entries()) {
    for (const text of samples) {
      assert.equal(match(text)?.name, rules[index].name, `wrong correction group: ${text}`);
    }
  }
});

test("contrast pattern is bounded to a sentence and normal affirmative text stays unmatched", () => {
  for (const text of [
    "项目包含单元测试和集成测试。",
    "现有证据支持这一判断，适用范围是当前样本。",
    "不是前一个目标。这里讨论而是这个词的用法。",
    `不是${"字".repeat(161)}而是目标`,
    "不是第一个目标\n而是第二个目标",
  ]) assert.equal(match(text), undefined, text);
});
