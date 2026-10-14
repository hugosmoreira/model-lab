import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL("../scripts/model-lab.ts", import.meta.url));
const tsconfig = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const tsx = pathToFileURL(require.resolve("tsx")).href;

const NETWORK_TRAP =
  "globalThis.fetch = () => { console.error('NETWORK_TRAP_REACHED'); process.exit(98); };\n";

function runCli(args, flag, trapSource = NETWORK_TRAP) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-cli-test-"));
  const app = join(root, "apps", "web");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(join(root, ".env"), `MODEL_LAB_MOCK_PROVIDERS=${flag}\n`);
  const trap = join(root, "trap.mjs");
  writeFileSync(trap, trapSource);
  const env = { ...process.env, TSX_TSCONFIG_PATH: tsconfig, MODEL_LAB_STORE: "memory" };
  for (const key of Object.keys(env)) {
    if (key.endsWith("_API_KEY")) delete env[key];
  }
  delete env.MODEL_LAB_MOCK_PROVIDERS;
  delete env.__NEXT_PROCESSED_ENV;
  try {
    return spawnSync(
      process.execPath,
      ["--import", tsx, "--import", pathToFileURL(trap).href, cli, ...args],
      {
        cwd: app,
        env,
        encoding: "utf8",
        timeout: 20_000,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("actual CLI --mock overrides dotenv and models --check makes zero provider requests", () => {
  const child = runCli(["models", "--check", "--mock"], "0");
  assert.equal(child.status, 0, child.stderr);
  assert.doesNotMatch(child.stderr, /NETWORK_TRAP_REACHED/);
  assert.match(child.stdout, /mock \(forced; no network\)/);
  assert.match(child.stdout, /ollama\s+mocked\s/);
});

test("actual CLI auto policy lists installed Ollama models and contacts nothing else without keys", () => {
  // Only the local Ollama model list may be read; any other request trips the trap.
  const ollamaOnly = [
    "globalThis.fetch = async (url) => {",
    "  if (String(url).endsWith('/api/tags'))",
    "    return Response.json({ models: [{ name: 'fixture-local:latest', details: {} }] });",
    "  console.error('NETWORK_TRAP_REACHED ' + url);",
    "  process.exit(98);",
    "};",
  ].join("\n");
  const child = runCli(["models"], "", ollamaOnly);
  assert.equal(child.status, 0, child.stderr);
  assert.doesNotMatch(child.stderr, /NETWORK_TRAP_REACHED/);
  assert.match(child.stdout, /ollama\/fixture-local\s[^\r\n]+real \(local server, keyless\)/);
  assert.match(child.stdout, /openai\s+OPENAI_API_KEY is not set/);
});

test("actual CLI rejects numeric suffixes, fractions, infinities and oversized names before execution", () => {
  for (const [flag, value, error] of [
    ["--samples", "1x", /--samples must/],
    ["--samples", "1.5", /--samples must/],
    ["--samples", "11", /--samples must/],
    ["--budget", "2usd", /--budget must/],
    ["--budget", "Infinity", /--budget must/],
    ["--name", "x".repeat(201), /name: must/],
  ]) {
    const child = runCli(
      ["run", "--pack", "fixture", "--models", "fixture", flag, value, "--mock"],
      "1",
    );
    assert.equal(child.status, 2, child.stderr);
    assert.match(child.stderr, error);
    assert.doesNotMatch(child.stderr, /NETWORK_TRAP_REACHED/);
  }
});
