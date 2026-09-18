/**
 * Serve only a screenshot recorded for this run. New v2 identities and legacy
 * references remain readable; request text is validated, never reinterpreted.
 */
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { FsRunStore, identitySegment, runPrefix } from "@model-lab/build-arena-runner";
import { getStore } from "@model-lab/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  const { runId, path } = await params;
  const missing = () => new Response("Not found", { status: 404 });
  if (
    !/^run_[0-9a-f]{8}$/.test(runId) ||
    path.length < 2 ||
    path.some((part) => !/^[A-Za-z0-9._@-]{1,120}$/.test(part) || part === "." || part === "..") ||
    !path[path.length - 1]?.endsWith(".png")
  )
    return missing();

  const ownsDirectory =
    path[0] === "v2"
      ? path.length === 4 && path[1] === identitySegment(runId)
      : path.length === 2 && path[0] === runPrefix(runId);
  if (!ownsDirectory) return missing();

  const fsStore = new FsRunStore();
  let references: (string | null)[];
  try {
    const store = await getStore();
    const persisted = await store.listArtifacts(runId);
    const snapshot = fsStore.loadSnapshot(runId);
    references = [
      ...persisted.map((a) => a.screenshotRef),
      ...(snapshot?.artifacts ?? []).map((a) => a.screenshotPath),
    ];
  } catch {
    return new Response("Screenshot storage is temporarily unavailable.", { status: 503 });
  }

  try {
    const target = fsStore.resolveEvidencePath(`screenshots/${path.join("/")}`, "screenshots");
    const recorded = references.some((reference) => {
      if (!reference) return false;
      try {
        return fsStore.resolveEvidencePath(reference, "screenshots") === target;
      } catch {
        return false;
      }
    });
    if (!recorded) return missing();
    const file = readFileSync(target);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return missing();
  }
}
