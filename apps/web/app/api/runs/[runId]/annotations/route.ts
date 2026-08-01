/**
 * Append-only human annotation stream for a run.
 *
 * POST /api/runs/[runId]/annotations — record a note (+ optional score
 * override). Overrides NEVER mutate recorded scores: the store keeps
 * annotations as a separate append-only audit trail.
 * GET — list the run's annotations in append order.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { HumanAnnotation } from "@model-lab/schemas";
import { getStore, StoreError } from "@model-lab/store";

export const dynamic = "force-dynamic";

const AnnotationRequest = z.object({
  endpointId: z.string().min(1),
  sampleIndex: z.number().int().min(1),
  note: z.string().min(1).max(4000),
  scoreOverride: z.number().min(0).max(10).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = AnnotationRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid annotation.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const annotation: HumanAnnotation = {
    runId,
    endpointId: parsed.data.endpointId,
    sampleIndex: parsed.data.sampleIndex,
    note: parsed.data.note,
    scoreOverride: parsed.data.scoreOverride ?? null,
    author: "operator",
    at: new Date().toISOString(),
  };

  try {
    const store = await getStore();
    await store.insertAnnotation(annotation);
  } catch (err) {
    if (err instanceof StoreError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: `Unknown run: ${runId}` }, { status: 404 });
    }
    return NextResponse.json({ error: "Annotation could not be saved." }, { status: 500 });
  }
  return NextResponse.json({ annotation }, { status: 201 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  try {
    const store = await getStore();
    const annotations = await store.listAnnotations(runId);
    return NextResponse.json({ annotations });
  } catch {
    return NextResponse.json({ annotations: [] });
  }
}
