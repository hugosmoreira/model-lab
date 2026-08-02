import { TopBar } from "@/components/shell/TopBar";
import { NewRunWizard } from "@/components/new-run/NewRunWizard";
import { resolveMaxOutputTokens } from "@/lib/server/run-service";

export default function Page() {
  return (
    <>
      <TopBar title="New Run" />
      <NewRunWizard maxOutputTokens={resolveMaxOutputTokens()} />
    </>
  );
}
