/** Synthetic admission regressions: no network, credentials or Chromium. */
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
register("./ts-resolve.mjs", import.meta.url);
const { startRun } = await import("../src/run.ts");
const { FsRunStore } = await import("../src/store-fs.ts");
const { BuildArenaAdapter } = await import("../src/adapter.ts");
const { BudgetLedger, reserveCost, endpointPrices } = await import("../src/budget.ts");
const { runJudgePhase } = await import("../src/judge.ts");
const { AnthropicProvider } = await import("../src/providers/anthropic.ts");
const { OpenAiCompatibleProvider } = await import("../src/providers/openai-compatible.ts");
const sse = (events) =>
  events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");
const endpoint = (id) => ({
  id,
  model: id,
  modelId: id,
  providerId: "fixture",
  baseKind: "mock",
  priceInPerMtokUsd: 0,
  priceOutPerMtokUsd: 1000,
  supportsSeed: true,
});

function removeFixture(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(
    basename(root).startsWith("model-lab-budget-") ||
      basename(root).startsWith("model-lab-judge-budget-"),
  );
  rmSync(root, { recursive: true, force: true });
}

function configuration(overrides = {}) {
  return {
    runId: "run_fixture",
    name: "Admission fixture",
    mode: "verified",
    pack: {
      slug: "synthetic",
      version: "1",
      prompt: "x",
      browserCheckCount: 0,
      tasks: [{ id: "one", prompt: "x", scorer: "exact-match", expected: "ok" }],
    },
    endpoints: [endpoint("alpha")],
    samplesPerModel: 1,
    temperature: 0,
    maxOutputTokens: 8,
    seed: null,
    concurrency: 1,
    maxBudgetUsd: 1,
    transportRetries: 0,
    ...overrides,
  };
}

async function execute(cfg, generate) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-budget-"));
  try {
    let calls = 0;
    const providerFactory = () => ({
      kind: "mock",
      generate(req) {
        calls++;
        return generate(req, calls);
      },
    });
    const store = new FsRunStore(root);
    const handle = startRun(cfg, { store, providerFactory });
    const events = [];
    for await (const event of handle.events) events.push(event);
    return {
      outcome: await handle.done,
      events,
      calls,
      files: readdirSync(root, { recursive: true }).map(String),
    };
  } finally {
    removeFixture(root);
  }
}

async function* successful() {
  yield { type: "delta", text: "ok" };
  yield { type: "usage", tokensIn: 1, tokensOut: 1 };
}

test("first request exceeding the ceiling never calls the provider", async () => {
  const result = await execute(configuration({ maxBudgetUsd: 0.005 }), successful);
  assert.equal(result.calls, 0);
  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.spentUsd, 0);
  assert.ok(result.events.some((event) => event.type === "run.partial"));
});

test("concurrent endpoints cannot both spend the same allowance; admitted work is preserved", async () => {
  const result = await execute(
    configuration({
      endpoints: [endpoint("alpha"), endpoint("beta")],
      concurrency: 2,
      maxBudgetUsd: 0.012,
    }),
    async function* () {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield* successful();
    },
  );
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.samplesScored, 1);
  assert.equal(result.outcome.spentUsd, 0.001);
  assert.equal(result.outcome.status, "partial");
});

test("the final planned sample is also checked before admission", async () => {
  const cfg = configuration({ maxBudgetUsd: 0.009 });
  cfg.pack.tasks = Array.from({ length: 3 }, (_, index) => ({
    id: String(index),
    prompt: "x",
    scorer: "exact-match",
    expected: "ok",
  }));
  const result = await execute(cfg, successful);
  assert.equal(result.calls, 2);
  assert.equal(result.outcome.samplesScored, 2);
  assert.equal(result.outcome.status, "partial");
  assert.ok(result.outcome.spentUsd <= cfg.maxBudgetUsd);
});

test("failed transport calls retain billing uncertainty before retry admission", async () => {
  const result = await execute(
    configuration({ maxBudgetUsd: 0.015, transportRetries: 2 }),
    async function* () {
      yield { type: "usage", tokensIn: 0, tokensOut: 1 };
      throw new Error("synthetic disconnect");
    },
  );
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.spentUsd, 0.001);
  assert.ok(result.events.some((event) => event.payload.uncertainUsd === 0.007));
});

test("adapter HTTP adaptation reserves again before posting", async () => {
  const result = await execute(configuration({ maxBudgetUsd: 0.015 }), async function* (req) {
    req.beforeRetry();
    yield* successful();
  });
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.spentUsd, 0);
  assert.ok(result.events.some((event) => event.payload.uncertainUsd === 0.008));
});

test("provider usage above its reservation remains visible, including the final sample", async () => {
  const result = await execute(configuration({ maxBudgetUsd: 0.01 }), async function* () {
    yield { type: "delta", text: "ok" };
    yield { type: "usage", tokensIn: 1, tokensOut: 20 };
  });
  assert.equal(result.outcome.spentUsd, 0.02);
  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.samplesScored, 1);
  assert.ok(result.events.some((event) => /reported usage exceeded/.test(event.message)));
});

test("unknown cloud prices fail validation, while explicit zero/local prices remain usable", async () => {
  const cfg = configuration();
  cfg.endpoints[0] = {
    ...cfg.endpoints[0],
    baseKind: "openai-compatible",
    priceInPerMtokUsd: null,
  };
  assert.equal(new BuildArenaAdapter().validateConfiguration(cfg).ok, false);
  cfg.endpoints[0] = { ...cfg.endpoints[0], baseKind: "mock", priceOutPerMtokUsd: null };
  const result = await execute(cfg, successful);
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.spentUsd, 0);
  assert.equal(result.outcome.status, "completed");
});

test("conservative reserves use UTF-8 bytes, images, and current prompt size", () => {
  const prices = endpointPrices(endpoint("one"));
  const req = { prompt: "x", maxTokens: 8, model: "fixture", temperature: 0 };
  assert.equal(reserveCost(req, prices), 0.008);
  const inputOnly = { input: 1_000_000, output: 0 };
  assert.equal(reserveCost({ ...req, prompt: "é" }, inputOnly), 258);
  assert.ok(reserveCost({ ...req, images: [{ label: "capture" }] }, inputOnly) >= 4096);
  const ledger = new BudgetLedger(1);
  const held = ledger.reserve(0.8);
  assert.throws(() => ledger.reserve(0.3), /remaining/);
  ledger.settle(held, 0, false);
  assert.throws(() => ledger.reserve(0.3), /remaining/);
});

test("oversized generation fails before raw output persistence and is not retried", async () => {
  const result = await execute(configuration({ transportRetries: 2 }), async function* () {
    yield { type: "delta", text: "x".repeat(2 * 1024 * 1024 + 1) };
  });
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.samplesFailed, 1);
  assert.ok(result.events.some((event) => /output exceeds/.test(event.message)));
  assert.ok(
    !result.files.some((file) => file.endsWith(".txt")),
    "oversized raw answer was not persisted",
  );
});

async function judgeFixture({
  html = ["<html>small</html>"],
  budget = 1,
  captures = false,
  generate,
}) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-judge-budget-"));
  try {
    const cfg = configuration({
      mode: "build-arena",
      maxBudgetUsd: budget,
      endpoints: html.map((_, i) => endpoint(String(i))),
    });
    const imagePath = join(root, "capture.png");
    writeFileSync(imagePath, "synthetic image");
    const artifacts = html.map((source, i) => {
      const path = String(i) + ".html";
      writeFileSync(join(root, path), source);
      return {
        endpointId: String(i),
        sampleIndex: 1,
        path,
        filename: path,
        renderOk: false,
        screenshotPath: captures ? imagePath : null,
        checks: [],
        consoleLines: [],
      };
    });
    let spent = 0;
    let calls = 0;
    const events = [];
    const ledger = new BudgetLedger(budget);
    const result = await runJudgePhase({
      cfg,
      judge: { model: "fixture", priceInPerMtokUsd: 1, priceOutPerMtokUsd: 1 },
      artifacts,
      samples: [],
      artifactRoot: root,
      getSpentUsd: () => spent,
      addSpendUsd: (cost) => {
        spent += cost;
      },
      shouldStop: () => false,
      emit(type, data) {
        events.push({ type, ...data });
      },
      provider: {
        kind: "mock",
        generate(req) {
          calls++;
          return generate(req, calls);
        },
      },
      budget: ledger,
    });
    return { result, calls, events, spent, uncertainUsd: ledger.uncertainUsd };
  } finally {
    removeFixture(root);
  }
}

test("judge computes the next prompt's reserve instead of trusting a cheaper prior call", async () => {
  const result = await judgeFixture({
    html: ["small", "x".repeat(40_000)],
    budget: 0.02,
    generate: async function* () {
      yield { type: "delta", text: '{"score":4,"commentary":"fixture"}' };
      yield { type: "usage", tokensIn: 1, tokensOut: 1 };
    },
  });
  assert.equal(result.calls, 1);
  assert.equal(result.result.rubricScores.size, 1);
  assert.ok(result.events.some((event) => event.payload?.judgeSkipped));
});

test("judge JSON retry includes images in its fresh reserve", async () => {
  const result = await judgeFixture({
    captures: true,
    budget: 0.01,
    generate: async function* () {
      yield { type: "delta", text: "invalid" };
      yield { type: "usage", tokensIn: 6500, tokensOut: 1 };
    },
  });
  assert.equal(result.calls, 1);
  assert.ok(result.events.some((event) => event.payload?.judgeSkipped));
});

test("judge vision fallback must independently pass admission", async () => {
  const result = await judgeFixture({
    captures: true,
    budget: 0.007,
    generate: async function* () {
      yield { type: "usage", tokensIn: 6500, tokensOut: 1 };
      throw new Error("unsupported capture");
    },
  });
  assert.equal(result.calls, 1);
  assert.ok(result.events.some((event) => event.payload?.judgeSkipped));
});

test("judge safety failures do not become vision retries", async () => {
  const result = await judgeFixture({
    captures: true,
    generate: async function* () {
      yield { type: "delta", text: "x".repeat(65_537) };
    },
  });
  assert.equal(result.calls, 1);
  assert.equal(result.result.rubricScores.size, 0);
  assert.ok(result.events.some((event) => /output exceeds/.test(event.message)));
});

test("truncated Anthropic and OpenAI streams retain reserves before the next generation", async () => {
  const original = globalThis.fetch;
  try {
    for (const kind of ["anthropic", "openai"]) {
      const adapter =
        kind === "anthropic"
          ? new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture" })
          : new OpenAiCompatibleProvider({ baseUrl: "http://synthetic.invalid/v1", apiKey: null });
      for (const withOutputUsage of [false, true]) {
        const events =
          kind === "anthropic"
            ? [
                { type: "message_start", message: { usage: { input_tokens: 3 } } },
                {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "x".repeat(600) },
                },
                ...(withOutputUsage
                  ? [
                      {
                        type: "message_delta",
                        usage: { output_tokens: 1 },
                        delta: { stop_reason: "end_turn" },
                      },
                    ]
                  : []),
              ]
            : [
                { choices: [], usage: { prompt_tokens: 3 } },
                { choices: [{ delta: { content: "x".repeat(600) } }] },
                ...(withOutputUsage
                  ? [{ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }]
                  : []),
              ];
        globalThis.fetch = async () => new Response(sse(events));
        const cfg = configuration({ maxBudgetUsd: 0.01, transportRetries: 2 });
        cfg.pack.tasks.push({ id: "two", prompt: "x", scorer: "exact-match", expected: "ok" });
        const result = await execute(cfg, (req) => adapter.generate(req));
        assert.equal(result.calls, 1, kind + " does not reuse the incomplete call's budget");
        assert.equal(result.outcome.status, "partial");
        assert.equal(result.outcome.samplesScored, 0);
        assert.equal(result.outcome.samplesFailed, 1);
        assert.ok(result.events.some((event) => event.payload.uncertainUsd >= 0.007));
        assert.ok(
          result.events.some(
            (event) =>
              event.type === "token.usage" &&
              event.payload.complete === false &&
              event.payload.tokensIn === 3,
          ),
        );
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("complete adapter usage releases unused generation reserves normally", async () => {
  const original = globalThis.fetch;
  try {
    for (const kind of ["anthropic", "openai"]) {
      const adapter =
        kind === "anthropic"
          ? new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture" })
          : new OpenAiCompatibleProvider({ baseUrl: "http://synthetic.invalid/v1", apiKey: null });
      const events =
        kind === "anthropic"
          ? [
              { type: "message_start", message: { usage: { input_tokens: 3 } } },
              { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } },
              {
                type: "message_delta",
                usage: { output_tokens: 1 },
                delta: { stop_reason: "end_turn" },
              },
              { type: "message_stop" },
            ]
          : [
              { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
              { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
              "[DONE]",
            ];
      globalThis.fetch = async () => new Response(sse(events));
      const cfg = configuration({ maxBudgetUsd: 0.01 });
      cfg.pack.tasks.push({ id: "two", prompt: "x", scorer: "exact-match", expected: "ok" });
      const result = await execute(cfg, (req) => adapter.generate(req));
      assert.equal(result.calls, 2);
      assert.equal(result.outcome.status, "completed");
      assert.equal(result.outcome.spentUsd, 0.002);
      assert.ok(
        result.events
          .filter((event) => event.type === "budget.status")
          .every((event) => event.payload.uncertainUsd === 0),
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("an explicitly partial usage record cannot release a generation reservation on iterator EOF", async () => {
  const cfg = configuration({ maxBudgetUsd: 0.01 });
  cfg.pack.tasks.push({ id: "two", prompt: "x", scorer: "exact-match", expected: "ok" });
  const result = await execute(cfg, async function* () {
    yield { type: "delta", text: "ok" };
    yield {
      type: "usage",
      tokensIn: 3,
      tokensOut: 1,
      usageSource: "reported",
      usageComplete: false,
    };
  });
  assert.equal(result.calls, 1);
  assert.equal(result.outcome.status, "partial");
  assert.ok(result.events.some((event) => event.payload.uncertainUsd === 0.007));
});

test("truncated judge streams retain usage and uncertainty without vision fallback", async () => {
  const original = globalThis.fetch;
  const adapter = new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture" });
  try {
    globalThis.fetch = async () =>
      new Response(
        sse([
          { type: "message_start", message: { usage: { input_tokens: 3 } } },
          {
            type: "content_block_delta",
            delta: { type: "text_delta", text: '{"score":4,"commentary":"fixture"}' },
          },
        ]),
      );
    const result = await judgeFixture({ captures: true, generate: (req) => adapter.generate(req) });
    assert.equal(result.calls, 1);
    assert.equal(result.result.rubricScores.size, 0);
    assert.ok(result.uncertainUsd > 0);
    assert.equal(result.spent, 3 / 1_000_000);
    assert.ok(
      result.events.some(
        (event) => event.payload?.usageComplete === false && event.payload?.complete === false,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("judge settlement retains partial-usage reserves but releases complete ones", async () => {
  for (const usageComplete of [false, true]) {
    const result = await judgeFixture({
      generate: async function* () {
        yield { type: "delta", text: '{"score":4,"commentary":"fixture"}' };
        yield { type: "usage", tokensIn: 3, tokensOut: 1, usageSource: "reported", usageComplete };
      },
    });
    assert.equal(result.result.rubricScores.size, 1);
    assert.equal(result.uncertainUsd > 0, !usageComplete);
  }
});
