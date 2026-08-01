import { TopBar } from "@/components/shell/TopBar";
import { LiveRunClient, type LiveRunSnapshot } from "@/components/live/LiveRunClient";
import type {
  ConsoleLineVM,
  LiveFailure,
  LiveModelMeta,
} from "@/components/live/LiveRunScreen";
import { endpointProviderLabel, fixtures, modelColor, modelIdOf } from "@/lib/data";
import { getRun as getRegisteredRun } from "@/lib/live/run-registry";
import type { Run } from "@model-lab/schemas";

/** Reads the in-memory run registry — must render per request. */
export const dynamic = "force-dynamic";

/**
 * Phase 1: the server resolves runId + endpoint ids + a static fixture
 * snapshot; the client screen (LiveRunClient) subscribes to the SSE feed and
 * renders the LIVE reduced state, falling back to the snapshot only when the
 * stream errors immediately. NOTE: the SSE endpoint replays the same fixture
 * script for ANY runId this phase, so freshly created runs stream the demo
 * timeline under their own id.
 */

/**
 * Live output excerpt per endpoint, derived from fixtures.samples:
 * the failed sample carries the endpoint's distinctive raw source (qwen's
 * render-failure file); every other endpoint falls back to its latest
 * sample's short generic excerpt.
 */
function excerptFor(endpointId: string): string {
  const own = fixtures.samples.filter((s) => s.endpointId === endpointId);
  const failed = own.find((s) => s.status === "failed" && s.rawExcerpt.length > 0);
  if (failed) return failed.rawExcerpt;
  const latest = own[own.length - 1];
  return latest?.rawExcerpt ?? "";
}

/** Meta lookup that tolerates endpoint ids outside the fixture catalog. */
function metaFor(endpointId: string): LiveModelMeta {
  try {
    return {
      modelId: modelIdOf(endpointId),
      providerLabel: endpointProviderLabel(endpointId),
      color: modelColor(endpointId),
      excerpt: excerptFor(endpointId),
    };
  } catch {
    return {
      modelId: endpointId,
      providerLabel: "",
      color: "var(--color-model-neutral)",
      excerpt: "",
    };
  }
}

/** The Phase 0 static snapshot — now the stream-error fallback. */
function buildFixtureSnapshot(): LiveRunSnapshot {
  const run = fixtures.runLive;
  const models = fixtures.getRunModels("live");
  const events = fixtures.liveEvents;

  // fixtures.samples records the full timeline (12 rows). At the live snapshot
  // three samples are still in flight — sonnet s3 (judge pass), gemini s3
  // (browser checks 7/12), qwen s3 (generating) — so done = 12 − 3 = 9.
  const LIVE_IN_FLIGHT_SAMPLES = 3;
  const samplesTotal = run.samplesPerModel * run.modelCount;
  const samplesDone = fixtures.samples.length - LIVE_IN_FLIGHT_SAMPLES;

  // "overall" = mean of per-model progress.
  const overallPct = Math.round(
    models.reduce((acc, m) => acc + m.progressPct, 0) / Math.max(1, models.length),
  );

  // Every model in the live snapshot is on its final sample.
  const liveSampleIndex = run.samplesPerModel;

  const failedSample = fixtures.samples.find((s) => s.status === "failed");
  const failure: LiveFailure | null = failedSample
    ? {
        endpointId: failedSample.endpointId,
        modelId: modelIdOf(failedSample.endpointId),
        sampleIndex: failedSample.sampleIndex,
        samplesPerModel: run.samplesPerModel,
      }
    : null;

  const consoleLines: ConsoleLineVM[] = events.map((e) => {
    const scope = e.endpointId ? modelIdOf(e.endpointId) : null;
    const detail = scope && !e.message.startsWith(scope) ? `${scope} · ${e.message}` : e.message;
    return { t: e.t, level: e.level, text: `${e.type.padEnd(16)} ${detail}` };
  });

  return {
    run,
    models,
    events,
    consoleLines,
    overallPct,
    samplesDone,
    samplesTotal,
    liveSampleIndex,
    failure,
  };
}

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const record = getRegisteredRun(runId);
  const endpointIds = record?.config.endpointIds ?? [...fixtures.RUN_ENDPOINT_IDS];
  const samplesPerModel = record?.config.samplesPerModel ?? fixtures.runConfiguration.samplesPerModel;

  /* Static shell: registered runs synthesize a Run from their config; unknown
     ids (deep links, the demo run) fall back to the fixture run under the
     requested id. */
  let baseRun: Run;
  if (record) {
    const pack = fixtures.benchmarkPacks.find((p) => p.slug === record.config.packSlug);
    baseRun = {
      ...fixtures.runLive,
      id: record.id,
      name: record.config.name ?? pack?.name ?? record.config.packSlug,
      mode: record.config.mode,
      status: "running",
      pack: { slug: record.config.packSlug, version: pack?.version ?? "v1" },
      samplesPerModel: record.config.samplesPerModel,
      modelCount: record.config.endpointIds.length,
      budgetCeilingUsd: fixtures.runConfiguration.maxBudgetUsd,
      costSpentUsd: 0,
      estCostRangeUsd: null,
      startedAt: record.createdAt,
      completedAt: null,
      elapsedSec: 0,
      verdict: null,
    };
  } else {
    baseRun = { ...fixtures.runLive, id: runId };
  }

  /* Meta for the run's endpoints ∪ the fixture replay's endpoints (the SSE
     script always streams the fixture four, whatever was registered). */
  const modelMeta: Record<string, LiveModelMeta> = {};
  for (const id of new Set([...endpointIds, ...fixtures.RUN_ENDPOINT_IDS])) {
    modelMeta[id] = metaFor(id);
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title={`Live Run — ${baseRun.name}`} />
      <LiveRunClient
        runId={runId}
        endpointIds={endpointIds}
        samplesPerModel={samplesPerModel}
        baseRun={baseRun}
        modelMeta={modelMeta}
        fallback={buildFixtureSnapshot()}
      />
    </div>
  );
}
