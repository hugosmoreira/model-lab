import { TopBar } from "@/components/shell/TopBar";
import { ModelsRegistry } from "@/components/models/ModelsRegistry";
import { fixtures } from "@/lib/data";

export default function ModelsPage() {
  const { endpoints, modelDefinitions, providers, runLive } = fixtures;
  return (
    <>
      <TopBar title="Models" />
      <ModelsRegistry
        endpoints={endpoints}
        modelDefinitions={modelDefinitions}
        providers={providers}
        resultsRunId={runLive.id}
      />
    </>
  );
}
