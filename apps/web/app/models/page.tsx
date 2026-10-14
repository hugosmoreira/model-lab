import { TopBar } from "@/components/shell/TopBar";
import { ModelsRegistry } from "@/components/models/ModelsRegistry";
import { fixtures } from "@/lib/data";
import { getModelCatalog } from "@/lib/server/model-catalog";

export default async function ModelsPage() {
  const catalog = await getModelCatalog();
  const current = catalog.models.filter((m) => m.recent);
  return (
    <>
      <TopBar title="Models" />
      <ModelsRegistry
        endpoints={current.map((m) => m.endpoint)}
        modelDefinitions={current.map((m) => m.model)}
        providers={fixtures.providers}
      />
    </>
  );
}
