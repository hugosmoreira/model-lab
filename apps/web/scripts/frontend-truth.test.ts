import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore, SqliteStore, demoFixtures, type RunStore } from "@model-lab/store";
import type { HumanAnnotation } from "@model-lab/schemas";
import { runManifest } from "@model-lab/schemas/fixtures";
import type { ShareCardContent, ShareCardRow } from "../components/share/ShareCard";
import { getRunView, listAllRuns } from "../lib/server/loaders";
import { buildAltText, buildCsv, buildJson, buildPostDraft } from "../lib/share/export-data";
import { modelScoreSource, scoreAxisLabel } from "../lib/score-presentation";
import { buildPairQueue } from "../lib/server/pairs";
import { GET as storeHealth } from "../app/api/health/store/route";

test("store-health errors remove every JWT segment and other credentials", async () => {
  const cacheKey = Symbol.for("model-lab.store.singleton");
  const state = globalThis as typeof globalThis & { [cacheKey]?: unknown };
  const previousCache = state[cacheKey];
  const previousBackend = process.env.MODEL_LAB_STORE;
  const store = new MemoryStore();
  const jwt = [
    Buffer.from('{ "alg":"HS256"}').toString("base64url"),
    Buffer.from('{ "fixture":"private-marker"}').toString("base64url"),
    "synthetic-signature",
  ].join(".");
  const secrets = [jwt, "AIza" + "x".repeat(35), "sb_secret_" + "x".repeat(30)];
  try {
    process.env.MODEL_LAB_STORE = "memory";
    state[cacheKey] = { backend: "memory", promise: Promise.resolve(store) };
    store.listRuns = async () => {
      throw new Error(`store unavailable ${secrets.join(" ")}\nprivate second line`);
    };
    const response = await storeHealth();
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.match(payload.error, /^store unavailable/);
    assert.ok(payload.error.length <= 200);
    assert.ok(!payload.error.includes("private second line"));
    for (const secret of secrets.flatMap((value) => value.split("."))) {
      assert.ok(!payload.error.includes(secret));
    }
  } finally {
    if (previousCache === undefined) delete state[cacheKey];
    else state[cacheKey] = previousCache;
    if (previousBackend === undefined) delete process.env.MODEL_LAB_STORE;
    else process.env.MODEL_LAB_STORE = previousBackend;
  }
});

test("reading a demo vote queue never inserts votes, including on read failure", async () => {
  const cacheKey = Symbol.for("model-lab.store.singleton");
  const state = globalThis as typeof globalThis & { [cacheKey]?: unknown };
  const previousCache = state[cacheKey];
  const before = { ...process.env };
  const root = mkdtempSync(join(tmpdir(), "model-lab-pair-read-"));
  process.env.MODEL_LAB_DATA_DIR = root;
  try {
    for (const store of [new MemoryStore(), new SqliteStore(":memory:")]) {
      try {
        process.env.MODEL_LAB_STORE = store instanceof SqliteStore ? "sqlite" : "memory";
        state[cacheKey] = { backend: process.env.MODEL_LAB_STORE, promise: Promise.resolve(store) };
        const fixture = demoFixtures();
        fixture.votes = [];
        await store.seedDemo(fixture);
        const view = await getRunView(fixture.run.id, store);
        const write = store.upsertVote.bind(store);
        let writes = 0;
        store.upsertVote = async () => {
          writes++;
          throw new Error("read attempted a write");
        };
        for (const readOnly of ["0", "1"]) {
          process.env.MODEL_LAB_READ_ONLY = readOnly;
          for (let repeat = 0; repeat < 2; repeat++) {
            const queue = await buildPairQueue(view);
            assert.equal(queue.currentIndex, 1);
            assert.equal(queue.stats.votesCast, 0);
            assert.deepEqual(await store.listVotes(fixture.run.id), []);
          }
        }
        const read = store.listVotes.bind(store);
        store.listVotes = async () => {
          throw new Error("vote reads unavailable");
        };
        await buildPairQueue(view);
        assert.equal(writes, 0);
        store.listVotes = read;
        store.upsertVote = write;
        await store.seedDemo(demoFixtures());
        const votes = await store.listVotes(fixture.run.id);
        const queue = await buildPairQueue(await getRunView(fixture.run.id, store));
        assert.equal(queue.currentIndex, 5);
        assert.equal(queue.stats.votesCast, 4);
        assert.deepEqual(await store.listVotes(fixture.run.id), votes);
      } finally {
        if (store instanceof SqliteStore) store.close();
      }
    }
  } finally {
    if (previousCache === undefined) delete state[cacheKey];
    else state[cacheKey] = previousCache;
    for (const key of ["MODEL_LAB_STORE", "MODEL_LAB_READ_ONLY", "MODEL_LAB_DATA_DIR"]) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing runs never render demo data, and empty stores remain empty", async () => {
  process.env.MODEL_LAB_STORE = "memory";
  const store = new MemoryStore();
  assert.deepEqual(await listAllRuns(store), []);
  for (const id of ["run_deadbeef", "run_8f3ac21e"]) {
    await assert.rejects(
      getRunView(id, store),
      (error: unknown) =>
        error instanceof Error &&
        "digest" in error &&
        error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  }
  await store.seedDemo(demoFixtures());
  const runs = await listAllRuns(store);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.source, "fixtures");
  await assert.rejects(getRunView("run_deadbeef", store));
});

test("store failures propagate rather than becoming demo data or empty results", async () => {
  const store = new MemoryStore();
  const failure = new Error("storage unavailable");
  store.getRun = async () => {
    throw failure;
  };
  store.listRuns = async () => {
    throw failure;
  };
  await assert.rejects(getRunView("run_8f3ac21e", store), (error) => error === failure);
  await assert.rejects(listAllRuns(store), (error) => error === failure);
  const seeded = new MemoryStore();
  await seeded.seedDemo(demoFixtures());
  seeded.listSamples = async () => {
    throw failure;
  };
  await assert.rejects(getRunView("run_8f3ac21e", seeded), (error) => error === failure);
});

test("one human annotation does not relabel other models or recorded sample scores", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "model-lab-ui-test-"));
  const previousRoot = process.env.MODEL_LAB_DATA_DIR;
  process.env.MODEL_LAB_DATA_DIR = dataRoot;
  try {
    const fixture = demoFixtures();
    fixture.run.id = "run_ui_truth";
    fixture.run.fingerprint = "ui-truth";
    fixture.runModels = fixture.runModels.map((model) => ({
      ...model,
      runId: fixture.run.id,
      visualSource: "browser",
    }));
    fixture.samples = fixture.samples.map((sample) => ({
      ...sample,
      runId: fixture.run.id,
      primaryScorer: "browser",
    }));
    fixture.artifacts = fixture.artifacts.map((artifact) => ({
      ...artifact,
      runId: fixture.run.id,
    }));
    fixture.events = fixture.events.map((event) => ({
      ...event,
      runId: fixture.run.id,
      message:
        event.type === "model.started" && event.endpointId === fixture.samples[0]?.endpointId
          ? "model · provider · mock"
          : event.message,
    }));
    fixture.votes = [];
    const store = new MemoryStore();
    await store.seedDemo(fixture);
    const first = fixture.samples[0]!;
    const annotation: HumanAnnotation = {
      runId: fixture.run.id,
      endpointId: first.endpointId,
      sampleIndex: first.sampleIndex,
      scoreOverride: 8.4,
      note: "reviewed",
      author: "test",
      at: "2026-09-18T00:00:00.000Z",
    };
    await store.insertAnnotation(annotation);
    // Simulate old persisted orphan records, which remain visible in the audit trail.
    const history = await store.listAnnotations(fixture.run.id);
    store.listAnnotations = async () => [
      ...history,
      { ...annotation, sampleIndex: 999, scoreOverride: 0 },
    ];
    const view = await getRunView(fixture.run.id, store as RunStore);
    assert.equal(view.source, "store");
    assert.deepEqual(view.mockedEndpointIds, [first.endpointId]);
    const rated = view.runModels.find((model) => model.endpointId === first.endpointId)!;
    assert.deepEqual(rated.visualScore, { value: 8.4, n: 1 });
    assert.equal(rated.visualSource, "human");
    assert.ok(
      view.runModels
        .filter((model) => model.endpointId !== first.endpointId)
        .every((model) => model.visualSource === "browser"),
    );
    assert.equal(view.samples[0]?.primaryScorer, "browser");
    assert.deepEqual(view.samples[0]?.score, first.score);
    assert.equal(view.annotations.length, 2);
    assert.equal(view.scoreAnnotations.length, 1);
    assert.equal(scoreAxisLabel(view.runModels.map(modelScoreSource)), "Score (sources vary)");
  } finally {
    if (previousRoot == null) delete process.env.MODEL_LAB_DATA_DIR;
    else process.env.MODEL_LAB_DATA_DIR = previousRoot;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("CSV, JSON, alt text and social copy retain mixed source, n, true zero and missing", () => {
  const base: ShareCardRow = {
    id: "browser-model",
    color: "#000",
    visual: "0.0",
    pct: 0,
    tests: "0/5",
    testsState: "warn",
    cost: "$0.20",
    visualValue: 0,
    scoreSource: "browser",
    visualN: 3,
    costUsd: 0.2,
    latencyMs: null,
    sampleCount: 3,
    failedSamples: 1,
    failureNote: "failed",
    mocked: true,
  };
  const rows: ShareCardRow[] = [
    base,
    {
      ...base,
      id: "human-model",
      visual: "8.4*",
      visualValue: 8.4,
      visualN: 1,
      scoreSource: "human",
    },
    {
      ...base,
      id: "missing-model",
      visual: "—",
      visualValue: null,
      visualN: null,
      scoreSource: "objective",
    },
  ];
  const content: ShareCardContent = {
    title: "Example",
    takeaway: "Inspect sources",
    date: "2026-09-18",
    methodology: "planned n=3/model",
    footnote: "Do not compare different sources",
    runLink: "run_ui_truth",
    showRepoLink: true,
  };
  const csv = buildCsv(rows);
  assert.match(csv, /score,score_source,score_n/);
  assert.match(csv, /browser-model,0\.0,browser,3/);
  assert.match(csv, /human-model,8\.4,human,1/);
  assert.match(csv, /missing-model,,objective,,/);
  assert.match(csv, /browser-model,0\.0,browser,3,0\/5,0\.20,,3,true/);
  const alt = buildAltText("Scorecard", rows, content);
  assert.match(alt, /Browser capability 0\.0 of 10, n=3/);
  assert.match(alt, /Human visual 8\.4 of 10, n=1/);
  assert.match(alt, /Objective accuracy not scored/);
  assert.match(alt, /synthetic mock output; simulated cost/);
  const post = buildPostDraft(rows, content);
  assert.match(post, /Objective accuracy not scored/);
  assert.match(post, /Do not compare different sources/);
  assert.match(post, /\[mock; simulated cost\]/);
  const json = JSON.parse(buildJson(runManifest, rows, content)) as { rows: ShareCardRow[] };
  assert.equal(json.rows[0]?.visualValue, 0);
  assert.equal(json.rows[2]?.visualValue, null);
  assert.equal(json.rows[1]?.scoreSource, "human");
  assert.equal(json.rows[0]?.mocked, true);
});
