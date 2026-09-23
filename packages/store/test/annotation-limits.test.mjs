import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
register("./ts-resolve.mjs", import.meta.url);
const { MemoryStore, SqliteStore, SupabaseStore, demoFixtures } = await import("../src/index.ts");

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-annotation-limits-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("model-lab-annotation-limits-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

for (const backend of ["memory", "sqlite"]) {
  test(`${backend}: new annotation bounds preserve valid notes and recorded scores`, async (t) => {
    const root = temporary(t);
    const store = backend === "memory" ? new MemoryStore() : new SqliteStore(join(root, "test.db"));
    try {
      const fx = demoFixtures();
      await store.seedDemo(fx);
      const sample = fx.samples[0];
      const base = {
        runId: fx.run.id,
        endpointId: sample.endpointId,
        sampleIndex: sample.sampleIndex,
        note: "valid",
        scoreOverride: 8.5,
        author: "operator",
        at: "2026-09-22T00:00:00Z",
      };
      const originalSamples = await store.listSamples(fx.run.id);
      const before = await store.listAnnotations(fx.run.id);
      for (const note of ["x".repeat(4000), "雪".repeat(4000), "😀".repeat(2000), "a\0b"]) {
        await store.insertAnnotation({ ...base, note });
      }
      for (const change of [
        { note: "" },
        { note: "x".repeat(4001) },
        { note: "a\0" + "b".repeat(4000) },
        { author: "x".repeat(32769) },
        { at: "x".repeat(32769) },
      ]) {
        await assert.rejects(store.insertAnnotation({ ...base, ...change }), { code: "INVALID" });
      }
      assert.equal((await store.listAnnotations(fx.run.id)).length, before.length + 4);
      assert.deepEqual(await store.listSamples(fx.run.id), originalSamples);
      await store.insertAnnotation({ ...base, ignored: "x".repeat(100000) });
      assert.equal("ignored" in (await store.listAnnotations(fx.run.id)).at(-1), false);
    } finally {
      store.close?.();
    }
  });

  test(`${backend}: annotation capacity rejects appends without evicting history`, async (t) => {
    const root = temporary(t);
    const store = backend === "memory" ? new MemoryStore() : new SqliteStore(join(root, "test.db"));
    try {
      const fx = demoFixtures();
      await store.seedDemo(fx);
      const sample = fx.samples[0];
      const base = {
        runId: fx.run.id,
        endpointId: sample.endpointId,
        sampleIndex: sample.sampleIndex,
        note: "capacity fixture",
        scoreOverride: null,
        author: "operator",
        at: "2026-09-22T00:00:00Z",
      };
      const count = (await store.listAnnotations(fx.run.id)).length;
      for (let i = count; i < 1000; i++)
        await store.insertAnnotation({ ...base, note: `note ${i}` });
      const history = await store.listAnnotations(fx.run.id);
      await assert.rejects(store.insertAnnotation(base), { code: "LIMIT" });
      assert.deepEqual(await store.listAnnotations(fx.run.id), history);
      const other = "run_independent";
      await store.createRun({ ...fx.run, id: other }, fx.configuration);
      await store.upsertRunModel({
        ...fx.runModels.find((model) => model.endpointId === base.endpointId),
        runId: other,
      });
      await store.insertSample({ ...sample, runId: other });
      await store.insertAnnotation({ ...base, runId: other });
      assert.equal((await store.listAnnotations(other)).length, 1);
    } finally {
      store.close?.();
    }
  });
}

test("SQLite admits one concurrent final-slot annotation and preserves over-cap legacy history", async (t) => {
  const file = join(temporary(t), "race.db");
  const fx = demoFixtures();
  const sample = fx.samples[0];
  const base = {
    runId: fx.run.id,
    endpointId: sample.endpointId,
    sampleIndex: sample.sampleIndex,
    note: "race",
    scoreOverride: null,
    author: "operator",
    at: "2026-09-22T00:00:00Z",
  };
  const store = new SqliteStore(file);
  try {
    await store.seedDemo(fx);
    const raw = new DatabaseSync(file);
    try {
      const insert = raw.prepare(
        "insert into annotations(run_id,endpoint_id,sample_index,note,author,at) values(?,?,?,?,?,?)",
      );
      raw.exec("begin");
      for (let count = (await store.listAnnotations(fx.run.id)).length; count < 999; count++)
        insert.run(base.runId, base.endpointId, 1, "filler", "test", base.at);
      raw.exec("commit");
      assert.throws(
        () =>
          insert.run(base.runId, base.endpointId, 1, "a\0" + "x".repeat(32768), "test", base.at),
        /annotation_text_limit/,
      );
    } finally {
      raw.close();
    }
    const racers = Array.from({ length: 6 }, () => {
      const worker = new Worker(new URL("./annotation-race-worker.mjs", import.meta.url), {
        workerData: { file, annotation: base },
      });
      let ready;
      const prepared = new Promise((resolve) => {
        ready = resolve;
      });
      const result = new Promise((resolve, reject) => {
        worker.on("message", (message) => (message.ready ? ready() : resolve(message)));
        worker.on("error", (error) => {
          ready();
          reject(error);
        });
        worker.on("exit", (code) => {
          if (code !== 0) {
            ready();
            reject(new Error(`annotation worker exit ${code}`));
          }
        });
      });
      return { worker, prepared, result };
    });
    try {
      await Promise.all(racers.map((racer) => racer.prepared));
      for (const racer of racers) racer.worker.postMessage("insert");
      const results = await Promise.all(racers.map((racer) => racer.result));
      assert.equal(results.filter((value) => value.ok).length, 1);
      assert.equal(results.filter((value) => value.code === "LIMIT").length, 5);
      assert.equal((await store.listAnnotations(base.runId)).length, 1000);
    } finally {
      await Promise.all(racers.map((racer) => racer.worker.terminate()));
    }
  } finally {
    store.close();
  }
  const old = new DatabaseSync(file);
  old.exec("drop trigger annotations_resource_limits");
  old
    .prepare(
      "insert into annotations(run_id,endpoint_id,sample_index,note,author,at) values(?,?,?,?,?,?)",
    )
    .run(base.runId, base.endpointId, 1, "historical".repeat(5000), "test", base.at);
  old.close();
  const upgraded = new SqliteStore(file);
  try {
    const history = await upgraded.listAnnotations(base.runId);
    assert.equal(history.length, 1001);
    assert.equal(history.at(-1).note, "historical".repeat(5000));
    await assert.rejects(upgraded.insertAnnotation(base), { code: "LIMIT" });
    assert.deepEqual(await upgraded.listAnnotations(base.runId), history);
  } finally {
    upgraded.close();
  }
});

test("Supabase rejects invalid writes before transport and maps quota/size/serialization distinctly", async (t) => {
  const fetchBefore = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchBefore;
  });
  const base = {
    runId: "fixture",
    endpointId: "fixture/model",
    sampleIndex: 1,
    note: "ok",
    scoreOverride: null,
    author: "fixture",
    at: "2026-09-22T00:00:00Z",
  };
  let calls = 0;
  let responseCode = "ML002";
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /^https:\/\/fixture\.invalid\/rest\/v1\/annotations/);
    return Response.json(
      { code: responseCode, message: "synthetic database response" },
      { status: 400 },
    );
  };
  const store = new SupabaseStore({
    url: "https://fixture.invalid",
    serviceRoleKey: "synthetic-fixture",
  });
  await assert.rejects(store.insertAnnotation({ ...base, note: "x".repeat(4001) }), {
    code: "INVALID",
  });
  assert.equal(calls, 0);
  for (const [postgres, mapped] of [
    ["ML002", "LIMIT"],
    ["ML003", "INVALID"],
    ["23503", "NOT_FOUND"],
    ["40001", "BACKEND"],
  ]) {
    responseCode = postgres;
    await assert.rejects(store.insertAnnotation(base), { code: mapped });
  }
  assert.equal(calls, 4);
});
