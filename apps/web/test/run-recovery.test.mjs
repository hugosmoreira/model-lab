import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

register("../../../runners/build-arena/test/ts-resolve.mjs", import.meta.url);
const { acquireRunLease, reconcileInterruptedRuns, ownerHasStopped, RUN_LEASE_STALE_MS } =
  await import("../lib/server/run-recovery.ts");
const { SqliteStore, demoFixtures } = await import("@model-lab/store");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "model-lab-recovery-test-"));
  let now = 1_800_000_000_000;
  const run = {
    id: "run_synthetic",
    status: "running",
    startedAt: new Date(now).toISOString(),
    costSpentUsd: 0.15,
  };
  const events = [];
  const evidence = { sample: "preserved-evidence" };
  const store = {
    async listRuns() {
      return [run];
    },
    async getRun() {
      return { run, configuration: {} };
    },
    async updateRunStatus(_id, patch) {
      Object.assign(run, patch);
      return run;
    },
    async appendEvent(event) {
      events.push(event);
      return { ...event, id: events.length };
    },
  };
  const options = {
    ownerRoot: root,
    now: () => now,
    pid: 101,
    hostname: "synthetic-host",
    processToken: "synthetic-process",
    processAlive: () => true,
  };
  return {
    root,
    store,
    options,
    run,
    events,
    evidence,
    age() {
      now += RUN_LEASE_STALE_MS + 1;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("recovery never interrupts a fresh owner or another live CLI process", async () => {
  const f = fixture();
  const lease = acquireRunLease(f.store, f.run.id, f.options);
  try {
    assert.deepEqual(
      (await reconcileInterruptedRuns(f.store, { ...f.options, pid: 202 })).recovered,
      [],
    );
    f.age();
    const result = await reconcileInterruptedRuns(f.store, { ...f.options, pid: 202 });
    assert.deepEqual(result.recovered, []);
    assert.equal(f.run.status, "running");
    assert.equal(f.events.length, 0);
    lease.refresh();
    assert.equal(
      JSON.parse(readFileSync(join(f.root, `${f.run.id}.json`))).heartbeatAt,
      f.options.now(),
    );
  } finally {
    lease.release();
    f.cleanup();
  }
});

test("dead owner becomes partial once, without replaying or changing stored evidence", async () => {
  const f = fixture();
  const lease = acquireRunLease(f.store, f.run.id, f.options);
  lease.stop();
  try {
    f.age();
    const observer = { ...f.options, pid: 202, processAlive: () => false };
    assert.deepEqual((await reconcileInterruptedRuns(f.store, observer)).recovered, [f.run.id]);
    assert.equal(f.run.status, "partial");
    assert.equal(f.run.verdict.label, "Interrupted");
    assert.equal(f.run.costSpentUsd, 0.15);
    assert.deepEqual(f.evidence, { sample: "preserved-evidence" });
    assert.equal(f.events[0].type, "run.partial");
    assert.equal(f.events[0].payload.replayed, false);
    await reconcileInterruptedRuns(f.store, observer);
    assert.equal(f.events.length, 1);
  } finally {
    f.cleanup();
  }
});

test("container PID reuse and a restored single-host volume identify the stopped owner", async () => {
  for (const replaced of [{ processToken: "new-process" }, { hostname: "replacement-container" }]) {
    const f = fixture();
    const lease = acquireRunLease(f.store, f.run.id, f.options);
    lease.stop();
    try {
      f.age();
      const result = await reconcileInterruptedRuns(f.store, { ...f.options, ...replaced });
      assert.deepEqual(result.recovered, [f.run.id]);
      assert.equal(f.run.status, "partial");
    } finally {
      f.cleanup();
    }
  }
});

test("unknown PID permissions and legacy rows are not treated as proof of a dead process", async () => {
  const f = fixture();
  try {
    const result = await reconcileInterruptedRuns(f.store, f.options);
    assert.equal(result.uncertain[0].runId, f.run.id);
    assert.equal(f.run.status, "running");
    const lease = acquireRunLease(f.store, f.run.id, f.options);
    lease.stop();
    f.age();
    const owner = JSON.parse(readFileSync(join(f.root, `${f.run.id}.json`)));
    assert.equal(
      ownerHasStopped(owner, { ...f.options, pid: 202, processAlive: () => null }),
      false,
    );
    assert.deepEqual(
      (
        await reconcileInterruptedRuns(f.store, {
          ...f.options,
          pid: 202,
          processAlive: () => null,
        })
      ).recovered,
      [],
    );
  } finally {
    f.cleanup();
  }
});

test("an old lease cannot overwrite or delete a replacement owner's record", () => {
  const f = fixture();
  const lease = acquireRunLease(f.store, f.run.id, f.options);
  try {
    const file = join(f.root, `${f.run.id}.json`);
    const replacement = { ...JSON.parse(readFileSync(file)), ownerToken: "replacement" };
    writeFileSync(file, JSON.stringify(replacement));
    lease.refresh();
    lease.release();
    assert.deepEqual(JSON.parse(readFileSync(file)), replacement);
  } finally {
    lease.stop();
    f.cleanup();
  }
});

test("two SQLite clients share ownership and persisted interrupted state without changing samples", async () => {
  const root = mkdtempSync(join(tmpdir(), "model-lab-recovery-sqlite-"));
  const database = join(root, "synthetic.db");
  const writer = new SqliteStore(database);
  const reader = new SqliteStore(database);
  const fixtures = demoFixtures();
  let now = 1_800_000_000_000;
  const options = {
    now: () => now,
    pid: 101,
    hostname: "synthetic-host",
    processToken: "writer-process",
    processAlive: () => true,
  };
  let lease;
  try {
    await writer.seedDemo(fixtures);
    await writer.updateRunStatus(fixtures.run.id, { status: "running", completedAt: null });
    const beforeSamples = await writer.listSamples(fixtures.run.id);
    lease = acquireRunLease(writer, fixtures.run.id, options);
    const observer = { ...options, pid: 202, processToken: "reader-process" };
    assert.deepEqual((await reconcileInterruptedRuns(reader, observer)).recovered, []);
    now += RUN_LEASE_STALE_MS + 1;
    assert.deepEqual((await reconcileInterruptedRuns(reader, observer)).recovered, []);
    lease.stop();
    const report = await reconcileInterruptedRuns(reader, {
      ...observer,
      processAlive: () => false,
    });
    assert.deepEqual(report.recovered, [fixtures.run.id]);
    assert.equal((await writer.getRun(fixtures.run.id)).run.status, "partial");
    assert.deepEqual(await writer.listSamples(fixtures.run.id), beforeSamples);
  } finally {
    lease?.stop();
    reader.close();
    writer.close();
    rmSync(root, { recursive: true, force: true });
  }
});
