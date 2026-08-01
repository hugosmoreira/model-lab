/**
 * New Run cost estimator — Phase 0 documented formula.
 *
 * Per endpoint (cloud):
 *   cost(k) = samples × ( (EST_INPUT_TOKENS_PER_CALL / 1e6) × priceInPerMtokUsd
 *                       + (packEstOutputTokens × k / 1e6)   × priceOutPerMtokUsd )
 * with k = 1 − OUTPUT_TOKEN_VARIANCE for the low bound and 1 + OUTPUT_TOKEN_VARIANCE
 * for the worst case. Local endpoints (null prices) cost $0. Input size is fixed by
 * the pack prompt, so the ±20% variance applies to output tokens only.
 */
import type { ModelEndpoint } from "@model-lab/schemas";

/** Prompt-side token estimate per call (pack prompt + harness overhead). */
export const EST_INPUT_TOKENS_PER_CALL = 2000;

/**
 * Verified Benchmark mode: estimated output tokens per objective task (short
 * answers). Per-model output estimate = taskCount × this constant — mirrors
 * EST_OUTPUT_TOKENS_PER_TASK_VERIFIED in the runner adapter.
 */
export const VERIFIED_EST_OUTPUT_TOKENS_PER_TASK = 200;

/** Output-token uncertainty applied to the pack's estOutputTokensPerModel. */
export const OUTPUT_TOKEN_VARIANCE = 0.2;

export interface EstRange {
  low: number;
  high: number;
}

type PricedEndpoint = Pick<ModelEndpoint, "priceInPerMtokUsd" | "priceOutPerMtokUsd">;

export function endpointCostRange(
  ep: PricedEndpoint,
  samples: number,
  estOutputTokens: number,
): EstRange {
  const pIn = ep.priceInPerMtokUsd;
  const pOut = ep.priceOutPerMtokUsd;
  if (pIn == null || pOut == null) return { low: 0, high: 0 }; // local — free
  const at = (k: number) =>
    samples *
    ((EST_INPUT_TOKENS_PER_CALL / 1e6) * pIn + ((estOutputTokens * k) / 1e6) * pOut);
  return { low: at(1 - OUTPUT_TOKEN_VARIANCE), high: at(1 + OUTPUT_TOKEN_VARIANCE) };
}

export function totalCostRange(
  endpoints: readonly PricedEndpoint[],
  samples: number,
  estOutputTokens: number,
): EstRange {
  return endpoints.reduce<EstRange>(
    (acc, ep) => {
      const r = endpointCostRange(ep, samples, estOutputTokens);
      return { low: acc.low + r.low, high: acc.high + r.high };
    },
    { low: 0, high: 0 },
  );
}

/** Total token estimate: calls × (fixed input + output ±variance). */
export function tokenRange(
  modelCount: number,
  samples: number,
  estOutputTokens: number,
): EstRange {
  const calls = modelCount * samples;
  return {
    low: calls * (EST_INPUT_TOKENS_PER_CALL + estOutputTokens * (1 - OUTPUT_TOKEN_VARIANCE)),
    high: calls * (EST_INPUT_TOKENS_PER_CALL + estOutputTokens * (1 + OUTPUT_TOKEN_VARIANCE)),
  };
}

/** "400k ctx" / "1M ctx" / "10M ctx". */
export function ctxLabel(tokens: number): string {
  return tokens >= 1_000_000
    ? `${tokens / 1_000_000}M ctx`
    : `${Math.round(tokens / 1000)}k ctx`;
}

/** "$3 / $15 per Mtok" — null prices render "$0.00 (local)". */
export function priceLabel(ep: PricedEndpoint): string {
  if (ep.priceInPerMtokUsd == null || ep.priceOutPerMtokUsd == null) return "$0.00 (local)";
  return `$${ep.priceInPerMtokUsd} / $${ep.priceOutPerMtokUsd} per Mtok`;
}

/** "216k" for token totals. */
export function kTokens(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

/** "16 000" — space-grouped integer (prototype convention). */
export function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
