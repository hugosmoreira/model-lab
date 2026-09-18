/**
 * Head-to-Head pair queue (Phase 6).
 *
 * SERVER-ONLY — imports @model-lab/store. Never import VALUES from a client
 * component (type-only imports are fine; they erase at compile time).
 *
 * `buildPairQueue(runView)` produces the full blind-comparison queue for a
 * run: every C(n,2) endpoint pair in canonical order (runModels insertion
 * order, nested i<j loop), merged with
 *  - persisted votes (`store.listVotes`) — a persisted vote is the source of
 *    truth for that pair's pairing / order swap / criterion, and
 *  - the run's judge pair results (`runView.judge.judgePairs` — fixture data
 *    for the demo run, empty for store runs without a judge scorer).
 *
 * Blind protocol invariants:
 *  - orderSwapped is deterministic per pair — `pairIndex % 2 === 1` — so half
 *    the pairs present swapped (persisted votes keep whatever was presented).
 *  - votes are FINAL once cast; the queue's `currentIndex` is simply the
 *    first pair without a final vote.
 *
 * Demo storyline: on first load, if the store holds no votes for
 * run_8f3ac21e, the four final fixture session votes are seeded so the demo
 * lands exactly where the prototype did (pair 5 of 6, four votes cast). The
 * judge-contamination warning attaches only to the demo's pair 5 — it is
 * fixture narrative; real runs omit it.
 */
import type { Artifact, JudgePairResult, PairwiseVote } from "@model-lab/schemas";
import * as fx from "@model-lab/schemas/fixtures";
import { getStore, type RunStore } from "@model-lab/store";
import { getEndpoint, modelColor, modelIdOf, shortNameOf } from "@/lib/data";
import { DEMO_RUN_ID, type RunView } from "@/lib/server/loaders";

export type VoteChoice = "A" | "B" | "tie" | "skip";
export type Confidence = "low" | "med" | "high";

/** Default criterion for runs without an authored one. */
const DEFAULT_CRITERION = "Which build better fulfills the brief?";

export interface PairSideView {
  slot: "A" | "B";
  endpointId: string;
  modelId: string;
  providerId: string;
  shortName: string;
  /** Identity hex — the client applies it only after reveal (blind protocol). */
  color: string;
  /** "raycaster.html · 48kb" — shown only after reveal. */
  artifactMeta: string | null;
  /** Best stored artifact for this endpoint (sandboxed preview); null when none. */
  artifact: Artifact | null;
}

export interface PairJudgeView {
  verdictAB: "A" | "B" | "tie" | null;
  verdictBA: "A" | "B" | "tie" | null;
  reversed: boolean;
  excludedFromTally: boolean;
  commentary: string | null;
}

export interface PairState {
  pairIndex: number; // 1-based
  pairTotal: number;
  /** Endpoint ids in slot order [A, B]. */
  pairing: [string, string];
  criterion: string;
  orderSwapped: boolean;
  a: PairSideView;
  b: PairSideView;
  vote: VoteChoice | null;
  confidence: Confidence;
  votedAt: string | null;
  /** Votes lock after reveal — blind protocol integrity. */
  final: boolean;
  /** null when the run had no judge scorer (or no verdict for this pair). */
  judge: PairJudgeView | null;
  /** Demo-only judge-contamination notice (fixture narrative; real runs omit). */
  conflictWarning: string | null;
}

export interface PairQueueStats {
  /** Final non-skip votes cast so far. */
  votesCast: number;
  /**
   * "4/4" — final non-skip votes matching the judge's A/B verdict, over pairs
   * where both exist and the judge pair is not excluded from the tally
   * (reversal-flagged). null when there is no comparable overlap.
   */
  judgeAgreement: string | null;
}

export interface PairQueue {
  runId: string;
  pairs: PairState[];
  /** 1-based pairIndex of the first unvoted pair; null = queue complete. */
  currentIndex: number | null;
  stats: PairQueueStats;
}

/* ------------------------------------------------------------------------- */

/** Identity lookup that never throws (store runs use the same catalog). */
function identityOf(endpointId: string): {
  modelId: string;
  providerId: string;
  shortName: string;
  color: string;
} {
  try {
    return {
      modelId: modelIdOf(endpointId),
      providerId: getEndpoint(endpointId).providerId,
      shortName: shortNameOf(endpointId),
      color: modelColor(endpointId),
    };
  } catch {
    const [provider, ...rest] = endpointId.split("/");
    const model = rest.join("/") || endpointId;
    return {
      modelId: model,
      providerId: provider ?? "unknown",
      shortName: model,
      color: "#6b6478", // --color-model-blind fallback for uncatalogued ids
    };
  }
}

/** Best artifact per endpoint: best-of sample, else first render-ok, else first. */
function bestArtifactByEndpoint(artifacts: Artifact[]): Map<string, Artifact> {
  const byEndpoint = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    const list = byEndpoint.get(a.endpointId) ?? [];
    list.push(a);
    byEndpoint.set(a.endpointId, list);
  }
  const best = new Map<string, Artifact>();
  for (const [endpointId, list] of byEndpoint) {
    const pick = list.find((a) => a.isBestOfModel) ?? list.find((a) => a.renderOk) ?? list[0];
    if (pick) best.set(endpointId, pick);
  }
  return best;
}

function sideView(slot: "A" | "B", endpointId: string, artifact: Artifact | null): PairSideView {
  return {
    slot,
    endpointId,
    ...identityOf(endpointId),
    artifactMeta: artifact
      ? `${artifact.filename} · ${artifact.sizeKb}kb${artifact.renderOk ? "" : " · render fail"}`
      : null,
    artifact,
  };
}

/**
 * Seed the four final fixture session votes for the demo run when the store
 * holds none (memory auto-seeds them via seedDemo; sqlite/supabase may not).
 * Failures (e.g. demo run absent from a persistent backend) degrade silently:
 * the queue just starts at pair 1.
 */
async function ensureDemoVotes(store: RunStore): Promise<void> {
  const existing = await store.listVotes(DEMO_RUN_ID).catch((): PairwiseVote[] => []);
  if (existing.length > 0) return;
  for (const v of fx.pairwiseSession.votes) {
    if (!v.final) continue;
    await store.upsertVote({ ...v, pairing: [v.pairing[0], v.pairing[1]] }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------- */

export async function buildPairQueue(runView: RunView): Promise<PairQueue> {
  const runId = runView.run.id;

  let store: RunStore | null = null;
  try {
    store = await getStore();
  } catch {
    store = null;
  }

  if (store !== null && runId === DEMO_RUN_ID) await ensureDemoVotes(store);

  const votes = store !== null ? await store.listVotes(runId).catch((): PairwiseVote[] => []) : [];
  const voteByPair = new Map(votes.map((v) => [v.pairIndex, v] as const));

  const judgePairs: JudgePairResult[] = runView.judge?.judgePairs ?? [];
  const judgeByPair = new Map(judgePairs.map((j) => [j.pairIndex, j] as const));

  const artifactByEndpoint = bestArtifactByEndpoint(runView.artifacts);

  // Canonical pair order: runModels insertion order, nested i<j loop.
  const endpointIds = runView.runModels.map((rm) => rm.endpointId);
  const canonical: Array<[string, string]> = [];
  for (let i = 0; i < endpointIds.length; i++) {
    for (let j = i + 1; j < endpointIds.length; j++) {
      const a = endpointIds[i];
      const b = endpointIds[j];
      if (a !== undefined && b !== undefined) canonical.push([a, b]);
    }
  }
  const pairTotal = canonical.length;
  const defaultCriterion = runId === DEMO_RUN_ID ? fx.pairwiseSession.criterion : DEFAULT_CRITERION;

  const pairs: PairState[] = canonical.map((generated, idx) => {
    const pairIndex = idx + 1;
    const persisted = voteByPair.get(pairIndex) ?? null;
    const judge = judgeByPair.get(pairIndex) ?? null;

    // Pairing precedence: persisted vote (what was actually presented) >
    // judge result (authored fixture layout) > canonical generation.
    const pairing: [string, string] = persisted
      ? [persisted.pairing[0], persisted.pairing[1]]
      : judge
        ? [judge.pairing[0], judge.pairing[1]]
        : generated;
    const orderSwapped = persisted ? persisted.orderSwapped : pairIndex % 2 === 1;

    const aId = pairing[0];
    const bId = pairing[1];
    return {
      pairIndex,
      pairTotal,
      pairing,
      criterion: persisted?.criterion ?? defaultCriterion,
      orderSwapped,
      a: sideView("A", aId, artifactByEndpoint.get(aId) ?? null),
      b: sideView("B", bId, artifactByEndpoint.get(bId) ?? null),
      vote: persisted?.final ? persisted.vote : null,
      confidence: persisted?.confidence ?? "med",
      votedAt: persisted?.final ? persisted.votedAt : null,
      final: persisted?.final ?? false,
      judge: judge
        ? {
            verdictAB: judge.verdictAB,
            verdictBA: judge.verdictBA,
            reversed: judge.reversed,
            excludedFromTally: judge.excludedFromTally,
            commentary: judge.commentary,
          }
        : null,
      conflictWarning:
        runId === DEMO_RUN_ID && pairIndex === 5 ? fx.pairwiseSession.judgeConflictWarning : null,
    };
  });

  const firstUnvoted = pairs.find((p) => !p.final);

  let votesCast = 0;
  let agreeNum = 0;
  let agreeDen = 0;
  for (const p of pairs) {
    if (!p.final || p.vote == null || p.vote === "skip") continue;
    votesCast++;
    if (p.judge == null || p.judge.verdictAB == null || p.judge.excludedFromTally) continue;
    agreeDen++;
    if (p.vote === p.judge.verdictAB) agreeNum++;
  }

  return {
    runId,
    pairs,
    currentIndex: firstUnvoted?.pairIndex ?? null,
    stats: {
      votesCast,
      judgeAgreement: agreeDen > 0 ? `${agreeNum}/${agreeDen}` : null,
    },
  };
}
