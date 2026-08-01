/**
 * Backend-agnostic conformance suite: every RunStore implementation
 * (memory, sqlite, supabase) must pass the same create → append → list
 * round-trip. Intended for tests against scratch stores — it seeds the demo
 * scenario (for registry rows / FK integrity) and writes one throwaway run
 * with a unique id, so re-runs against persistent backends stay green.
 *
 * Throws Error on the first failed expectation; resolves with the number of
 * assertions that passed.
 */
import type { Run, RunEvent, SampleResult } from "@model-lab/schemas";
import { demoFixtures } from "./demo";
import { StoreError, type RunStore } from "./types";

const ENDPOINT = "anthropic/claude-sonnet-4-6";

export async function runStoreConformance(store: RunStore): Promise<number> {
  let passed = 0;
  const ok = (cond: boolean, label: string): void => {
    if (!cond) throw new Error(`store conformance failed: ${label}`);
    passed += 1;
  };
  const throws = async (
    fn: () => Promise<unknown>,
    code: StoreError["code"],
    label: string,
  ): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      ok(err instanceof StoreError && err.code === code, `${label} (got ${String(err)})`);
      return;
    }
    throw new Error(`store conformance failed: ${label} — expected StoreError(${code})`);
  };

  // -- seed + demo reads ----------------------------------------------------
  const fx = demoFixtures();
  await store.seedDemo(fx);
  await store.seedDemo(demoFixtures()); // idempotent reseed

  const demo = await store.getRun(fx.run.id);
  ok(demo !== null, "getRun(demo) returns the seeded run");
  ok(demo?.run.status === "completed", "demo run is the COMPLETED timeline");
  ok(
    demo?.configuration.samplesPerModel === fx.configuration.samplesPerModel,
    "configuration snapshot round-trips",
  );
  ok((await store.listRunModels(fx.run.id)).length === fx.runModels.length, "demo run models");
  ok((await store.listSamples(fx.run.id)).length === fx.samples.length, "demo samples");
  ok((await store.listArtifacts(fx.run.id)).length === fx.artifacts.length, "demo artifacts");
  ok((await store.listEvents(fx.run.id)).length === fx.events.length, "demo events");
  ok((await store.listVotes(fx.run.id)).length === (fx.votes ?? []).length, "demo votes");
  ok((await store.listProviders()).length >= fx.providers.length, "providers seeded");
  ok(
    (await store.listModelDefinitions()).length >= fx.modelDefinitions.length,
    "model definitions seeded",
  );
  ok(
    (await store.listEndpoints()).some((e) => e.id === ENDPOINT),
    "endpoints seeded",
  );
  ok((await store.listPacks()).length >= fx.packs.length, "packs seeded");

  // -- create → append → list round-trip ------------------------------------
  const runId = `run_conf_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const run: Run = {
    ...fx.run,
    id: runId,
    name: "conformance round-trip",
    status: "queued",
    costSpentUsd: 0,
    completedAt: null,
    elapsedSec: null,
    verdict: null,
  };
  await store.createRun(run, fx.configuration);
  await throws(
    () => store.createRun(run, fx.configuration),
    "DUPLICATE",
    "duplicate createRun rejected",
  );
  ok((await store.listRuns()).some((r) => r.id === runId), "listRuns includes new run");

  const updated = await store.updateRunStatus(runId, {
    status: "running",
    costSpentUsd: 0.05,
  });
  ok(updated.status === "running" && updated.costSpentUsd === 0.05, "updateRunStatus patch");
  ok(updated.name === run.name, "updateRunStatus leaves other fields untouched");

  await store.upsertRunModel({
    runId, endpointId: ENDPOINT, status: "generating", failedSampleCount: 0,
    progressPct: 10, currentTask: "sample 1/1", tokensOut: 0, ttftMs: null,
    totalLatencyMs: null, costUsd: 0, visualScore: null, testsPassed: null,
    testsTotal: null, retries: 0, unseeded: false, flag: null,
  });
  await store.upsertRunModel({
    runId, endpointId: ENDPOINT, status: "completed", failedSampleCount: 0,
    progressPct: 100, currentTask: null, tokensOut: 1200, ttftMs: 500,
    totalLatencyMs: 9000, costUsd: 0.05, visualScore: { value: 8, n: 1 },
    testsPassed: 12, testsTotal: 12, retries: 0, unseeded: false, flag: null,
  });
  const runModels = await store.listRunModels(runId);
  ok(runModels.length === 1, "upsertRunModel upserts (no duplicate row)");
  ok(runModels[0]?.status === "completed", "upsertRunModel keeps latest state");

  const sample: SampleResult = {
    runId, endpointId: ENDPOINT, sampleIndex: 1, globalIndex: 1,
    status: "generating", score: null, primaryScorer: null, costUsd: 0,
    latencyMs: null, ttftMs: null, seed: 42, hasArtifact: false,
    tokensOut: null, rawExcerpt: "", scorerTrace: [], judgeReversed: false,
    humanReviewed: false, humanNote: null,
  };
  await store.insertSample(sample); // in-flight snapshot
  await store.insertSample({
    ...sample, status: "scored", score: { value: 8 }, primaryScorer: "browser",
    costUsd: 0.05, latencyMs: 9000, ttftMs: 500, hasArtifact: true,
    tokensOut: 1200, rawExcerpt: "<!DOCTYPE html>",
  });
  await throws(
    () => store.insertSample({ ...sample, status: "scored", score: { value: 10 } }),
    "IMMUTABLE",
    "re-insert of a scored sample rejected",
  );
  const samples = await store.listSamples(runId);
  ok(samples.length === 1, "one sample row per key");
  const score = samples[0]?.score;
  ok(score !== null && score !== undefined && "value" in score && score.value === 8, "scored value round-trips");

  await store.insertArtifact({
    runId, endpointId: ENDPOINT, sampleIndex: 1,
    path: `artifacts/conf/${runId}.html`, filename: "index.html", sizeKb: 2,
    renderOk: true, isBestOfModel: true, source: "<!DOCTYPE html><html></html>",
    screenshotRef: null, consoleLines: [], checks: [], judgeCommentary: null,
    sandbox: { isolatedOrigin: true, networkBlocked: true, execLimitSec: 30, sizeLimitMb: 2 },
  });
  await throws(
    () =>
      store.insertArtifact({
        runId, endpointId: ENDPOINT, sampleIndex: 1,
        path: "artifacts/conf/dupe.html", filename: "dupe.html", sizeKb: 1,
        renderOk: false, isBestOfModel: false, source: "",
        screenshotRef: null, consoleLines: [], checks: [], judgeCommentary: null,
        sandbox: { isolatedOrigin: true, networkBlocked: true, execLimitSec: 30, sizeLimitMb: 2 },
      }),
    "DUPLICATE",
    "duplicate artifact rejected",
  );
  ok((await store.listArtifacts(runId)).length === 1, "artifact listed");

  const mkEvent = (message: string): RunEvent => ({
    t: new Date().toISOString(), type: "run.started", runId, endpointId: null,
    sampleIndex: null, level: "info", message, payload: {},
  });
  const e1 = await store.appendEvent(mkEvent("one"));
  const e2 = await store.appendEvent(mkEvent("two"));
  const e3 = await store.appendEvent(mkEvent("three"));
  ok(e1.id < e2.id && e2.id < e3.id, "event ids are monotonic");
  ok((await store.listEvents(runId)).length === 3, "listEvents returns all events");
  const tail = await store.listEvents(runId, e1.id);
  ok(tail.length === 2 && tail[0]?.message === "two", "listEvents(afterId) tails correctly");

  await store.insertAnnotation({
    runId, endpointId: ENDPOINT, sampleIndex: 1,
    note: "conformance annotation", scoreOverride: 7.5, author: "conformance",
    at: new Date().toISOString(),
  });
  const annotations = await store.listAnnotations(runId);
  ok(annotations.length === 1 && annotations[0]?.note === "conformance annotation", "annotation appended");

  await store.upsertVote({
    runId, pairIndex: 1, pairTotal: 1, pairing: [ENDPOINT, "openai/gpt-5.2-mini"],
    criterion: "conformance", orderSwapped: false, vote: null,
    confidence: "med", votedAt: null, final: false,
  });
  await store.upsertVote({
    runId, pairIndex: 1, pairTotal: 1, pairing: [ENDPOINT, "openai/gpt-5.2-mini"],
    criterion: "conformance", orderSwapped: false, vote: "A",
    confidence: "high", votedAt: new Date().toISOString(), final: true,
  });
  const votes = await store.listVotes(runId);
  ok(votes.length === 1 && votes[0]?.vote === "A" && votes[0]?.final === true, "vote upserted");

  ok((await store.getRun("run_does_not_exist")) === null, "getRun(unknown) is null");

  return passed;
}
