import { TopBar } from "@/components/shell/TopBar";
import {
  LiveRunScreen,
  type ConsoleLineVM,
  type LiveFailure,
  type LiveModelMeta,
} from "@/components/live/LiveRunScreen";
import { endpointProviderLabel, fixtures, modelColor, modelIdOf } from "@/lib/data";

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

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  // Phase 0: the only run in the fixture set is run_8f3ac21e's live snapshot.
  // Phase 1 swaps these loads for the streaming store keyed by `runId`.
  const run = fixtures.runLive;
  const models = fixtures.getRunModels("live");
  const events = fixtures.liveEvents;

  // fixtures.samples records the full timeline (12 rows). At the live snapshot
  // three samples are still in flight — sonnet s3 (judge pass), gemini s3
  // (browser checks 7/12), qwen s3 (generating) — so done = 12 − 3 = 9.
  const LIVE_IN_FLIGHT_SAMPLES = 3;
  const samplesTotal = run.samplesPerModel * run.modelCount;
  const samplesDone = fixtures.samples.length - LIVE_IN_FLIGHT_SAMPLES;

  // "overall" = mean of per-model progress (the prototype's 78% ≠ 9/12 samples;
  // the mean of 100/100/72/41 reproduces it exactly).
  const overallPct = Math.round(
    models.reduce((acc, m) => acc + m.progressPct, 0) / Math.max(1, models.length),
  );

  // Every model in the live snapshot is on its final sample — the live-output
  // panel tracks that in-flight sample index.
  const liveSampleIndex = run.samplesPerModel;

  const modelMeta: Record<string, LiveModelMeta> = {};
  for (const rm of models) {
    modelMeta[rm.endpointId] = {
      modelId: modelIdOf(rm.endpointId),
      providerLabel: endpointProviderLabel(rm.endpointId),
      color: modelColor(rm.endpointId),
      excerpt: excerptFor(rm.endpointId),
    };
  }

  const failedSample = fixtures.samples.find((s) => s.status === "failed");
  const failure: LiveFailure | null = failedSample
    ? {
        endpointId: failedSample.endpointId,
        modelId: modelIdOf(failedSample.endpointId),
        sampleIndex: failedSample.sampleIndex,
        samplesPerModel: run.samplesPerModel,
      }
    : null;

  // Console tail: newest last. Column-aligned via padEnd on the event type;
  // the model scope is prepended unless the fixture message already leads with it.
  const consoleLines: ConsoleLineVM[] = events.map((e) => {
    const scope = e.endpointId ? modelIdOf(e.endpointId) : null;
    const detail = scope && !e.message.startsWith(scope) ? `${scope} · ${e.message}` : e.message;
    return { t: e.t, level: e.level, text: `${e.type.padEnd(16)} ${detail}` };
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title={`Live Run — ${run.name}`} />
      <LiveRunScreen
        runId={runId}
        run={run}
        models={models}
        modelMeta={modelMeta}
        events={events}
        consoleLines={consoleLines}
        overallPct={overallPct}
        samplesDone={samplesDone}
        samplesTotal={samplesTotal}
        liveSampleIndex={liveSampleIndex}
        failure={failure}
      />
    </div>
  );
}
