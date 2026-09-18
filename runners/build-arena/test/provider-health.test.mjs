import { register } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

register("./ts-resolve.mjs", import.meta.url);
const { checkProvidersHealth, checkProviderHealth } = await import("../src/providers/health.ts");

test("forced mock health blocks every provider probe, including keyless Ollama", async () => {
  const before = { ...process.env };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("network must never be reached in forced mock mode");
  };
  try {
    process.env.MODEL_LAB_MOCK_PROVIDERS = " 1 ";
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "GOOGLE_API_KEY",
      "DEEPSEEK_API_KEY",
    ]) {
      process.env[key] = "synthetic-test-credential";
    }
    const ids = ["anthropic", "openai", "openrouter", "google", "deepseek", "ollama"];
    const results = await checkProvidersHealth(ids);
    assert.equal(results.length, ids.length);
    for (const result of results) {
      assert.equal(result.status, "mocked", result.providerId);
      assert.equal(result.latencyMs, null);
      assert.equal(result.modelsAvailable, null);
      assert.match(result.detail, /network probes are disabled/);
    }
    assert.equal(requests, 0);
    assert.equal((await checkProviderHealth("baseline")).status, "unsupported");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
});

test("auto health probes Ollama without a key and skips cloud providers missing keys", async () => {
  const before = { ...process.env };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ models: [{ name: "synthetic-local-model" }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    delete process.env.MODEL_LAB_MOCK_PROVIDERS;
    delete process.env.OPENAI_API_KEY;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11499/v1/";
    const results = await checkProvidersHealth(["ollama", "openai"]);
    assert.equal(results[0].status, "connected");
    assert.equal(results[0].modelsAvailable, 1);
    assert.equal(results[1].status, "no-key");
    assert.deepEqual(requests, ["http://127.0.0.1:11499/api/tags"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
});
