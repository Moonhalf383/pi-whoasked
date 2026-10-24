import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerWhoasked } from "../src/extension.ts";

const testRule = { name: "冒充", pattern: "不将.{1,40}冒充为", correctionPrompt: "请直接说明测试情况，重新回答。" };
const assistant = (text: string, extra: object[] = []) => ({ role: "assistant", content: [{ type: "text", text }, ...extra] });

type Handler = (event: any, ctx: any) => unknown;

async function fixture(t: TestContext, config: object = { rules: [testRule] }) {
  const root = await mkdtemp(join(tmpdir(), "whoasked-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "whoasked.json");
  await writeFile(configPath, JSON.stringify(config));
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const sent: { message: any; options: any }[] = [];
  const notices: string[] = [];
  const entries: unknown[] = [];
  const statuses: string[] = [];
  let aborts = 0;
  let controller = new AbortController();
  let busy = true;
  let queued = false;
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerFlag: () => {},
    getFlag: () => configPath,
    registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
    sendMessage: (message: any, options: any) => sent.push({ message, options }),
    appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    isProjectTrusted: () => true,
    isIdle: () => !busy,
    hasPendingMessages: () => queued,
    get signal() { return controller.signal; },
    abort: () => { aborts++; controller.abort(); },
    ui: {
      notify: (text: string) => notices.push(text),
      setStatus: (_key: string, text: string) => statuses.push(text),
    },
  } as unknown as ExtensionContext;
  registerWhoasked(pi, root);
  const emit = async (name: string, event: object = {}) => handlers.get(name)?.(event, ctx);
  const command = async (arg: string) => commands.get("whoasked")?.handler(arg, ctx);
  const start = async (retry?: { message: any }) => {
    controller = new AbortController();
    busy = true;
    await emit("before_agent_start", retry
      ? { messageType: "custom", message: retry.message }
      : { messageType: "user", prompt: "介绍测试情况" });
    await emit("message_start", { message: assistant("") });
  };
  const update = async (message: any) => emit("message_update", { message });
  const settle = async (aborted = controller.signal.aborted) => {
    busy = false;
    await emit("agent_settled", { aborted });
  };
  await emit("session_start");
  await start();
  return {
    emit, start, update, settle, command, sent, notices, entries, statuses, configPath,
    get aborts() { return aborts; },
    setQueued(value: boolean) { queued = value; },
    manualAbort() { controller.abort(); },
  };
}

test("split-chunk pattern aborts once, then sends visible correction only after settlement", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("项目包含测试。不将已有测试冒"));
  assert.equal(f.aborts, 0);
  await f.update(assistant("项目包含测试。不将已有测试冒充为质量保证"));
  assert.equal(f.aborts, 1);
  assert.equal(f.sent.length, 0);
  await f.update(assistant("项目包含测试。不将已有测试冒充为质量保证。"));
  await f.emit("message_end", { message: assistant("项目包含测试。不将已有测试冒充为质量保证。") });
  assert.equal(f.aborts, 1);
  await f.settle();
  assert.equal(f.sent.length, 1);
  const { message, options } = f.sent[0];
  assert.equal(message.display, true);
  assert.match(message.content, /上一条回答已中断并作废/);
  assert.match(message.content, /请直接说明测试情况/);
  assert.match(message.content, /从头重新回答原用户问题/);
  assert.equal(options.triggerTurn, true);
  assert.equal(message.details.matched, "不将已有测试冒充为");
  await f.settle();
  assert.equal(f.sent.length, 1);
});

test("retry budget survives own correction runs; limit does not hide or abort last answer", async (t) => {
  const f = await fixture(t, { maxRetries: 2, rules: [testRule] });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await f.start(f.sent.at(-1));
    await f.update(assistant("不将测试冒充为保证"));
    await f.settle();
  }
  assert.equal(f.aborts, 2);
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[1].message.content, /2\/2/);
  assert.ok(f.notices.some((notice) => notice.includes("上限")));
  assert.equal(f.entries.length, 1);
  await f.start();
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  assert.equal(f.aborts, 3);
  assert.match(f.sent[2].message.content, /1\/2/);
});

test("a successful retry ends normally", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  await f.start(f.sent[0]);
  await f.update(assistant("项目有单元测试，尚缺并发测试。"));
  await f.settle(false);
  assert.equal(f.sent.length, 1);
});

test("manual abort without a plugin hit never triggers correction", async (t) => {
  const f = await fixture(t);
  f.manualAbort();
  await f.update(assistant("不将测试冒充为保证"));
  await f.emit("message_end", { message: assistant("不将测试冒充为保证") });
  await f.settle();
  assert.equal(f.aborts, 0);
  assert.equal(f.sent.length, 0);
});

test("manually stopping a retry does not restart it", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  await f.start(f.sent[0]);
  await f.update(assistant("项目有测试。"));
  f.manualAbort();
  await f.settle();
  assert.equal(f.sent.length, 1);
});

test("pending user input has priority and prevents an abort", async (t) => {
  const f = await fixture(t);
  f.setQueued(true);
  await f.update(assistant("不将测试冒充为保证"));
  assert.equal(f.aborts, 0);
});

test("new input cancels an already pending correction", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("不将测试冒充为保证"));
  await f.emit("input", { source: "interactive", text: "换个问题" });
  await f.settle();
  assert.equal(f.sent.length, 0);
});

test("non-text blocks, tool results, user messages are ignored", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("正常回答", [
    { type: "thinking", thinking: "不将测试冒充为保证" },
    { type: "toolCall", name: "bash", arguments: { command: "不将测试冒充为保证" } },
  ]));
  await f.emit("message_end", { message: { role: "user", content: [{ type: "text", text: "不将测试冒充为保证" }] } });
  await f.emit("message_end", { message: { role: "toolResult", content: [{ type: "text", text: "不将测试冒充为保证" }] } });
  await f.emit("message_end", { message: { role: "bashExecution", output: "不将测试冒充为保证" } });
  await f.settle(false);
  assert.equal(f.aborts, 0);
});

test("final-only response is detected at message_end", async (t) => {
  const f = await fixture(t);
  await f.emit("message_end", { message: assistant("不将测试冒充为保证") });
  await f.settle();
  assert.equal(f.aborts, 1);
  assert.equal(f.sent.length, 1);
});

test("global and sticky regexes reset lastIndex between snapshots", async (t) => {
  for (const flags of ["g", "y"]) {
    const f = await fixture(t, { rules: [{ ...testRule, pattern: "不将测试冒充为", flags }] });
    await f.update(assistant("不将测试冒"));
    await f.update(assistant("不将测试冒充为保证"));
    await f.settle();
    await f.start(f.sent[0]);
    await f.update(assistant("不将测试冒充为保证"));
    assert.equal(f.aborts, 2);
  }
});

test("rule order determines which correction is sent", async (t) => {
  const f = await fixture(t, { rules: [{ ...testRule, name: "first", pattern: "测试" }, testRule] });
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  assert.equal(f.sent[0].message.details.rule, "first");
});

test("empty runtime matches are ignored", async (t) => {
  const f = await fixture(t, { rules: [{ ...testRule, pattern: "(?=测试)" }] });
  await f.update(assistant("测试"));
  assert.equal(f.aborts, 0);
});

test("an empty alternative does not mask a later nonempty match", async (t) => {
  for (const flags of ["u", "", "v"]) {
    const f = await fixture(t, { rules: [{ ...testRule, pattern: "(?=😀)|forbidden", flags }] });
    await f.update(assistant("😀 forbidden"));
    await f.settle();
    assert.equal(f.aborts, 1);
    assert.equal(f.sent[0].message.details.matched, "forbidden");
  }
});

test("maxRetries zero, disabled config and disabled rules do not abort", async (t) => {
  for (const config of [
    { maxRetries: 0, rules: [testRule] },
    { enabled: false, rules: [testRule] },
    { rules: [{ ...testRule, enabled: false }] },
    { rules: [] },
  ]) {
    const f = await fixture(t, config);
    await f.update(assistant("不将测试冒充为保证"));
    await f.settle(false);
    assert.equal(f.aborts, 0);
    assert.equal(f.sent.length, 0);
  }
});

test("off and cancel discard pending corrections", async (t) => {
  for (const command of ["off", "cancel"]) {
    const f = await fixture(t);
    await f.update(assistant("不将测试冒充为保证"));
    await f.command(command);
    await f.settle();
    assert.equal(f.sent.length, 0);
    await f.start();
    await f.update(assistant("不将测试冒充为保证"));
    assert.equal(f.aborts, command === "off" ? 1 : 2);
  }
});

test("cancel suppresses corrections for the rest of the current run", async (t) => {
  const f = await fixture(t);
  await f.command("cancel");
  await f.emit("message_start", { message: assistant("") });
  await f.update(assistant("不将测试冒充为保证"));
  assert.equal(f.aborts, 0);
});

test("reload validates new rules; invalid configuration disables detection", async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, "invalid json");
  await f.command("reload");
  await f.update(assistant("不将测试冒充为保证"));
  assert.equal(f.aborts, 0);
  assert.ok(f.notices.some((notice) => notice.includes("配置加载失败")));
  await writeFile(f.configPath, JSON.stringify({ rules: [{ ...testRule, pattern: "新的词组" }] }));
  await f.command("on");
  await f.update(assistant("不将测试冒充为保证"));
  assert.equal(f.aborts, 0);
  await f.update(assistant("新的词组"));
  assert.equal(f.aborts, 1);
  await f.command("status");
  assert.ok(f.notices.at(-1)?.includes(f.configPath));
});

test("shutdown discards pending correction and session_start reloads", async (t) => {
  const f = await fixture(t);
  await f.update(assistant("不将测试冒充为保证"));
  await f.emit("session_shutdown");
  await f.settle();
  assert.equal(f.sent.length, 0);
  await f.emit("session_start");
  await f.start();
  await f.update(assistant("不将测试冒充为保证"));
  assert.equal(f.aborts, 2);
});

test("unrelated custom run resets retry budget", async (t) => {
  const f = await fixture(t, { maxRetries: 1, rules: [testRule] });
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  await f.start({ message: { ...f.sent[0].message, details: { retryToken: "other-extension" } } });
  await f.update(assistant("不将测试冒充为保证"));
  await f.settle();
  assert.equal(f.aborts, 2);
});
