import { DemoNotice } from "@/components/ui/DemoNotice";
import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { ArenaGrid } from "@/components/artifact/ArenaGrid";
import { getArenaData } from "@/components/artifact/model";
import { getRunView } from "@/lib/server/loaders";

/** Reads the persistence store — must render per request. */
export const dynamic = "force-dynamic";

export default async function RunArtifactsPage({ params }: { params: Promise<{ runId: string }> }) {
  // Recorded runs render their own artifacts; unknown run ids return 404.

  const { runId } = await params;
  const view = await getRunView(runId);
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
