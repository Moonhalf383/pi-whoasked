import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTick } from "node:timers/promises";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, TranscriptContext } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerWhoasked } from "../src/extension.ts";

// Actual SDK lifecycle, with only the model transport replaced. Never uses online credentials.
const scenarios = [
  { name: "limit=1", maxRetries: 1, correctedRetry: false, manualStop: false },
  { name: "limit=2", maxRetries: 2, correctedRetry: false, manualStop: false },
  { name: "successful rewrite", maxRetries: 2, correctedRetry: true, manualStop: false },
  { name: "manual stop during rewrite", maxRetries: 2, correctedRetry: true, manualStop: true },
  { name: "English bilingual defaults", maxRetries: 2, correctedRetry: true, manualStop: false },
  { name: "Chinese bilingual defaults", maxRetries: 2, correctedRetry: true, manualStop: false },
];
for (const { name, maxRetries, correctedRetry, manualStop } of scenarios) {
  test(`Pi SDK: real abort + post-settlement correction (${name})`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "whoasked-sdk-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const useDefaults = name.endsWith("bilingual defaults");
    const englishReply = name.startsWith("English");
    await writeFile(join(root, "whoasked.json"), JSON.stringify(useDefaults ? { maxRetries } : {
      maxRetries,
      rules: [{ name: "测试", pattern: "不将.{1,40}冒充为", correctionPrompt: "请重新回答原问题。" }],
    }));
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: root, agentDir: root, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi) => registerWhoasked(pi, root)],
    });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(root, "auth.json"), modelsPath: join(root, "models.json"),
    });
    modelRuntime.registerProvider("whoasked-test", {
      baseUrl: "http://127.0.0.1:1/never-called",
      apiKey: "fake-test-key",
      api: "openai-completions",
      models: [{
        id: "fake", name: "Fake", reasoning: false, input: ["text"],
        contextWindow: 128000, maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
    const { session } = await createAgentSession({
      cwd: root, agentDir: root, modelRuntime,
      model: modelRuntime.getModel("whoasked-test", "fake"),
      resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(root), tools: [],
    });
    t.after(() => session.dispose());
    const errors: unknown[] = [];
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
    const requests: TranscriptContext[] = [];
    const endings: string[] = [];
    let manuallyStopped = false;
    session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") endings.push(event.message.stopReason);
      if (manualStop && requests.length === 2 && event.type === "message_update"
        && event.assistantMessageEvent.type === "text_delta" && !manuallyStopped) {
        manuallyStopped = true;
        void session.abort();
      }
    });
    session.agent.streamFunction = (model, context, options) => {
      requests.push(structuredClone(context));
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), content: [], stopReason: "stop",
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      void (async () => {
        stream.push({ type: "start", partial: message });
        message.content = [{ type: "text", text: "" }];
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        // Separate turns of the event loop let the SDK process each snapshot before the next.
        const deltas = correctedRetry && requests.length > 1
          ? (englishReply ? ["Unit tests cover core functions.", " Add concurrency tests."] : ["项目有单元测试。", "尚缺并发测试。", "鼓励补充测试。"])
          : (englishReply ? ["That doesn’", "t mean", " the project has complete coverage."] : ["项目有测试。不将已有测试冒", "充为质量保证", "。结束。鼓励补充测试。"]);
        for (const delta of deltas) {
          await nextTick();
          if (options?.signal?.aborted) break;
          const block = message.content[0];
          if (block.type === "text") block.text += delta;
          stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
        }
        await nextTick();
        if (options?.signal?.aborted) {
          message.stopReason = "aborted";
          message.errorMessage = "Aborted";
          stream.push({ type: "error", reason: "aborted", error: message });
        } else {
          const block = message.content[0];
          stream.push({ type: "text_end", contentIndex: 0, content: block.type === "text" ? block.text : "", partial: message });
          stream.push({ type: "done", reason: "stop", message });
        }
        stream.end();
      })();
      return stream;
    };
    const prompt = englishReply ? "What tests does the project have?" : "介绍一下这个项目的测试情况";
    await session.prompt(prompt);
    assert.deepEqual(errors, []);
    const retryCount = correctedRetry ? 1 : maxRetries;
    assert.equal(requests.length, retryCount + 1);
    assert.deepEqual(endings, [...Array(retryCount).fill("aborted"), manualStop ? "aborted" : "stop"]);
    assert.equal(manuallyStopped, manualStop);
    const corrections = session.messages.filter((message) => message.role === "custom" && message.customType === "whoasked-correction");
    assert.equal(corrections.length, retryCount);
    const lastRequestText = JSON.stringify(requests.at(-1));
    assert.ok(lastRequestText.includes(prompt));
    assert.match(lastRequestText, useDefaults ? /original language/ : /请重新回答原问题/);
    if (useDefaults) {
      assert.equal(corrections[0].role, "custom");
      assert.ok(!/\p{Script=Han}/u.test(String(corrections[0].content)));
    }
    if (!manualStop) assert.ok(session.getLastAssistantText()?.includes(englishReply ? "concurrency tests" : "鼓励补充测试"));
    assert.equal(session.isIdle, true);
  });
}
