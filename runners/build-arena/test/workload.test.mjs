/** Synthetic providers and isolated data roots; no app, dotenv or network. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
register("./ts-resolve.mjs", import.meta.url);
const { startRun } = await import("../src/run.ts");
const { FsRunStore } = await import("../src/store-fs.ts");
const { BuildArenaAdapter } = await import("../src/adapter.ts");
const { acquireRunAdmission, RunCapacityError, ADMISSION_STALE_MS } =
  await import("../src/run-admission.ts");
const { WorkloadLimitError } = await import("../src/workload.ts");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-workload-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("model-lab-workload-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const endpoint = (id) => ({
  id,
  model: id,
  modelId: id,
  providerId: "fixture",
  baseKind: "mock",
  priceInPerMtokUsd: 0,
  priceOutPerMtokUsd: 0,
  supportsSeed: true,
});
function config(overrides = {}) {
  return {
    runId: "run_fixture",
    name: "Fixture",
    mode: "verified",
    pack: {
      slug: "fixture",
      version: "1",
      prompt: "x",
      browserCheckCount: 0,
      tasks: [{ id: "one", prompt: "x", scorer: "exact-match", expected: "ok" }],
    },
    endpoints: [endpoint("one")],
    samplesPerModel: 1,
    temperature: 0,
    maxOutputTokens: 8,
    seed: null,
    concurrency: 1,
    maxBudgetUsd: 2001,
    transportRetries: 0,
    ...overrides,
  };
}
async function* success() {
  yield { type: "delta", text: "ok" };
  yield { type: "usage", tokensIn: 1, tokensOut: 1 };
}
const providerFactory = () => ({ kind: "mock", generate: success });
function count(root) {
  const db = new DatabaseSync(join(root, ".workload.sqlite"));
  try {
    return db.prepare("SELECT COUNT(*) AS n FROM active_runs").get().n;
  } finally {
    db.close();
  }
}

test("raw runner and adapter reject excessive and alternate inputs before side effects", (t) => {
  const root = fixture(t);
  const store = new FsRunStore(root);
  const invalid = [
    { name: "x".repeat(201) },
    { name: "  " },
    { endpoints: [] },
    { endpoints: [endpoint("one"), endpoint("one")] },
    { endpoints: Array.from({ length: 9 }, (_, i) => endpoint(String(i))) },
    ...[0, 11, 1.5, NaN, Infinity].map((samplesPerModel) => ({ samplesPerModel })),
    ...[0, 5, 1.5, Infinity].map((concurrency) => ({ concurrency })),
    ...[-1, 4, 0.5, Infinity].map((transportRetries) => ({ transportRetries })),
    ...[0, NaN, Infinity].map((maxBudgetUsd) => ({ maxBudgetUsd })),
    { pack: { ...config().pack, tasks: Array(81).fill(config().pack.tasks[0]) } },
    {
      endpoints: Array.from({ length: 8 }, (_, i) => endpoint(String(i))),
      pack: { ...config().pack, tasks: Array(11).fill(config().pack.tasks[0]) },
    },
  ];
  const adapter = new BuildArenaAdapter(store);
  for (const override of invalid) {
    const cfg = config(override);
    assert.throws(
      () => startRun(cfg, { store, providerFactory: () => assert.fail("provider was reached") }),
      WorkloadLimitError,
    );
    assert.equal(adapter.validateConfiguration(cfg).ok, false);
  }
  assert.deepEqual(readdirSync(root), []);
});

test("valid workload boundaries and explicit budget overrides still execute", async (t) => {
  const root = fixture(t);
  const store = new FsRunStore(root);
  const tasks = Array.from({ length: 10 }, (_, i) => ({
    ...config().pack.tasks[0],
    id: String(i),
  }));
  const handle = startRun(
    config({
      name: "x".repeat(200),
      endpoints: Array.from({ length: 8 }, (_, i) => endpoint(String(i))),
      pack: { ...config().pack, tasks },
      samplesPerModel: 10,
      concurrency: 4,
      transportRetries: 3,
    }),
    { store, providerFactory },
  );
  const outcome = await handle.done;
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.samplesScored, 80);
  assert.equal(outcome.spentUsd, 0);
  assert.equal(count(root), 0);
});

test("capacity survives cancellation until work settles; completed feeds and startup failures release it", async (t) => {
  const root = fixture(t);
  const store = new FsRunStore(root);
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const first = startRun(config({ runId: "run_first" }), {
    store,
    providerFactory: () => ({
      kind: "mock",
      async *generate() {
        entered();
        await gate;
        yield* success();
      },
    }),
  });
  await ready;
  const second = acquireRunAdmission(root);
  assert.throws(() => startRun(config(), { store, providerFactory }), RunCapacityError);
  first.cancel();
  // The bounded provider may acknowledge cancellation promptly; either way,
  // actual done settlement, not cancel(), owns release.
  assert.equal(count(root), 2);
  unblock();
  await first.done;
  assert.equal(count(root), 1);
  second.release();
  const broken = new FsRunStore(root);
  broken.createRun = () => {
    throw new Error("synthetic startup failure");
  };
  assert.throws(() => startRun(config(), { store: broken, providerFactory }), /synthetic startup/);
  assert.equal(count(root), 0);
  await startRun(config(), { store, providerFactory }).done;
  assert.equal(count(root), 0);
});

test("one failed worker cannot release capacity while its sibling is still executing", async (t) => {
  const root = fixture(t);
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const store = new FsRunStore(root);
  const write = store.writeArtifact.bind(store);
  let crashed;
  const crash = new Promise((resolve) => {
    crashed = resolve;
  });
  store.writeArtifact = (...args) => {
    if (args[1] === "broken") {
      crashed();
      throw new Error("synthetic disk failure");
    }
    return write(...args);
  };
  const handle = startRun(
    config({
      mode: "build-arena",
      endpoints: [endpoint("broken"), endpoint("slow")],
      concurrency: 2,
    }),
    {
      store,
      providerFactory: (ep) => ({
        kind: "mock",
        async *generate() {
          if (ep.id === "slow") await gate;
          yield { type: "delta", text: "<!doctype html><html></html>" };
          yield { type: "usage", tokensIn: 1, tokensOut: 1 };
        },
      }),
      checksRunner: async () => ({
        checks: [],
        consoleLines: [],
        screenshotSaved: false,
        degraded: false,
      }),
    },
  );
  let finished = false;
  void handle.done.then(() => {
    finished = true;
  });
  await crash;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(count(root), 1);
  unblock();
  assert.equal((await handle.done).status, "cancelled");
  assert.equal(count(root), 0);
});

test("reservations transfer once, reject root mismatches, and never release another owner", async (t) => {
  const root = fixture(t),
    other = fixture(t);
  const reservation = acquireRunAdmission(root);
  assert.throws(
    () =>
      startRun(config(), { store: new FsRunStore(other), admission: reservation, providerFactory }),
    /Invalid/,
  );
  assert.equal(count(root), 1);
  reservation.claim(root);
  assert.throws(
    () =>
      startRun(config(), { store: new FsRunStore(root), admission: reservation, providerFactory }),
    /consumed/,
  );
  assert.equal(count(root), 1);
  reservation.release();
  reservation.release();
  assert.equal(count(root), 0);
});

function contender(root) {
  const code = `import { register } from 'node:module';
    register(${JSON.stringify(new URL("./ts-resolve.mjs", import.meta.url).href)}, import.meta.url);
    const { acquireRunAdmission } = await import(${JSON.stringify(new URL("../src/run-admission.ts", import.meta.url).href)});
    let permit;
    try { permit = acquireRunAdmission(${JSON.stringify(root)}); console.log('acquired'); }
    catch (e) { if (e.name !== 'RunCapacityError') throw e; console.log('blocked'); }
    process.stdin.once('data', () => { permit?.release(); process.exit(0); });`;
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      code,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP },
    },
  );
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data;
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.once("data", (data) => resolve(data.toString().trim()));
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`child exited before admission: ${code} ${errors}`)),
    );
  });
  return { child, ready };
}

test(
  "transient permit cleanup failure preserves the run outcome and retries automatically",
  { timeout: 15000 },
  async (t) => {
    const root = fixture(t);
    let blocker;
    const handle = startRun(config(), {
      store: new FsRunStore(root),
      providerFactory: () => ({
        kind: "mock",
        async *generate() {
          blocker = new DatabaseSync(join(root, ".workload.sqlite"));
          blocker.exec("BEGIN IMMEDIATE");
          yield* success();
        },
      }),
    });
    try {
      const outcome = await handle.done;
      assert.equal(outcome.status, "completed");
      assert.equal(count(root), 1, "failed deletion retains ownership until cleanup succeeds");
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(
      count(root),
      0,
      "the retry must release a finished run without restarting its owner",
    );
  },
);

test(
  "six competing processes share two slots; a separate root is independent",
  { timeout: 20000 },
  async (t) => {
    const root = fixture(t),
      other = fixture(t);
    const children = Array.from({ length: 6 }, () => contender(root));
    try {
      const results = await Promise.all(children.map((c) => c.ready));
      assert.equal(results.filter((r) => r === "acquired").length, 2);
      assert.equal(results.filter((r) => r === "blocked").length, 4);
      const separate = acquireRunAdmission(other);
      separate.release();
      await Promise.all(
        children.map(async ({ child }) => {
          const exit = once(child, "exit");
          child.stdin.write("release\n");
          await exit;
        }),
      );
      assert.equal(count(root), 0);
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill();
    }
  },
);

test(
  "crashed fresh owners stay reserved; stale dead owners are reclaimed transactionally",
  { timeout: 20000 },
  async (t) => {
    const root = fixture(t);
    const dead = contender(root);
    assert.equal(await dead.ready, "acquired");
    const exit = once(dead.child, "exit");
    dead.child.kill();
    await exit;
    const live = acquireRunAdmission(root);
    assert.throws(() => acquireRunAdmission(root), RunCapacityError);
    const db = new DatabaseSync(join(root, ".workload.sqlite"));
    db.prepare("UPDATE active_runs SET heartbeat = ?").run(Date.now() - ADMISSION_STALE_MS - 1000);
    db.close();
    // All competitors race over the same stale record. The old live PID, despite
    // its equally stale heartbeat, must still consume the second slot.
    const children = Array.from({ length: 4 }, () => contender(root));
    try {
      const results = await Promise.all(children.map((c) => c.ready));
      assert.equal(results.filter((r) => r === "acquired").length, 1);
      await Promise.all(
        children.map(async ({ child }) => {
          const exit = once(child, "exit");
          child.stdin.write("release\n");
          await exit;
        }),
      );
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill();
      live.release();
    }
    assert.equal(count(root), 0);
  },
);
