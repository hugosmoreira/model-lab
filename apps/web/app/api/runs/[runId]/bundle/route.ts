import AdmZip from "adm-zip";
import { NextResponse } from "next/server";
import { exportBundle } from "@model-lab/build-arena-runner";
import { buildDemoBundleZip, DEMO_RUN_ID } from "@/lib/share/demo-bundle";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[runId]/bundle — reproducible run bundle as a zip attachment.
 *
 *  - Demo run (run_8f3ac21e): the bundle is generated in-memory from the
 *    typed fixtures (it never touched the FsRunStore).
 *  - Real runs: the runner's exportBundle(runId) writes bundles/<runId>/
 *    under MODEL_LAB_DATA_DIR (manifest, models, benchmark, samples.jsonl,
 *    scores, README, artifacts/, screenshots/, events.jsonl); that directory
 *    is zipped with adm-zip. Bundles exist only for terminal runs — the
 *    runner persists run.json when the run finishes.
 *
 * Security: the runId is validated against ^run_[0-9a-f]{8}$ BEFORE any
 * filesystem access (path traversal), and the response is served with
 * Content-Disposition: attachment (audit L-1 — never render stored content
 * inline from this origin).
 */

const RUN_ID_RE = /^run_[0-9a-f]{8}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }

  try {
    const buffer =
      runId === DEMO_RUN_ID ? buildDemoBundleZip() : await zipStoredBundle(runId);
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
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 });
  }
}

async function zipStoredBundle(runId: string): Promise<Buffer> {
  const result = await exportBundle(runId); // writes bundles/<runId>/ on disk
  const zip = new AdmZip();
  zip.addLocalFolder(result.dir);
  return zip.toBuffer();
}
