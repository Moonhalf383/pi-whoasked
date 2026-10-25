# @moonhalf383/pi-whoasked

English | [简体中文](README.zh-CN.md)

![Nobody asked you](whoasked.jpg)

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

Chinese and English rules are enabled by default: all eight groups from the Chinese strict preset plus nine English groups. Notifications, status text, configuration errors, and correction-message framing use English. Default rule names and correction prompts are also in English; prompts ask the model to keep the user's requested reply language. Custom rule names and prompts are displayed as configured.

Configuration is merged in this order, with later values taking precedence:

1. Built-in defaults.
2. `<Pi agentDir>/whoasked.json`, usually `~/.pi/agent/whoasked.json`.
3. `<cwd>/.pi/whoasked.json`, only in a project trusted by Pi.

`enabled` and `maxRetries` override previous values. A `rules` array replaces the entire previous rule set; `rules: []` disables all rules. Untrusted project configuration is not read.

You can also specify a standalone file. It is applied over the built-in defaults without loading personal or project configuration:

```bash
pi -e ./src/index.ts --whoasked-config ./whoasked.example.json
```

No configuration file is needed to use the bilingual defaults. To keep the defaults while adjusting the retry limit, use `{ "maxRetries": 4 }`. A file containing `rules` replaces all built-in rules, including English rules; remove that field to inherit future defaults.

See [whoasked.example.json](whoasked.example.json) for a smaller custom Chinese rule set. A minimal English-only override:

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

For single-language overrides, use [configs/zh-CN.strict.json](configs/zh-CN.strict.json) (Chinese names and prompts) or [configs/en.strict.json](configs/en.strict.json) (English). These are subsets of the bilingual defaults, not additional detection modes:

```bash
pi -e ./src/index.ts --whoasked-config ./configs/zh-CN.strict.json
```

Both languages cover contrasts, repackaging accusations, evidence qualifiers, replacement disclaimers, exclusive causality, action exclusions, hypothetical implications, and broad negation. English adds formulaic caveats. Common English forms include negative-positive contrasts, implication disclaimers, replacement warnings, and stock cautionary introductions. Matching is case-insensitive for English and supports straight and curly apostrophes. See [English pattern notes](docs/english-patterns.md) for examples and user reports that informed the rules.

The defaults are aggressive lexical filters. Ordinary negation, comparisons, quotations, and code examples can trigger corrections. Specific groups precede broad fallback rules, but a short streaming prefix can trigger the fallback before a more specific phrase arrives. Correction prompts preserve facts, important risks, and necessary limitations. Narrow or replace rules to reduce false positives.

After updating the extension, run `/reload` to load the new code. `/whoasked reload` only reloads configuration files.

## Example

```text
User: What tests does this project have?

Assistant: The project has unit and integration tests. We cannot claim…
[Reply interrupted]

whoasked-correction:
[Previous reply superseded; matched “Defensive evidence qualifiers [en]”; correction 1/2]
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

This package uses Pi's explicit `pi.extensions` manifest to load `src/index.ts`. An `extensions/` directory and compiled JavaScript output are optional; Pi loads the TypeScript entry directly. The Pi host is declared as a peer dependency and is excluded from the archive. Pi 1.4.0+ is required by the extension API.

Prepare and verify a local release archive without publishing:

```bash
npm pack
npm run pack:check
```

`npm pack` runs `check` first through `prepack`. `pack:check` installs the archive in an isolated temporary directory, checks its contents, and verifies Pi package discovery and bilingual startup without calling a model. The resulting file is `moonhalf383-pi-whoasked-0.1.0.tgz`. Scoped npm packages are configured for public access; these commands only create and test a local archive.

Project files:

```text
src/index.ts           Pi extension entry point
src/config.ts          Configuration loading and regex validation
src/defaults.ts        Bilingual default rule assembly
configs/               Chinese and English rule presets
src/extension.ts       Streaming detection, interruption, and retries
whoasked.example.json  Editable configuration example
tests/                 Unit and SDK integration tests
```
