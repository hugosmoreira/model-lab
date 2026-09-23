/**
 * Head-to-Head blind votes for a run (Phase 6).
 *
 * GET  /api/runs/[runId]/votes — the full pair queue:
 *        { pairs, currentIndex, stats }
 *      Reads recorded votes only; demo votes are installed by explicit seeding.
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
import { getRunView } from "@/lib/server/loaders";
import { buildPairQueue } from "@/lib/server/pairs";
import { isReadOnly, readOnlyResponse } from "@/lib/server/read-only";
import { guardMutationRequest } from "@/lib/server/mutation-guard";
import { readMutationJson } from "@/lib/server/mutation-body";

export const dynamic = "force-dynamic";

const VoteRequest = z.object({
  pairIndex: z.number().int().min(1),
  vote: z.enum(["A", "B", "tie", "skip"]),
  confidence: z.enum(["low", "med", "high"]).default("med"),
});

/** Only an actual stored run can receive votes, including the demo. */
async function runLookupError(runId: string): Promise<Response | null> {
  try {
    const store = await getStore();
    return (await store.getRun(runId)) === null
      ? NextResponse.json({ error: "Run not found." }, { status: 404 })
      : null;
  } catch {
    return NextResponse.json({ error: "Run storage is temporarily unavailable." }, { status: 503 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const lookupError = await runLookupError(runId);
  if (lookupError !== null) return lookupError;
  const queue = await buildPairQueue(await getRunView(runId));
  return NextResponse.json(queue);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  if (isReadOnly()) return readOnlyResponse();
  const rejected = guardMutationRequest(req);
  if (rejected !== null) return rejected;
  const { runId } = await params;

  const body = await readMutationJson(req);
  if (!body.ok) return body.response;
  const parsed = VoteRequest.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid vote.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const lookupError = await runLookupError(runId);
  if (lookupError !== null) return lookupError;

  const view = await getRunView(runId);
  const queue = await buildPairQueue(view);
  const pair = queue.pairs.find((p) => p.pairIndex === parsed.data.pairIndex);
  if (!pair) {
    return NextResponse.json(
      {
        error: `Unknown pair ${parsed.data.pairIndex} — this run has ${queue.pairs.length} pairs.`,
      },
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
    if (err instanceof StoreError && err.code === "INVALID") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof StoreError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof StoreError && err.code === "IMMUTABLE") {
      return NextResponse.json({ error: "This pair already has a final vote." }, { status: 409 });
    }
    return NextResponse.json({ error: "Vote could not be saved." }, { status: 500 });
  }

  const refreshed = await buildPairQueue(view);
  return NextResponse.json(refreshed, { status: 201 });
}
