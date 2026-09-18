import { DemoNotice } from "@/components/ui/DemoNotice";
import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { ArenaGrid } from "@/components/artifact/ArenaGrid";
import { getArenaData } from "@/components/artifact/model";
import { getRunView, listAllRuns } from "@/lib/server/loaders";

import { EmptyState } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function BuildArenaPage() {
  // Open the newest recorded arena run; empty workspaces have an explicit empty state.
  const run = (await listAllRuns()).find((entry) => entry.mode === "build-arena");
  if (run == null)
    return (
      <>
        <TopBar title="Build Arena" />
        <main style={{ padding: 20 }}>
          <EmptyState
            title="No Build Arena runs yet"
            hint="Create a Build Arena run, then inspect its captured artifacts here."
          />
        </main>
      </>
    );
  const view = await getRunView(run.id);
  const data = getArenaData(view);
  return (
    <>
      <TopBar title="Build Arena" />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 1400,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <DemoNotice demo={view.source === "fixtures"} />
        <ArenaGrid data={data} />
        <ReproStrip manifest={view.manifest} />
      </main>
    </>
  );
}
