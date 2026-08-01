import { TopBar } from "@/components/shell/TopBar";
import { NewRunWizard } from "@/components/new-run/NewRunWizard";

export default function Page() {
  return (
    <>
      <TopBar title="New Run" />
      <NewRunWizard />
    </>
  );
}
