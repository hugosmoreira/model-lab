import { DemoNotice } from "@/components/ui/DemoNotice";
import { TopBar } from "@/components/shell/TopBar";
import { LiveRunClient, type LiveRunSnapshot } from "@/components/live/LiveRunClient";
import type { LiveModelMeta } from "@/components/live/LiveRunScreen";
import { endpointProviderLabel, modelColor, modelIdOf } from "@/lib/data";
import { getRunView } from "@/lib/server/loaders";
import { getStore } from "@model-lab/store";

export const dynamic = "force-dynamic";

/** A disconnected stream falls back only to this run's recorded snapshot. */
export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const store = await getStore();
  const view = await getRunView(runId, store);
  const events = await store.listEvents(runId);
  const endpointIds = view.runModels.map((model) => model.endpointId);
  const modelMeta: Record<string, LiveModelMeta> = {};
  for (const endpointId of endpointIds) {
    modelMeta[endpointId] = {
      modelId: modelIdOf(endpointId),
      providerLabel: endpointProviderLabel(endpointId),
      color: modelColor(endpointId),
      excerpt:
        [...view.samples].reverse().find((sample) => sample.endpointId === endpointId)
          ?.rawExcerpt ?? "",
    };
  }
  const failed = view.samples.find((sample) => sample.status === "failed");
  const fallback: LiveRunSnapshot = {
    run: view.run,
    models: view.runModels,
    events,
    consoleLines: events.map((event) => ({
      t: event.t,
      level: event.level,
      text: `${event.type} · ${event.message}`,
    })),
    overallPct:
      view.runModels.length > 0
        ? Math.round(
            view.runModels.reduce((sum, model) => sum + model.progressPct, 0) /
              view.runModels.length,
          )
        : 0,
    samplesDone: view.samples.filter(
      (sample) => sample.status === "scored" || sample.status === "failed",
    ).length,
    samplesTotal: view.run.modelCount * view.run.samplesPerModel,
    liveSampleIndex: Math.max(1, ...view.samples.map((sample) => sample.sampleIndex)),
    failure: failed
      ? {
          endpointId: failed.endpointId,
          modelId: modelIdOf(failed.endpointId),
          sampleIndex: failed.sampleIndex,
          samplesPerModel: view.run.samplesPerModel,
        }
      : null,
  };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title={`Live Run — ${view.run.name}`} />
      <DemoNotice demo={view.source === "fixtures"} />
      <LiveRunClient
        runId={runId}
        endpointIds={endpointIds}
        samplesPerModel={view.run.samplesPerModel}
        baseRun={view.run}
        modelMeta={modelMeta}
        fallback={fallback}
      />
    </div>
  );
}
