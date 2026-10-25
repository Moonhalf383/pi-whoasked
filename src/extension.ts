import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compileRules, loadConfig } from "./config.ts";
import type { CompiledRule, Config } from "./config.ts";

const CORRECTION_TYPE = "whoasked-correction";

interface Hit {
  rule: CompiledRule;
  matched: string;
}

/** Kept separate from the entry point so lifecycle tests need no Pi runtime imports. */
export function registerWhoasked(pi: ExtensionAPI, agentDir: string): void {
  let config: Config = { enabled: false, maxRetries: 2, rules: [] };
  let rules: CompiledRule[] = [];
  let paths: string[] = [];
  let retries = 0;
  let pending: Hit | undefined;
  let expectedRetryToken: string | undefined;
  let lastText = "";
  let handled = false;
  let superseded = false;
  let active = true;

  function reset(): void {
    retries = 0;
    pending = undefined;
    expectedRetryToken = undefined;
    lastText = "";
    handled = false;
    superseded = false;
  }

  function status(ctx: ExtensionContext): void {
    ctx.ui.setStatus("whoasked", config.enabled ? `whoasked: on (${rules.length})` : "whoasked: off");
  }

  async function reload(ctx: ExtensionContext): Promise<boolean> {
    try {
      const flag = pi.getFlag("whoasked-config");
      const loaded = await loadConfig({
        cwd: ctx.cwd,
        agentDir,
        trusted: ctx.isProjectTrusted(),
        explicitPath: typeof flag === "string" ? flag : undefined,
      });
      config = loaded.config;
      rules = compileRules(config.rules);
      paths = loaded.paths;
      reset();
      status(ctx);
      return true;
    } catch (error) {
      // Fail visibly and disable detection instead of silently applying different rules.
      config = { ...config, enabled: false };
      reset();
      status(ctx);
      ctx.ui.notify(`whoasked: Configuration load failed; detection disabled. ${String(error)}`, "error");
      return false;
    }
  }

  function inspect(message: { role: string; content?: unknown }, ctx: ExtensionContext): void {
    if (!active || !config.enabled || handled || superseded || pending || ctx.signal?.aborted || ctx.hasPendingMessages()) return;
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    // Use the complete current snapshot, not individual deltas: patterns may span chunks.
    // Thinking and tool arguments/results are deliberately excluded.
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text as string)
      .join("\n");
    if (text === lastText) return;
    lastText = text;
    for (const rule of rules) {
      // g/y expressions are stateful. Each snapshot is an independent match operation.
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(text)) && match[0].length === 0) {
        // exec() does not advance on an empty match. Advance one Unicode code point
        // where required so a zero-width alternative cannot hide a later real hit.
        const index = rule.regex.lastIndex;
        const unicode = rule.regex.unicode || rule.regex.flags.includes("v");
        rule.regex.lastIndex = index + (unicode && (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
      }
      rule.regex.lastIndex = 0;
      if (!match) continue;
      handled = true;
      if (retries >= config.maxRetries) {
        pi.appendEntry("whoasked-limit", { rule: rule.name, retries });
        ctx.ui.notify(`whoasked: Matched "${rule.name}"; retry limit (${config.maxRetries}) reached. The current reply will continue.`, "warning");
        return;
      }
      pending = { rule, matched: match[0] };
      // Do not await abort/idle from inside a stream handler: that would deadlock.
      ctx.abort();
      ctx.ui.notify(`whoasked: Matched "${rule.name}"; interruption requested. Preparing a new reply.`, "warning");
      return;
    }
  }

  pi.registerFlag("whoasked-config", {
    description: "Path to a whoasked JSON configuration (relative to cwd or absolute)",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    active = true;
    await reload(ctx);
  });
  pi.on("session_shutdown", () => {
    active = false;
    reset();
  });

  pi.on("input", () => {
    // New input takes precedence over rewriting an old answer, including queued input.
    reset();
    superseded = true;
  });

  pi.on("before_agent_start", (event) => {
    const details = event.messageType === "custom" ? event.message.details as { retryToken?: string } | undefined : undefined;
    const ownRetry = expectedRetryToken !== undefined && event.messageType === "custom"
      && event.message.customType === CORRECTION_TYPE && details?.retryToken === expectedRetryToken;
    if (!ownRetry) reset();
    expectedRetryToken = undefined;
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "user") reset();
    if (event.message.role === "assistant") {
      lastText = "";
      handled = false;
    }
  });
  pi.on("message_update", (event, ctx) => inspect(event.message, ctx));
  // Also catches providers which deliver a final text block without text_delta events.
  pi.on("message_end", (event, ctx) => inspect(event.message, ctx));

  pi.on("agent_settled", (event, ctx) => {
    const hit = pending;
    pending = undefined;
    // Never restart an ordinary user-cancelled run: only our own recorded hit qualifies.
    // Send only AFTER settlement; abort clears/stops queued in-run continuations.
    if (!active || !hit || !event.aborted || !config.enabled || superseded || ctx.hasPendingMessages()) return;
    retries += 1;
    expectedRetryToken = randomUUID();
    pi.sendMessage({
      customType: CORRECTION_TYPE,
      content: [
        `[whoasked: Previous reply interrupted and superseded; matched "${hit.rule.name}"; correction ${retries}/${config.maxRetries}]`,
        hit.rule.correctionPrompt,
        "Answer the original user request from the beginning in the language requested by the user. Reuse existing tool results and avoid repeating completed operations merely to rewrite the reply.",
      ].join("\n\n"),
      display: true,
      details: { retryToken: expectedRetryToken, rule: hit.rule.name, matched: hit.matched, retry: retries },
    }, { triggerTurn: true });
  });

  pi.registerCommand("whoasked", {
    description: "Configure response correction: status | on | off | reload | cancel",
    handler: async (args, ctx) => {
      switch (args.trim() || "status") {
        case "status":
          ctx.ui.notify([
            `whoasked: ${config.enabled ? "on" : "off"}; maxRetries=${config.maxRetries}; retries=${retries}`,
            `Configuration: ${paths.length ? paths.join(", ") : "Built-in bilingual defaults"}`,
            `Enabled rules: ${rules.map((rule) => rule.name).join(", ") || "None"}`,
          ].join("\n"), "info");
          return;
        case "on":
          // Reload also validates configuration before enabling a previously disabled guard.
          if (await reload(ctx)) {
            config.enabled = true;
            status(ctx);
            ctx.ui.notify("whoasked: Detection enabled for this session.", "info");
          }
          return;
        case "off":
          config.enabled = false;
          reset();
          status(ctx);
          ctx.ui.notify("whoasked: Detection disabled and pending correction cancelled for this session.", "info");
          return;
        case "cancel":
          reset();
          superseded = true;
          ctx.ui.notify("whoasked: Further corrections cancelled for this request. Detection resumes on the next user input.", "info");
          return;
        case "reload":
          if (await reload(ctx)) ctx.ui.notify("whoasked: Configuration reloaded.", "info");
          return;
        default:
          ctx.ui.notify("Usage: /whoasked [status|on|off|reload|cancel]", "warning");
      }
    },
  });
}
