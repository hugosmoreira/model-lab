import { z } from "zod";

export const PairwiseVote = z.object({
  runId: z.string(),
  pairIndex: z.number(), // 1-based
  pairTotal: z.number(),
  pairing: z.tuple([z.string(), z.string()]), // endpoint ids in slot order [A, B]
  criterion: z.string(),
  orderSwapped: z.boolean(),
  vote: z.enum(["A", "B", "tie", "skip"]).nullable().default(null),
  confidence: z.enum(["low", "med", "high"]).default("med"),
  votedAt: z.string().nullable().default(null),
  /** votes lock after reveal — blind protocol integrity */
  final: z.boolean().default(false),
});
export type PairwiseVote = z.infer<typeof PairwiseVote>;

export const JudgePairResult = z.object({
  runId: z.string(),
  pairIndex: z.number(),
  pairing: z.tuple([z.string(), z.string()]),
  /** verdict per presentation order; reversal = disagreement between the two */
  verdictAB: z.enum(["A", "B", "tie"]).nullable(),
  verdictBA: z.enum(["A", "B", "tie"]).nullable(),
  reversed: z.boolean(),
  excludedFromTally: z.boolean(),
  commentary: z.string().nullable().default(null),
});
export type JudgePairResult = z.infer<typeof JudgePairResult>;

/** Win-tie-loss cell for the Results matrix (row vs column). */
export const WtlCell = z.object({
  w: z.number(),
  t: z.number(),
  l: z.number(),
  reversalFlagged: z.boolean().default(false),
});
export type WtlCell = z.infer<typeof WtlCell>;
