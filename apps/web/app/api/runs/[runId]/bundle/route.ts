import { NextResponse } from "next/server";
import { withTemporaryBundle } from "@model-lab/build-arena-runner";
import { getStore } from "@model-lab/store";
import { buildDemoBundleZip, DEMO_RUN_ID } from "@/lib/share/demo-bundle";
import { zipDirectory } from "@/lib/share/zip";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[runId]/bundle — reproducible run bundle as a zip attachment.
 *
 *  - Demo run (run_8f3ac21e): the bundle is generated in-memory from the
 *    typed fixtures (it never touched the FsRunStore).
 *  - Real runs: an isolated temporary export is zipped in memory and removed
 *    before the response is returned, including export/ZIP failures. Download
 *    requests never create persistent CLI exports or append run-log events.
 *
 * Security: the runId is validated against ^run_[0-9a-f]{8}$ BEFORE any
 * filesystem access (path traversal), and the response is served with
 * Content-Disposition: attachment (audit L-1 — never render stored content
 * inline from this origin).
 */

const RUN_ID_RE = /^run_[0-9a-f]{8}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }

  try {
    if (runId === DEMO_RUN_ID && (await (await getStore()).getRun(runId)) === null) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const buffer = runId === DEMO_RUN_ID ? buildDemoBundleZip() : await zipStoredBundle(runId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${runId}-bundle.zip"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "bundle export failed";
    // exportBundle throws "no stored results for <runId> — complete a run first"
    const notFound = message.includes("no stored results");
    return NextResponse.json(
      { error: notFound ? "No stored results for this run." : "Bundle export failed." },
      { status: notFound ? 404 : 500 },
    );
  }
}

async function zipStoredBundle(runId: string): Promise<Buffer> {
  return withTemporaryBundle(runId, (result) => zipDirectory(result.dir));
}
