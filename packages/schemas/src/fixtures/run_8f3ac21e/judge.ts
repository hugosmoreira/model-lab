import type { JudgePairResult, PairwiseVote, WtlCell } from "../../index";

const R = "run_8f3ac21e";
const S = "anthropic/claude-sonnet-4-6";
const G = "openai/gpt-5.2-mini";
const M = "google/gemini-3-flash";
const Q = "ollama/qwen3-coder-32b@q4_K_M";

/**
 * 6 pairs for 4 models. Pair 5 (gpt vs gemini) reversed on order swap —
 * flagged ⟲ and excluded from the judge tally (audit convention).
 */
export const judgePairs: JudgePairResult[] = [
  {
    runId: R,
    pairIndex: 1,
    pairing: [S, G],
    verdictAB: "A",
    verdictBA: "A",
    reversed: false,
    excludedFromTally: false,
    commentary: null,
  },
  {
    runId: R,
    pairIndex: 2,
    pairing: [S, M],
    verdictAB: "A",
    verdictBA: "A",
    reversed: false,
    excludedFromTally: false,
    commentary: null,
  },
  {
    runId: R,
    pairIndex: 3,
    pairing: [S, Q],
    verdictAB: "A",
    verdictBA: "A",
    reversed: false,
    excludedFromTally: false,
    commentary: null,
  },
  {
    runId: R,
    pairIndex: 4,
    pairing: [G, Q],
    verdictAB: "A",
    verdictBA: "A",
    reversed: false,
    excludedFromTally: false,
    commentary: null,
  },
  {
    runId: R,
    pairIndex: 5,
    pairing: [G, M],
    verdictAB: "A",
    verdictBA: "B",
    reversed: true,
    excludedFromTally: true,
    commentary:
      "Judge picked gpt-5.2-mini in A/B order, then gemini-3-flash after the swap — verdict is order-sensitive.",
  },
  {
    runId: R,
    pairIndex: 6,
    pairing: [M, Q],
    verdictAB: "A",
    verdictBA: "A",
    reversed: false,
    excludedFromTally: false,
    commentary: null,
  },
];

/**
 * W–T–L matrix (row vs column) over 6 judgments per pair (3 samples × 2 orders).
 * Cells for the reversed pair keep the raw tally but carry the ⟲ flag; the
 * legend explains the flagged pair is excluded from the aggregate verdict.
 */
export const wtlMatrix: Record<string, Record<string, WtlCell>> = {
  [S]: {
    [G]: { w: 4, t: 1, l: 1, reversalFlagged: false },
    [M]: { w: 5, t: 1, l: 0, reversalFlagged: false },
    [Q]: { w: 6, t: 0, l: 0, reversalFlagged: false },
  },
  [G]: {
    [S]: { w: 1, t: 1, l: 4, reversalFlagged: false },
    [M]: { w: 4, t: 1, l: 1, reversalFlagged: true },
    [Q]: { w: 5, t: 1, l: 0, reversalFlagged: false },
  },
  [M]: {
    [S]: { w: 0, t: 1, l: 5, reversalFlagged: false },
    [G]: { w: 1, t: 1, l: 4, reversalFlagged: true },
    [Q]: { w: 4, t: 2, l: 0, reversalFlagged: false },
  },
  [Q]: {
    [S]: { w: 0, t: 0, l: 6, reversalFlagged: false },
    [G]: { w: 0, t: 1, l: 5, reversalFlagged: false },
    [M]: { w: 0, t: 2, l: 4, reversalFlagged: false },
  },
};

/**
 * Judge rubric scores per model (0–10, rubric v2, averaged over both
 * presentation orders) — the "Brief adherence" category on Results. This is a
 * rubric grade, NOT a win-rate; the W–T–L matrix carries the pairwise record.
 */
export const judgeBriefScores: Record<string, number> = {
  [S]: 9.0,
  [G]: 8.8,
  [M]: 7.6,
  [Q]: 6.4,
};

/** Head-to-Head session state: user is on pair 5 of 6, 4 votes cast. */
export const pairwiseSession: {
  currentPairIndex: number;
  votes: PairwiseVote[];
  criterion: string;
  judgeAgreement: string;
  judgeConflictWarning: string | null;
} = {
  currentPairIndex: 5,
  criterion: "Which raycaster better fulfills the brief?",
  judgeAgreement: "3/4",
  judgeConflictWarning:
    "The LLM judge shares a model family with one anonymized output in this pair. Judge votes are " +
    "labeled and weighted separately — your blind vote is the primary signal.",
  votes: [
    {
      runId: R,
      pairIndex: 1,
      pairTotal: 6,
      pairing: [S, G],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: false,
      vote: "A",
      confidence: "high",
      votedAt: "2026-07-31T14:24:10Z",
      final: true,
    },
    {
      runId: R,
      pairIndex: 2,
      pairTotal: 6,
      pairing: [S, M],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: true,
      vote: "A",
      confidence: "high",
      votedAt: "2026-07-31T14:24:55Z",
      final: true,
    },
    {
      runId: R,
      pairIndex: 3,
      pairTotal: 6,
      pairing: [S, Q],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: false,
      vote: "A",
      confidence: "high",
      votedAt: "2026-07-31T14:25:20Z",
      final: true,
    },
    {
      runId: R,
      pairIndex: 4,
      pairTotal: 6,
      pairing: [G, Q],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: false,
      vote: "A",
      confidence: "med",
      votedAt: "2026-07-31T14:25:48Z",
      final: true,
    },
    {
      runId: R,
      pairIndex: 5,
      pairTotal: 6,
      pairing: [G, M],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: true,
      vote: null,
      confidence: "med",
      votedAt: null,
      final: false,
    },
    {
      runId: R,
      pairIndex: 6,
      pairTotal: 6,
      pairing: [M, Q],
      criterion: "Which raycaster better fulfills the brief?",
      orderSwapped: false,
      vote: null,
      confidence: "med",
      votedAt: null,
      final: false,
    },
  ],
};
