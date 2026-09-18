import { DemoNotice } from "@/components/ui/DemoNotice";
import { TopBar } from "@/components/shell/TopBar";
import { SampleExplorer } from "@/components/samples/SampleExplorer";
import type { SampleRowData } from "@/components/samples/shared";
import { endpointProviderLabel, getEndpoint, modelColor, modelIdOf } from "@/lib/data";
import { getRunView } from "@/lib/server/loaders";

/** Reads the persistence store — must render per request. */
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const view = await getRunView(runId);
  const { samples, challengePrompt, manifest, run, annotations } = view;

  // "raycaster" — task word of the benchmark pack slug ("raycaster-oneshot").
  const taskLabel = run.pack.slug.split("-")[0] ?? run.pack.slug;

  const rows: SampleRowData[] = samples.map((sample) => {
    const ep = getEndpoint(sample.endpointId);
    return {
      sample,
      modelId: modelIdOf(sample.endpointId),
      color: modelColor(sample.endpointId),
      providerLabel: ep.deployment === "local" ? `${ep.providerId} · local` : ep.providerId,
      isLocal: ep.deployment === "local",
      endpointLabel: endpointProviderLabel(sample.endpointId),
    };
  });

  return (
    <>
      <TopBar title={`Sample Explorer — ${runId}`} />
      <DemoNotice demo={view.source === "fixtures"} />
      <SampleExplorer
        runId={runId}
        rows={rows}
        taskLabel={taskLabel}
        challengePrompt={challengePrompt}
        manifest={manifest}
        annotations={annotations}
      />
    </>
  );
}
