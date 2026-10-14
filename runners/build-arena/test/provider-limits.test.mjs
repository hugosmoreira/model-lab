import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
register("./ts-resolve.mjs", import.meta.url);

const { readSse, readBoundedText, scrubSecrets, errorMessage } =
  await import("../src/providers/util.ts");
const { boundedGenerate, providerDeadlinesFor, ProviderSafetyError } =
  await import("../src/providers/limits.ts");
const { OpenAiCompatibleProvider } = await import("../src/providers/openai-compatible.ts");
const { AnthropicProvider } = await import("../src/providers/anthropic.ts");
const { createProvider } = await import("../src/providers/index.ts");
const encode = (value) => new TextEncoder().encode(value);
const collect = async (source) => {
  const values = [];
  for await (const value of source) values.push(value);
  return values;
};
const request = { prompt: "test", model: "fixture", maxTokens: 8, temperature: 0 };
const sse = (events) =>
  events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");

const syntheticSecrets = [
  "AIza" + "aB0_-".repeat(7),
  "sb_secret_" + "synthetic".repeat(5),
  [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from('{"fixture":"private-marker"}').toString("base64url"),
    "synthetic-signature",
  ].join("."),
  "sk-" + "synthetic".repeat(5),
  [
    Buffer.from('{ "alg":"HS256"}').toString("base64url"),
    Buffer.from('{ "role":"fixture"}').toString("base64url"),
    "synthetic-signature",
  ].join("."),
];

test("diagnostics redact complete credential shapes and preserve ordinary errors", () => {
  for (const secret of syntheticSecrets) {
    for (const text of [secret, `rejected '${secret}'`, `one ${secret} two ${secret}`]) {
      const scrubbed = scrubSecrets(text);
      assert.ok(!scrubbed.includes(secret));
      for (const segment of secret.split(".")) assert.ok(!scrubbed.includes(segment));
      assert.ok(!errorMessage(new Error(text)).includes(secret));
    }
  }
  assert.equal(scrubSecrets("HTTP 429: rate limit reached"), "HTTP 429: rate limit reached");
  assert.equal(scrubSecrets("v1.2.3 at module.test.ts"), "v1.2.3 at module.test.ts");
  assert.equal(scrubSecrets("x".repeat(256_000)), "x".repeat(256_000));
  assert.equal(scrubSecrets("Bearer synthetic.token-value"), "Bearer ***");
  assert.equal(scrubSecrets('api_key="synthetic-value"'), 'api_key="***"');
});

test("both adapters scrub HTTP and stream errors before diagnostic truncation", async () => {
  const original = globalThis.fetch;
  try {
    for (const adapter of [
      new OpenAiCompatibleProvider({ baseUrl: "http://synthetic.invalid", apiKey: null }),
      new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture" }),
    ]) {
      for (const secret of syntheticSecrets) {
        for (const status of [400, 401]) {
          globalThis.fetch = async () => new Response("x".repeat(292) + secret, { status });
          await assert.rejects(collect(adapter.generate(request)), (error) => {
            assert.ok(!error.message.includes(secret.slice(0, 8)), error.message);
            assert.match(error.message, /HTTP (400|401)/);
            return true;
          });
        }
        globalThis.fetch = async () =>
          new Response(sse([{ type: "error", error: { message: secret } }]));
        await assert.rejects(collect(adapter.generate(request)), (error) => {
          assert.ok(!error.message.includes(secret));
          assert.match(error.message, /stream error/);
          return true;
        });
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});

function body(parts, { stall = false, onCancel = () => {} } = {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < parts.length) controller.enqueue(encode(parts[index++]));
      else if (!stall) controller.close();
    },
    cancel() {
      onCancel();
    },
  });
}

test("SSE keeps fragmented UTF-8/CRLF multiline events within limits", async () => {
  const bytes = encode("event: message\r\ndata: café\r\ndata: two\r\n\r\ndata: end");
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(await collect(readSse(stream)), [
    { event: "message", data: "café\ntwo" },
    { event: null, data: "end" },
  ]);
});

test("SSE rejects unterminated lines and many data lines before retaining an oversized frame", async () => {
  for (const parts of [["data:", "x".repeat(100)], Array(12).fill("data: x\n")]) {
    let cancelled = false;
    await assert.rejects(
      collect(
        readSse(
          body(parts, {
            stall: true,
            onCancel() {
              cancelled = true;
            },
          }),
          { frameBytes: 32 },
        ),
      ),
      /frame exceeds/,
    );
    assert.ok(cancelled);
  }
});

test("SSE counts cumulative bytes even when every event/comment is small", async () => {
  await assert.rejects(
    collect(readSse(body(Array(20).fill(": hi\n\n")), { streamBytes: 50 })),
    /total byte limit/,
  );
});

test("SSE idle, total and caller cancellation interrupt pending reads", async () => {
  let cancelled = 0;
  await assert.rejects(
    collect(
      readSse(
        body([], {
          stall: true,
          onCancel() {
            cancelled++;
          },
        }),
        { idleMs: 15, totalMs: 200 },
      ),
    ),
    /idle deadline/,
  );
  let timer;
  const heartbeat = new ReadableStream({
    start(controller) {
      timer = setInterval(() => controller.enqueue(encode(": ping\n\n")), 5);
    },
    cancel() {
      clearInterval(timer);
      cancelled++;
    },
  });
  await assert.rejects(collect(readSse(heartbeat, { idleMs: 100, totalMs: 35 })), /total deadline/);
  const abort = new AbortController();
  const waiting = collect(
    readSse(
      body([], {
        stall: true,
        onCancel() {
          cancelled++;
        },
      }),
      { signal: abort.signal },
    ),
  );
  abort.abort();
  await assert.rejects(waiting, /cancelled/);
  assert.equal(cancelled, 3);
});

test("error body has a byte cap and cancels even when the upstream never ends", async () => {
  let cancelled = false;
  await assert.rejects(
    readBoundedText(
      body(["é".repeat(20)], {
        stall: true,
        onCancel() {
          cancelled = true;
        },
      }),
      { maxBytes: 16 },
    ),
    /byte limit/,
  );
  assert.ok(cancelled);
});

test("adapter DONE returns close the body instead of leaving transport open", async () => {
  const original = globalThis.fetch;
  let cancelled = 0;
  globalThis.fetch = async () =>
    new Response(
      body(["data: [DONE]\n\n"], {
        stall: true,
        onCancel() {
          cancelled++;
        },
      }),
    );
  try {
    const adapter = new OpenAiCompatibleProvider({
      baseUrl: "http://synthetic.invalid/v1",
      apiKey: null,
    });
    await collect(adapter.generate(request));
    assert.equal(cancelled, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("both adapters time out while waiting for headers and abort fetch", async () => {
  const original = globalThis.fetch;
  const signals = [];
  globalThis.fetch = async (_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  };
  try {
    const limits = { idleMs: 15, totalMs: 100 };
    for (const adapter of [
      new OpenAiCompatibleProvider({
        baseUrl: "http://synthetic.invalid/v1",
        apiKey: null,
        limits,
      }),
      new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture", limits }),
    ])
      await assert.rejects(collect(adapter.generate(request)), ProviderSafetyError);
    assert.ok(signals.every((signal) => signal.aborted));
  } finally {
    globalThis.fetch = original;
  }
});

test("HTTP adaptation needs fresh admission and oversized error bodies never trigger retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("use max_completion_tokens", { status: 400 });
  };
  const adapter = new OpenAiCompatibleProvider({
    baseUrl: "http://synthetic.invalid/v1",
    apiKey: null,
  });
  try {
    await assert.rejects(
      collect(
        adapter.generate({
          ...request,
          beforeRetry() {
            throw new Error("admission denied");
          },
        }),
      ),
      /admission denied/,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return new Response("x".repeat(20_000), { status: 400 });
    };
    await assert.rejects(collect(adapter.generate(request)), /byte limit/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("generation byte cap, usage validation and cancellation apply to custom adapters too", async () => {
  const oversized = {
    async *generate() {
      yield { type: "delta", text: "é".repeat(20) };
    },
  };
  await assert.rejects(collect(boundedGenerate(oversized, request, 16)), /output exceeds/);
  for (const invalid of [NaN, Infinity, -1]) {
    const provider = {
      async *generate() {
        yield { type: "usage", tokensIn: invalid, tokensOut: 1 };
      },
    };
    await assert.rejects(collect(boundedGenerate(provider, request, 16)), /invalid token usage/);
  }
  let signal;
  const stalled = {
    async *generate(req) {
      signal = req.signal;
      await new Promise(() => {});
      yield { type: "delta", text: "unreachable" };
    },
  };
  await assert.rejects(
    collect(boundedGenerate(stalled, request, 16, { idleMs: 15, totalMs: 100 })),
    /idle deadline/,
  );
  assert.ok(signal.aborted);
});

test("Anthropic rejects input-only and partial-usage EOF; only terminal output usage is complete", async () => {
  const original = globalThis.fetch;
  const adapter = new AnthropicProvider({ baseUrl: "http://synthetic.invalid", apiKey: "fixture" });
  const start = { type: "message_start", message: { usage: { input_tokens: 3 } } };
  const delta = {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "x".repeat(600) },
  };
  const usage = {
    type: "message_delta",
    usage: { output_tokens: 150 },
    delta: { stop_reason: "end_turn" },
  };
  const stop = { type: "message_stop" };
  try {
    for (const events of [
      [start, delta],
      [start, delta, usage],
      [start, delta, stop],
    ]) {
      globalThis.fetch = async () => new Response(sse(events));
      const chunks = [];
      await assert.rejects(
        (async () => {
          for await (const chunk of adapter.generate(request)) chunks.push(chunk);
        })(),
        /terminal output usage/,
      );
      assert.ok(
        chunks
          .filter((chunk) => chunk.type === "usage")
          .every((chunk) => chunk.usageComplete === false),
      );
    }
    globalThis.fetch = async () => new Response(sse([start, delta, usage, stop]));
    const chunks = await collect(adapter.generate(request));
    assert.deepEqual(
      {
        ...chunks.at(-1),
        finishReason: undefined,
        reasoningTokens: undefined,
        servedModel: undefined,
      },
      {
        type: "usage",
        tokensIn: 3,
        tokensOut: 150,
        usageSource: "reported",
        usageComplete: true,
        finishReason: undefined,
        reasoningTokens: undefined,
        servedModel: undefined,
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("OpenAI rejects unmarked EOF and never treats usage before later deltas as final", async () => {
  const original = globalThis.fetch;
  const adapter = new OpenAiCompatibleProvider({
    baseUrl: "http://synthetic.invalid/v1",
    apiKey: null,
  });
  const inputOnly = { choices: [], usage: { prompt_tokens: 3 } };
  const usage = { choices: [], usage: { prompt_tokens: 3, completion_tokens: 150 } };
  const delta = { choices: [{ delta: { content: "x".repeat(600) }, finish_reason: null }] };
  const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };
  try {
    for (const events of [
      [inputOnly, delta],
      [delta, usage],
    ]) {
      globalThis.fetch = async () => new Response(sse(events));
      await assert.rejects(collect(adapter.generate(request)), /terminal marker/);
    }
    for (const events of [
      [inputOnly, delta, stop, "[DONE]"],
      [usage, delta, stop, "[DONE]"],
    ]) {
      globalThis.fetch = async () => new Response(sse(events));
      const chunks = await collect(adapter.generate(request));
      assert.equal(chunks.at(-1).usageSource, "estimated");
      assert.equal(chunks.at(-1).usageComplete, false);
      assert.ok(chunks.at(-1).tokensOut >= 150);
    }
    for (const events of [
      [delta, stop, usage, "[DONE]"],
      [delta, stop, usage],
    ]) {
      globalThis.fetch = async () => new Response(sse(events));
      const chunks = await collect(adapter.generate(request));
      assert.equal(chunks.at(-1).usageSource, "reported");
      assert.equal(chunks.at(-1).usageComplete, true);
      assert.equal(chunks.at(-1).tokensOut, 150);
    }
  } finally {
    globalThis.fetch = original;
  }
});

const localEndpoint = {
  id: "ollama/fixture",
  providerId: "ollama",
  modelId: "fixture",
  baseKind: "ollama",
  model: "fixture",
  priceInPerMtokUsd: null,
  priceOutPerMtokUsd: null,
  supportsSeed: true,
  baseUrl: "http://synthetic.invalid/v1",
};
const cloudEndpoint = {
  ...localEndpoint,
  id: "openrouter/fixture",
  providerId: "openrouter",
  baseKind: "openai-compatible",
  priceInPerMtokUsd: 1,
  priceOutPerMtokUsd: 1,
};
/** Advances mocked timers in steps, letting stream reads settle between them. */
async function advance(timers, ms, step = 1_000) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    timers.tick(Math.min(step, ms - elapsed));
    await new Promise((resolve) => setImmediate(resolve));
  }
}
/** A wait on the mocked clock that the request's abort signal interrupts. */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
/**
 * Ollama's wire shape: no headers until the first token, then reasoning beside
 * empty content. firstEventAfterMs models a server that sends headers early.
 */
function ollamaFetch({
  headersAfterMs = 0,
  firstEventAfterMs = 0,
  reasoningGapMs = 0,
  reasoningEvents = 0,
}) {
  const events = [
    ...Array.from({ length: reasoningEvents }, (_, index) => [
      index === 0 ? firstEventAfterMs : reasoningGapMs,
      { choices: [{ delta: { content: "", reasoning: "thinking " } }] },
    ]),
    [0, { choices: [{ delta: { content: "<!DOCTYPE html><html></html>" } }] }],
    [0, { choices: [{ delta: {}, finish_reason: "stop" }] }],
    [0, { choices: [], usage: { prompt_tokens: 3, completion_tokens: 40 } }],
    [0, "[DONE]"],
  ];
  return async (_url, { signal }) => {
    await delay(headersAfterMs, signal);
    let index = 0;
    return new Response(
      new ReadableStream({
        async pull(controller) {
          const next = events[index++];
          if (next === undefined) return controller.close();
          if (next[0] > 0) await delay(next[0], signal);
          controller.enqueue(encode(sse([next[1]])));
        },
      }),
    );
  };
}
const generateFor = (endpoint) => {
  const limits = providerDeadlinesFor(endpoint, {});
  return collect(boundedGenerate(createProvider(endpoint, limits), request, 1024, limits));
};

test("local endpoints get a longer first-token window, bounded by the total deadline", () => {
  const cloud = providerDeadlinesFor(cloudEndpoint, { MODEL_LAB_LOCAL_FIRST_TOKEN_MS: "90000" });
  assert.deepEqual(cloud, { firstTokenMs: 30_000, idleMs: 30_000, totalMs: 180_000 });
  assert.deepEqual(providerDeadlinesFor(localEndpoint, {}), {
    firstTokenMs: 120_000,
    idleMs: 30_000,
    totalMs: 180_000,
  });
  const local = (value) =>
    providerDeadlinesFor(localEndpoint, { MODEL_LAB_LOCAL_FIRST_TOKEN_MS: value }).firstTokenMs;
  assert.equal(local("90000"), 90_000);
  assert.equal(local(" 5000 "), 5_000);
  assert.equal(local("999999999"), 180_000);
  for (const invalid of ["", "0", "-1", "1e5", "90s", "abc"]) assert.equal(local(invalid), 120_000);
});

test("a silent first 45 s passes for a local endpoint and times out for a cloud one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const silentThenAnswer = {
    async *generate(req) {
      await delay(45_000, req.signal);
      yield { type: "delta", text: "<html></html>" };
      yield { type: "usage", tokensIn: 1, tokensOut: 1 };
    },
  };
  const local = collect(
    boundedGenerate(silentThenAnswer, request, 1024, providerDeadlinesFor(localEndpoint, {})),
  );
  const cloud = assert.rejects(
    collect(
      boundedGenerate(silentThenAnswer, request, 1024, providerDeadlinesFor(cloudEndpoint, {})),
    ),
    (error) => error instanceof ProviderSafetyError && /first-token deadline/.test(error.message),
  );
  await advance(t.mock.timers, 45_000);
  assert.equal((await local)[0].text, "<html></html>");
  await cloud;
});

test("after the first token a local endpoint is back on the idle deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stallsAfterReasoning = {
    async *generate(req) {
      yield { type: "reasoning" };
      await delay(31_000, req.signal);
      yield { type: "delta", text: "late" };
    },
  };
  const stalled = assert.rejects(
    collect(
      boundedGenerate(stallsAfterReasoning, request, 1024, providerDeadlinesFor(localEndpoint, {})),
    ),
    /idle deadline/,
  );
  await advance(t.mock.timers, 31_000);
  await stalled;
});

test("Ollama adapter survives a 45 s cold start that a cloud endpoint may not", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.fetch;
  globalThis.fetch = ollamaFetch({ headersAfterMs: 45_000, reasoningEvents: 1 });
  try {
    const local = generateFor(localEndpoint);
    const cloud = assert.rejects(generateFor(cloudEndpoint), /first-token deadline/);
    await advance(t.mock.timers, 46_000);
    const chunks = await local;
    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ["reasoning", "delta", "usage", "usage"],
    );
    assert.equal(chunks.at(-1).usageComplete, true);
    await cloud;
  } finally {
    globalThis.fetch = original;
  }
});

test("headers sent before a silent prefill do not shorten the local first-token window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.fetch;
  globalThis.fetch = ollamaFetch({ firstEventAfterMs: 45_000, reasoningEvents: 1 });
  try {
    const local = generateFor(localEndpoint);
    const cloud = assert.rejects(generateFor(cloudEndpoint), /first-token deadline/);
    await advance(t.mock.timers, 46_000);
    assert.equal((await local).at(-1).usageComplete, true);
    await cloud;
  } finally {
    globalThis.fetch = original;
  }
});

test("streamed reasoning keeps a request alive past the idle deadline before any answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.fetch;
  // 40 s of reasoning in 10 s steps and no answer text until it ends (run_e4706263).
  globalThis.fetch = ollamaFetch({ headersAfterMs: 0, reasoningGapMs: 10_000, reasoningEvents: 5 });
  try {
    const runs = [generateFor(localEndpoint), generateFor(cloudEndpoint)];
    await advance(t.mock.timers, 41_000);
    for (const chunks of await Promise.all(runs)) {
      assert.equal(chunks.filter((chunk) => chunk.type === "reasoning").length, 5);
      assert.equal(
        chunks.find((chunk) => chunk.type === "delta").text.slice(0, 15),
        "<!DOCTYPE html>",
      );
      assert.ok(chunks.at(-1).reasoningTokens > 0);
    }
  } finally {
    globalThis.fetch = original;
  }
});
