import { TopBar } from "@/components/shell/TopBar";
import { NewRunWizard } from "@/components/new-run/NewRunWizard";
import {
  listEndpointAvailability,
  resolveJudgeConfig,
  resolveMaxOutputTokens,
} from "@/lib/server/run-service";
import { isReadOnly } from "@/lib/server/read-only";
import { EmptyState } from "@/components/ui/primitives";

export default function Page() {
  return (
    <>
      <TopBar title="New Run" />
      {isReadOnly() ? (
        <main style={{ padding: 20 }}>
          <EmptyState
            title="This instance is read-only"
            hint="Run Model Lab in a writable workspace to create benchmarks. Existing results remain available under Runs."
          />
        </main>
      ) : (
        <NewRunWizard
          maxOutputTokens={resolveMaxOutputTokens()}
          judgeEnabled={resolveJudgeConfig("build-arena") !== undefined}
          endpointAvailability={listEndpointAvailability()}
        />
      )}
    </>
  );
}
