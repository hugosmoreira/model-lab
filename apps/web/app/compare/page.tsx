import { DemoNotice } from "@/components/ui/DemoNotice";
import { TopBar } from "@/components/shell/TopBar";
import { HeadToHeadClient } from "@/components/compare/HeadToHeadClient";
import { getRunView, listAllRuns } from "@/lib/server/loaders";
import { EmptyState } from "@/components/ui/primitives";
import { buildPairQueue } from "@/lib/server/pairs";

/** Reads the persistence store (pair queue + votes) — render per request. */
export const dynamic = "force-dynamic";

/**
 * Head-to-Head: ?run= selects the run (default: newest recorded arena run).
 * Unknown ids return 404; an empty workspace has an explicit empty state.
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
  const runId =
    requested != null && requested !== ""
      ? requested
      : (await listAllRuns()).find((run) => run.mode === "build-arena")?.id;
  if (runId == null)
    return (
      <>
        <TopBar title="Head-to-Head" />
        <main style={{ padding: 20 }}>
          <EmptyState
            title="No runs to compare"
            hint="Create a Build Arena run with at least two models to compare its artifacts."
          />
        </main>
      </>
    );

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
        <DemoNotice demo={view.source === "fixtures"} />
        <HeadToHeadClient key={queue.runId} initial={queue} />
      </main>
    </>
  );
}
