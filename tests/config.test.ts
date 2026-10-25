import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileRules, DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.ts";

const rule = { name: "test", pattern: "不将.{1,40}冒充为", correctionPrompt: "重新回答" };

test("defaults and example configuration are valid", async () => {
  assert.equal(parseConfig({}).maxRetries, 2);
  assert.equal(compileRules(DEFAULT_CONFIG.rules).length, 17);
  const example = await loadConfig({ cwd: process.cwd(), agentDir: "unused", trusted: false, explicitPath: "whoasked.example.json" });
  assert.equal(compileRules(example.config.rules).length, 2);
});

test("rules replace defaults; empty rules disables all matching", () => {
  assert.deepEqual(parseConfig({ rules: [rule] }).rules, [rule]);
  assert.deepEqual(compileRules(parseConfig({ rules: [] }).rules), []);
  assert.equal(compileRules([{ ...rule, enabled: false }]).length, 0);
});

test("invalid config is rejected with useful errors", () => {
  const cases: [unknown, RegExp][] = [
    [null, /must be an object/],
    [{ patterns: [] }, /Unknown configuration fields/],
    [{ enabled: "yes" }, /must be a boolean/],
    [{ maxRetries: -1 }, /nonnegative/],
    [{ maxRetries: 1.5 }, /nonnegative/],
    [{ rules: "x" }, /must be an array/],
    [{ rules: [{ ...rule, correctionPrompt: " " }] }, /nonempty/],
    [{ rules: [rule, rule] }, /Duplicate/],
    [{ rules: [{ ...rule, pattern: "[" }] }, /Invalid regex/],
    [{ rules: [{ ...rule, pattern: "a*" }] }, /empty input/],
    [{ rules: [{ ...rule, flags: "q" }] }, /Invalid regex/],
    [{ rules: [{ ...rule, flags: 1 }] }, /must be a string/],
    [{ rules: [{ ...rule, enabled: "false" }] }, /must be a boolean/],
    [{ rules: [{ ...rule, prompt: "typo" }] }, /unknown fields/],
    [{ rules: [{ ...rule, enabled: false, pattern: "[" }] }, /Invalid regex/],
  ];
  for (const [input, expected] of cases) assert.throws(() => parseConfig(input), expected);
});

test("config precedence, project trust and explicit paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "whoasked-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir);
  assert.deepEqual((await loadConfig({ cwd, agentDir, trusted: true })).paths, []);
  await writeFile(join(agentDir, "whoasked.json"), JSON.stringify({ maxRetries: 4, rules: [rule] }));
  await writeFile(join(cwd, ".pi", "whoasked.json"), JSON.stringify({ enabled: false, rules: [] }));
  const personal = await loadConfig({ cwd, agentDir, trusted: false });
  assert.equal(personal.config.maxRetries, 4);
  assert.deepEqual(personal.config.rules, [rule]);
  const project = await loadConfig({ cwd, agentDir, trusted: true });
  assert.equal(project.config.enabled, false);
  assert.equal(project.config.maxRetries, 4);
  assert.deepEqual(project.config.rules, []);
  assert.equal(project.paths.length, 2);
  await writeFile(join(cwd, "explicit.json"), JSON.stringify({ maxRetries: 1 }));
  const explicit = await loadConfig({ cwd, agentDir, trusted: true, explicitPath: "explicit.json" });
  assert.equal(explicit.config.enabled, true);
  assert.equal(explicit.config.maxRetries, 1);
  assert.deepEqual(explicit.config.rules, DEFAULT_CONFIG.rules);
  assert.equal(explicit.paths.length, 1);
  await assert.rejects(loadConfig({ cwd, agentDir, trusted: false, explicitPath: "missing.json" }), /Unable to read/);
  await writeFile(join(agentDir, "whoasked.json"), "{ broken");
  await assert.rejects(loadConfig({ cwd, agentDir, trusted: false }), /whoasked.json/);
});
