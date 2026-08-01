import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { ArenaGrid } from "@/components/artifact/ArenaGrid";
import { getArenaData } from "@/components/artifact/model";
import { fixtures } from "@/lib/data";

export default function BuildArenaPage() {
  const data = getArenaData();
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
        <ReproStrip manifest={fixtures.runManifest} />
      </main>
    </>
  );
}
