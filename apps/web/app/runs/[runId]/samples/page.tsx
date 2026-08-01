import { TopBar } from "@/components/shell/TopBar";
import { SampleExplorer } from "@/components/samples/SampleExplorer";
import type { SampleRowData } from "@/components/samples/shared";
import { endpointProviderLabel, fixtures, getEndpoint, modelColor, modelIdOf } from "@/lib/data";

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { samples, challengePrompt, runManifest, runCompleted } = fixtures;

  // "raycaster" — task word of the benchmark pack slug ("raycaster-oneshot").
  const taskLabel = runCompleted.pack.slug.split("-")[0] ?? runCompleted.pack.slug;

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
      <SampleExplorer
        runId={runId}
        rows={rows}
        taskLabel={taskLabel}
        challengePrompt={challengePrompt}
        manifest={runManifest}
      />
    </>
  );
}
