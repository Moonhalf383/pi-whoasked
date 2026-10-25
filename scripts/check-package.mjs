import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const filename = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
const archive = resolve(process.argv[2] ?? join(root, filename));
const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
for (const path of [
  "package.json", "LICENSE", "README.md", "README.zh-CN.md", "whoasked.jpg", "example.png",
  "src/index.ts", "src/extension.ts", "src/config.ts", "src/defaults.ts",
  "configs/zh-CN.strict.json", "configs/en.strict.json", "docs/english-patterns.md", "whoasked.example.json",
]) assert.ok(files.includes(`package/${path}`), `Missing published file: ${path}`);
assert.ok(files.every((path) => !/(?:^|\/)(?:node_modules|tests|\.git|\.pi)(?:\/|$)|\.bak$|\.tgz$/.test(path)), "Unexpected private/development files in archive");

const temporary = await mkdtemp(join(tmpdir(), "whoasked-package-"));
try {
  const consumer = join(temporary, "consumer");
  const agentDir = join(temporary, "agent");
  await mkdir(consumer);
  await mkdir(agentDir);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // Host-provided peers are deliberately absent, just as in a Pi-managed install.
  execFileSync(npm, ["install", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--offline", archive], {
    cwd: consumer, stdio: "pipe",
  });
  const installed = join(consumer, "node_modules", ...manifest.name.split("/"));
  const packedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(packedManifest.name, "@moonhalf383/pi-whoasked");
  assert.equal(packedManifest.publishConfig.access, "public");
  assert.equal(packedManifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.deepEqual(packedManifest.pi.extensions, ["./src/index.ts"]);
  const loader = new DefaultResourceLoader({
    cwd: consumer, agentDir, settingsManager: SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [installed],
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings ?? [], []);
  assert.equal(result.extensions.length, 1);
  assert.ok(result.extensions[0].commands.has("whoasked"));
  assert.ok(result.extensions[0].flags.has("whoasked-config"));
  // Execute startup from the packed copy so runtime JSON assets and defaults are exercised.
  const startup = result.extensions[0].handlers.get("session_start");
  assert.equal(startup?.length, 1);
  const statuses = [];
  const notices = [];
  const configuration = join(temporary, "defaults.json");
  await writeFile(configuration, "{}\n");
  result.runtime.flagValues.set("whoasked-config", configuration);
  await startup[0]({ type: "session_start" }, {
    cwd: consumer, isProjectTrusted: () => false,
    ui: { setStatus: (_key, text) => statuses.push(text), notify: (text) => notices.push(text) },
  });
  assert.deepEqual(notices, []);
  assert.deepEqual(statuses, ["whoasked: on (17)"]);
  console.log(`Verified ${basename(archive)}: offline installation, Pi package discovery, and bilingual startup passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
