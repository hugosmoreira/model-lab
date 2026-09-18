import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

const storeUrl = new URL("../src/index.ts", import.meta.url).href;
const resolverUrl = new URL("./ts-resolve.mjs", import.meta.url).href;

/** Real simultaneous SQLite connections, not two promises on one JS thread. */
export async function checkSqliteEvaluationIntegrity(file, SqliteStore, demoFixtures) {
  const fx = demoFixtures();
  const store = new SqliteStore(file);
  try {
    await store.seedDemo(fx);
    const pending = fx.votes.find((vote) => !vote.final);
    assert.ok(pending, "demo provides an unfinished comparison");

    const racers = ["A", "B"].map((choice) => {
      const worker = new Worker(new URL("./vote-race-worker.mjs", import.meta.url), {
        workerData: {
          file,
          storeUrl,
          resolverUrl,
          vote: { ...pending, vote: choice, final: true, votedAt: new Date().toISOString() },
        },
      });
      let ready;
      let resolveResult;
      let rejectResult;
      const prepared = new Promise((resolve) => {
        ready = resolve;
      });
      const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      worker.on("message", (message) => {
        if (message.ready) ready();
        else resolveResult(message);
      });
      worker.on("error", (error) => {
        ready();
        rejectResult(error);
      });
      worker.on("exit", (code) => {
        if (code !== 0) {
          ready();
          rejectResult(new Error(`vote worker exited ${code}`));
        }
      });
      return { worker, prepared, result };
    });
    try {
      await Promise.all(racers.map((racer) => racer.prepared));
      for (const racer of racers) racer.worker.postMessage("vote");
      const results = await Promise.all(racers.map((racer) => racer.result));
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.filter((result) => result.code === "IMMUTABLE").length, 1);
      const winner = results.find((result) => result.ok);
      const persisted = (await store.listVotes(fx.run.id)).find(
        (vote) => vote.pairIndex === pending.pairIndex,
      );
      assert.equal(persisted.vote, winner.vote);
      assert.equal(persisted.final, true);
    } finally {
      await Promise.all(racers.map((racer) => racer.worker.terminate()));
    }
  } finally {
    store.close();
  }

  // Model an older database with an orphan correction. Installing the new
  // guards must preserve its audit history while rejecting another orphan.
  const old = new DatabaseSync(file);
  old.exec("drop trigger annotations_require_sample");
  old
    .prepare(
      "insert into annotations (run_id,endpoint_id,sample_index,note,score_override,author,at) values (?,?,?,?,?,?,?)",
    )
    .run(fx.run.id, "legacy/missing", 99, "historical orphan", 6, "legacy", "2026-01-01T00:00:00Z");
  old.close();
  const upgraded = new SqliteStore(file);
  try {
    const history = await upgraded.listAnnotations(fx.run.id);
    const orphan = history.find((annotation) => annotation.note === "historical orphan");
    assert.ok(orphan, "upgrade preserves historical annotations");
    await assert.rejects(upgraded.insertAnnotation({ ...orphan, note: "new orphan" }), {
      code: "NOT_FOUND",
    });
    assert.equal((await upgraded.listAnnotations(fx.run.id)).length, history.length);
  } finally {
    upgraded.close();
  }
}
