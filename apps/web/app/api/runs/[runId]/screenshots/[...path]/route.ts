/**
 * GET /api/runs/[runId]/screenshots/[...path] — stream a stored run screenshot.
 *
 * Real screenshot PNGs live on disk under the runner data root
 * (MODEL_LAB_DATA_DIR, default <repo>/artifacts-data) at
 * screenshots/<runPrefix>/<modelShort>-sN.png. This route path-sanitizes every
 * segment, pins the request to the run's own prefix directory, and refuses
 * anything that escapes <root>/screenshots or isn't a .png.
 */
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { FsRunStore, runPrefix, sanitizeSegment } from "@model-lab/build-arena-runner";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  const { runId, path } = await params;

  // Sanitize each segment exactly like the writer did (strips ../, slashes, NULs).
  const segments = path.map((s) => sanitizeSegment(decodeSegment(s)));
  if (segments.length === 0 || segments.some((s) => s === "unnamed")) {
    return new Response("Not found", { status: 404 });
  }
  const filename = segments[segments.length - 1];
  if (filename === undefined || !filename.toLowerCase().endsWith(".png")) {
    return new Response("Not found", { status: 404 });
  }
  // A run may only read captures under its own prefix directory.
  if (segments[0] !== runPrefix(runId)) {
    return new Response("Not found", { status: 404 });
  }

  const base = resolve(join(new FsRunStore().root, "screenshots"));
  const target = resolve(join(base, ...segments));
  if (target !== base && !target.startsWith(base + sep)) {
    return new Response("Not found", { status: 404 });
  }

  let file: Buffer;
  try {
    file = readFileSync(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=60",
    },
  });
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
