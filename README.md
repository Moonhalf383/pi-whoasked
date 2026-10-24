# pi-whoasked

English | [简体中文](README.zh-CN.md)

A Pi extension that watches streaming assistant replies for configurable regex patterns. On a match, it interrupts generation and sends the rule's correction prompt, asking the model to answer again from the beginning.

The interrupted reply stays visible, is marked as superseded, and is followed by a new answer. Text already displayed is not retracted.

## Installation

Requires Pi (`@earendil-works/pi-coding-agent`) 1.4.0+ and Node.js 22.19+. Node.js 24 is recommended for running tests.

Load temporarily from the repository directory:

```bash
pi -e ./src/index.ts
```

Install persistently:

```bash
pi install /path/to/whoasked
```

## Configuration

Two built-in rules are enabled by default: `不能声称` (roughly, “cannot claim”) and `不将…冒充为` (“not passing … off as …”). They match wording, so ordinary quotations of these phrases also trigger them. Adjust the rules to suit your usage. The built-in patterns and correction prompts are in Chinese; use your own rules for other languages.

Configuration is merged in this order, with later values taking precedence:

1. Built-in defaults.
2. `<Pi agentDir>/whoasked.json`, usually `~/.pi/agent/whoasked.json`.
3. `<cwd>/.pi/whoasked.json`, only in a project trusted by Pi.

`enabled` and `maxRetries` override previous values. A `rules` array replaces the entire previous rule set; `rules: []` disables all rules. Untrusted project configuration is not read.

You can also specify a standalone file. It is applied over the built-in defaults without loading personal or project configuration:

```bash
pi -e ./src/index.ts --whoasked-config ./whoasked.example.json
```

See [whoasked.example.json](whoasked.example.json) for a complete Chinese-language example. A minimal English-language configuration:

```json
{
  "enabled": true,
  "maxRetries": 2,
  "rules": [
    {
      "name": "Unprompted defensive disclaimer",
      "pattern": "cannot claim",
      "flags": "iu",
      "correctionPrompt": "Answer the original question again. Remove unprompted defensive disclaimers. State the relevant facts and limitations directly, and do not mention this correction."
    }
  ]
}
```

Configuration fields:

- `enabled`: enable detection; defaults to `true`.
- `maxRetries`: maximum automatic corrections per user request; defaults to `2`. Set to `0` to report matches without interrupting.
- `rules[].name`: a unique, nonempty rule name.
- `rules[].pattern`: JavaScript regex source without `/…/` delimiters. Escape backslashes in JSON.
- `rules[].flags`: regex flags; defaults to `u`. An empty string omits the Unicode flag.
- `rules[].correctionPrompt`: a nonempty correction instruction sent to the model on a match.
- `rules[].enabled`: enable this rule; defaults to `true`.

Rules are checked in configuration order; the first matching rule in a snapshot wins. Match state is reset for `g`; `y` retains its sticky semantics. Patterns that match empty input are rejected, and zero-width matches encountered at runtime are skipped. Unknown fields, invalid regexes, or invalid values produce an error and disable detection. Fix the configuration and run `/whoasked reload`.

The example file also includes a disabled “not A but B” rule for Chinese text. That construction often has a legitimate use, so narrow the pattern before enabling it.

For more aggressive Chinese-language filtering, use [configs/zh-CN.strict.json](configs/zh-CN.strict.json):

```bash
pi -e ./src/index.ts --whoasked-config ./configs/zh-CN.strict.json
```

This preset has eight groups with separate correction prompts: phantom contrasts, unsupported accusations of repackaging or exaggeration, defensive evidence qualifiers, replacement disclaimers, exclusive causality, unsolicited action exclusions, hypothetical implications, and a broad negation fallback. It covers phrases such as `而不是`, `不是…而是`, `不把`, `不能替代`, `不据此`, `不宣称`, `不预设`, `不得声称`, `重新包装`, `扩张为`, `唯一原因`, `重新发明`, `尚不能`, `不应继续`, `不能`, `不得`, `不进入`, `不参与`, and `不再`, plus variants such as `这不意味着`, `这不代表`, and `不等于`.

This is aggressive lexical filtering: ordinary statements containing `不能` or `不得` will also trigger it. Specific rules precede fallback rules, but if a streaming chunk ends at `不能`, the fallback triggers immediately without waiting for the rest. Correction prompts preserve facts, necessary limitations, and important risks while asking for more direct wording.

To use it across projects, copy it to `~/.pi/agent/whoasked.json` (back up any existing file), then run `/whoasked reload`. An explicitly selected configuration or a trusted project's configuration can override it.

## Example

```text
User: What tests does this project have?

Assistant: The project has unit and integration tests. We cannot claim…
[Reply interrupted]

whoasked-correction:
[Previous reply superseded; matched “Unprompted defensive disclaimer”; correction 1/2]
<The rule's correction prompt>
Answer the original question from the beginning and reuse existing tool results.

Assistant: Unit and integration tests cover the core functions and main APIs.
Concurrency and failure recovery are not yet covered.
```

Corrections appear as custom messages in the conversation. The original question, existing tool results, and interrupted message history are retained; the session tree is not rolled back.

## Commands

```text
/whoasked           Show status, configuration sources, and enabled rules
/whoasked status    Same as above
/whoasked on        Reload configuration and enable detection for this session
/whoasked off       Disable detection and cancel any pending correction
/whoasked reload    Reload configuration
/whoasked cancel    Cancel further corrections for this request; resume on the next user input
```

Commands do not write configuration files. Configuration is reloaded on session start, session switch, or extension reload.

## Streaming and cancellation

- Detection scans the full accumulated assistant text, so patterns can span streaming chunks. Separate text blocks are joined with newlines.
- Only assistant text is checked, not thinking, tool arguments, tool results, or user messages.
- A match interrupts generation. The extension waits for the run to settle before starting a new answer.
- If you press Escape after the extension has already requested an abort, Pi's public events cannot distinguish that additional stop during the same shutdown window. Use `/whoasked cancel` or `/whoasked off` to explicitly cancel the pending correction.
- New input and already queued input take priority over corrections.
- After `maxRetries` is reached, further matches produce a warning and the current answer continues without interruption.
- Detection and retries also run in JSON/RPC/print modes. Stream consumers still receive previously emitted text and should use message boundaries to distinguish old replies from retries. Status and notification visibility depends on the host interface.

## Development

```bash
npm ci --ignore-scripts
npm run check
```

`check` runs TypeScript checks, configuration and streaming unit tests, and real Pi SDK lifecycle tests. SDK tests use a local simulated model stream, make no online model calls, and do not read user credentials.

Project files:

```text
src/index.ts           Pi extension entry point
src/config.ts          Configuration loading and regex validation
src/extension.ts       Streaming detection, interruption, and retries
whoasked.example.json  Editable configuration example
tests/                 Unit and SDK integration tests
```
