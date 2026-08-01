/**
 * Head-to-Head blind votes for a run (Phase 6).
 *
 * GET  /api/runs/[runId]/votes — the full pair queue:
 *        { pairs, currentIndex, stats }
 *      First GET for the demo run seeds the four fixture session votes when
 *      the store holds none, so the demo lands where the prototype did.
 *
 * POST /api/runs/[runId]/votes — cast a blind vote for one pair:
 *        { pairIndex, vote: 'A'|'B'|'tie'|'skip', confidence? }
 *      Votes are FINAL (blind protocol): a pair that already has a final vote
 *      is rejected with 409. Success persists via store.upsertVote
 *      (final: true, votedAt: now) and returns the refreshed queue.
 *
 * 404 for unknown runs (the demo run is always known).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PairwiseVote } from "@model-lab/schemas";
import { getStore, StoreError } from "@model-lab/store";
import { DEMO_RUN_ID, getRunView } from "@/lib/server/loaders";
import { buildPairQueue } from "@/lib/server/pairs";

export const dynamic = "force-dynamic";

const VoteRequest = z.object({
  pairIndex: z.number().int().min(1),
  vote: z.enum(["A", "B", "tie", "skip"]),
  confidence: z.enum(["low", "med", "high"]).default("med"),
});

/** The demo run is always votable; other ids must exist in the store. */
async function isKnownRun(runId: string): Promise<boolean> {
  if (runId === DEMO_RUN_ID) return true;
  try {
    const store = await getStore();
    return (await store.getRun(runId)) !== null;
  } catch {
    return false;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!(await isKnownRun(runId))) {
    return NextResponse.json({ error: `Unknown run: ${runId}` }, { status: 404 });
  }
  const queue = await buildPairQueue(await getRunView(runId));
  return NextResponse.json(queue);
}

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
  const parsed = VoteRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid vote.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!(await isKnownRun(runId))) {
    return NextResponse.json({ error: `Unknown run: ${runId}` }, { status: 404 });
  }

  const view = await getRunView(runId);
  const queue = await buildPairQueue(view);
  const pair = queue.pairs.find((p) => p.pairIndex === parsed.data.pairIndex);
  if (!pair) {
    return NextResponse.json(
      { error: `Unknown pair ${parsed.data.pairIndex} — this run has ${queue.pairs.length} pairs.` },
      { status: 400 },
    );
  }
  if (pair.final) {
    return NextResponse.json(
      {
        error: `Pair ${pair.pairIndex} already has a final vote — votes are final (blind protocol).`,
      },
      { status: 409 },
    );
  }

  const record: PairwiseVote = {
    runId: queue.runId,
    pairIndex: pair.pairIndex,
    pairTotal: pair.pairTotal,
    pairing: pair.pairing,
    criterion: pair.criterion,
    orderSwapped: pair.orderSwapped,
    vote: parsed.data.vote,
    confidence: parsed.data.confidence,
    votedAt: new Date().toISOString(),
    final: true,
  };

  try {
    const store = await getStore();
    await store.upsertVote(record);
  } catch (err) {
    if (err instanceof StoreError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: `Unknown run: ${runId}` }, { status: 404 });
    }
    return NextResponse.json({ error: "Vote could not be saved." }, { status: 500 });
  }

  const refreshed = await buildPairQueue(view);
  return NextResponse.json(refreshed, { status: 201 });
}
