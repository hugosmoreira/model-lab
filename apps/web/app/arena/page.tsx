import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { ArenaGrid } from "@/components/artifact/ArenaGrid";
import { getArenaData } from "@/components/artifact/model";
import { DEMO_RUN_ID, getRunView } from "@/lib/server/loaders";

export default async function BuildArenaPage() {
  // Top-level Arena shows the demo scenario (fixture view of run_8f3ac21e).
  const view = await getRunView(DEMO_RUN_ID);
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
        <ArenaGrid data={data} />
        <ReproStrip manifest={view.manifest} />
      </main>
    </>
  );
}
