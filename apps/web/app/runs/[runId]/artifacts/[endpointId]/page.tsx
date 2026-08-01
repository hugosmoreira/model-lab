import { notFound } from "next/navigation";
import { TopBar } from "@/components/shell/TopBar";
import { ArtifactViewer } from "@/components/artifact/ArtifactViewer";
import { decodeEndpointId, getViewerData } from "@/components/artifact/model";
import { getRunView } from "@/lib/server/loaders";

/** Reads the persistence store — must render per request. */
export const dynamic = "force-dynamic";

export default async function ArtifactViewerPage({
  params,
}: {
  params: Promise<{ runId: string; endpointId: string }>;
}) {
  // Endpoint ids contain "/" — URLs encode it as "~" (see decodeEndpointId).
  const { runId, endpointId: rawEndpointId } = await params;
  const endpointId = decodeEndpointId(rawEndpointId);
  const view = await getRunView(runId);
  const data = getViewerData(view);
  const build = data.builds.find((b) => b.endpointId === endpointId);
  if (!build) notFound();

  return (
    <>
      <TopBar title={`Artifact Viewer — ${build.artifact.filename}`} />
      {/* key: remount (and reset selection state) when navigating between artifacts */}
      <ArtifactViewer
        key={endpointId}
        data={data}
        initialEndpointId={endpointId}
        annotations={view.annotations}
      />
    </>
  );
}
