/** Actual route calls, injected synthetic store, no application/env loading. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { MemoryStore, demoFixtures, type RunStore } from "@model-lab/store";
import { POST as createRun } from "../app/api/runs/route";
import { POST as annotate } from "../app/api/runs/[runId]/annotations/route";
import { POST as vote } from "../app/api/runs/[runId]/votes/route";

const parameters = { params: Promise.resolve({ runId: "run_8f3ac21e" }) };
const routes = [
  createRun,
  (req: NextRequest) => annotate(req, parameters),
  (req: NextRequest) => vote(req, parameters),
];

function install(t: { after(fn: () => void): void }, store: RunStore) {
  const key = Symbol.for("model-lab.store.singleton");
  const state = globalThis as typeof globalThis & { [key]?: unknown };
  const previous = state[key];
  const before = { ...process.env };
  const fetchBefore = globalThis.fetch;
  state[key] = { backend: "memory", promise: Promise.resolve(store) };
  process.env.MODEL_LAB_STORE = "memory";
  process.env.MODEL_LAB_READ_ONLY = "0";
  process.env.MODEL_LAB_APP_ORIGIN = "http://localhost";
  process.env.MODEL_LAB_MOCK_PROVIDERS = "1";
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request in route fixture");
  };
  t.after(() => {
    if (previous === undefined) delete state[key];
    else state[key] = previous;
    process.env = before;
    globalThis.fetch = fetchBefore;
  });
}

function request(body: string | ReadableStream<Uint8Array>, headers = {}) {
  return new NextRequest("http://localhost/api/runs", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", ...headers },
    body,
  });
}

test("all mutation routes bound bytes before store access and keep existing guards first", async (t) => {
  let calls = 0;
  const store = new Proxy(new MemoryStore(), {
    get(_target, key) {
      if (key === "then") return undefined;
      calls++;
      throw new Error("Rejected body reached the store");
    },
  });
  install(t, store);
  for (const route of routes) {
    for (const headers of [{}, { "content-length": "1" }]) {
      const res = await route(request(JSON.stringify({ ignored: "x".repeat(66000) }), headers));
      assert.equal(res.status, 413);
    }
    assert.equal((await route(request("{}", { "content-encoding": "gzip" }))).status, 415);
    assert.equal((await route(request("{"))).status, 400);
    let reads = 0;
    const stream = () =>
      new ReadableStream<Uint8Array>(
        {
          pull() {
            reads++;
          },
        },
        { highWaterMark: 0 },
      );
    assert.equal(
      (await route(request(stream(), { origin: "https://foreign.invalid" }))).status,
      403,
    );
    process.env.MODEL_LAB_READ_ONLY = "1";
    assert.equal((await route(request(stream()))).status, 403);
    process.env.MODEL_LAB_READ_ONLY = "0";
    assert.equal(reads, 0);
  }
  assert.equal(calls, 0);
});

test("annotation API accepts escaped maximum notes, retains scores and returns an actionable quota error", async (t) => {
  const store = new MemoryStore();
  const fx = demoFixtures();
  await store.seedDemo(fx);
  install(t, store);
  const sample = fx.samples[0]!;
  const body = {
    endpointId: sample.endpointId,
    sampleIndex: sample.sampleIndex,
    note: "ok",
    scoreOverride: 7.5,
  };
  const originalSamples = await store.listSamples(fx.run.id);
  const encoded = JSON.stringify(body).replace('"ok"', '"' + "\\u96ea".repeat(4000) + '"');
  const response = await annotate(request(encoded), parameters);
  assert.equal(response.status, 201, await response.text());
  assert.equal((await store.listAnnotations(fx.run.id)).at(-1)?.note, "雪".repeat(4000));
  assert.equal(
    (await annotate(request(JSON.stringify({ ...body, note: "x".repeat(4001) })), parameters))
      .status,
    400,
  );
  for (let count = (await store.listAnnotations(fx.run.id)).length; count < 1000; count++) {
    await store.insertAnnotation({
      ...body,
      runId: fx.run.id,
      author: "fixture",
      at: "2026-09-22T00:00:00Z",
    });
  }
  const full = await annotate(request(JSON.stringify(body)), parameters);
  assert.equal(full.status, 409);
  assert.match((await full.json()).error, /1,000-annotation limit.*preserved/);
  assert.equal((await store.listAnnotations(fx.run.id)).length, 1000);
  assert.deepEqual(await store.listSamples(fx.run.id), originalSamples);
  const pending = fx.votes!.find((value) => !value.final)!;
  const cast = await vote(
    request(JSON.stringify({ pairIndex: pending.pairIndex, vote: "A" })),
    parameters,
  );
  assert.equal(cast.status, 201, await cast.text());
  assert.equal(
    (await vote(request(JSON.stringify({ pairIndex: pending.pairIndex, vote: "B" })), parameters))
      .status,
    409,
  );
});
