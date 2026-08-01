import { TopBar } from "@/components/shell/TopBar";
import { HeadToHeadClient } from "@/components/compare/HeadToHeadClient";
import { DEMO_RUN_ID, getRunView } from "@/lib/server/loaders";
import { buildPairQueue } from "@/lib/server/pairs";

/** Reads the persistence store (pair queue + votes) — render per request. */
export const dynamic = "force-dynamic";

/**
 * Head-to-Head (Phase 6): ?run= selects the run (default: the demo run —
 * unknown ids also resolve to the demo scenario, mirroring getRunView).
 * The server builds the merged pair queue (canonical C(n,2) pairs + persisted
 * votes + judge results); the client drives the blind vote → reveal → next
 * flow against POST /api/runs/[runId]/votes.
 */
export default async function HeadToHeadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp["run"];
  const requested = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const runId = requested != null && requested !== "" ? requested : DEMO_RUN_ID;

  const view = await getRunView(runId);
  const queue = await buildPairQueue(view);

  return (
    <>
      <TopBar title="Head-to-Head — blind comparison" />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 1300,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <HeadToHeadClient key={queue.runId} initial={queue} />
      </main>
    </>
  );
}
