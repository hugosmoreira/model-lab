import { TopBar } from "@/components/shell/TopBar";
import { NewRunWizard } from "@/components/new-run/NewRunWizard";
import {
  listEndpointAvailability,
  resolveJudgeConfig,
  resolveMaxOutputTokens,
} from "@/lib/server/run-service";
import { isReadOnly } from "@/lib/server/read-only";
import { loadPackFromDisk } from "@/lib/server/packs";
import { fixtures } from "@/lib/data";
import { getModelCatalog } from "@/lib/server/model-catalog";
import { EmptyState } from "@/components/ui/primitives";
import { BRAND_NAME } from "@/lib/brand";

export default async function Page() {
  const readOnly = isReadOnly();
  const catalog = readOnly ? null : await getModelCatalog();
  const availability = readOnly ? [] : await listEndpointAvailability();
  return (
    <>
      <TopBar title="New Run" />
      {catalog === null ? (
        <main style={{ padding: 20 }}>
          <EmptyState
            title="This instance is read-only"
            hint={`Run ${BRAND_NAME} in a writable workspace to create benchmarks. Existing results remain available under Runs.`}
          />
        </main>
      ) : (
        <NewRunWizard
          maxOutputTokens={resolveMaxOutputTokens()}
          judgeEnabled={resolveJudgeConfig("build-arena") !== undefined}
          endpointAvailability={availability}
          models={catalog.models.map(({ endpoint, model, displayName, releasedAt, recent }) => ({
            endpoint,
            model,
            displayName,
            releasedAt,
            recent,
          }))}
          catalog={{ source: catalog.source, fetchedAt: catalog.fetchedAt }}
          runnablePackSlugs={fixtures.benchmarkPacks
            .filter((pack) => loadPackFromDisk(pack.slug) !== null)
            .map((pack) => pack.slug)}
        />
      )}
    </>
  );
}
