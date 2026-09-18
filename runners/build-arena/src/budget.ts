import type { EndpointConfig, GenerateRequest } from "./types";

export class BudgetAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetAdmissionError";
  }
}

export interface TokenPrices {
  input: number;
  output: number;
}

export function endpointPrices(endpoint: EndpointConfig): TokenPrices {
  const local = endpoint.baseKind === "mock" || endpoint.baseKind === "ollama";
  const input = endpoint.priceInPerMtokUsd ?? (local ? 0 : NaN);
  const output = endpoint.priceOutPerMtokUsd ?? (local ? 0 : NaN);
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
    throw new BudgetAdmissionError(
      `known non-negative input and output prices required for ${endpoint.id}`,
    );
  }
  return { input, output };
}

export const tokenCost = (prices: TokenPrices, input: number, output: number): number =>
  (input * prices.input + output * prices.output) / 1_000_000;

/**
 * Conservative admission estimate, not an invoice promise. UTF-8 bytes bound
 * text tokenization more cautiously than chars/4, with framing allowance and
 * the full output cap (including reasoning). Captures have a separate reserve.
 * Provider-specific hidden work, fees and incorrect prices still need upstream
 * account limits; reported usage is never clamped to this estimate.
 */
export function reserveCost(request: GenerateRequest, prices: TokenPrices): number {
  if (
    !Number.isFinite(prices.input) ||
    prices.input < 0 ||
    !Number.isFinite(prices.output) ||
    prices.output < 0
  ) {
    throw new BudgetAdmissionError("known non-negative token prices required");
  }
  const text =
    request.prompt +
    (request.system ?? "") +
    (request.images ?? []).map((image) => image.label).join("");
  const input = Buffer.byteLength(text, "utf8") + 256 + (request.images?.length ?? 0) * 4096;
  if (!Number.isFinite(request.maxTokens) || request.maxTokens <= 0) {
    throw new BudgetAdmissionError("positive finite output token limit required");
  }
  const cost = tokenCost(prices, input, request.maxTokens);
  if (!Number.isFinite(cost)) throw new BudgetAdmissionError("invalid budget reservation");
  return cost;
}

export interface BudgetReservation {
  readonly id: number;
  readonly usd: number;
}

/** Synchronous reservation before any await makes concurrent admission atomic. */
export class BudgetLedger {
  readonly ceilingUsd: number;
  spentUsd = 0;
  uncertainUsd = 0;
  private nextId = 1;
  private reservations = new Map<number, number>();

  constructor(ceilingUsd: number, alreadySpentUsd = 0) {
    if (
      !Number.isFinite(ceilingUsd) ||
      ceilingUsd <= 0 ||
      !Number.isFinite(alreadySpentUsd) ||
      alreadySpentUsd < 0
    ) {
      throw new BudgetAdmissionError("positive finite budget ceiling required");
    }
    this.ceilingUsd = ceilingUsd;
    this.spentUsd = alreadySpentUsd;
  }

  get reservedUsd(): number {
    return [...this.reservations.values()].reduce((sum, cost) => sum + cost, 0);
  }
  get committedUsd(): number {
    return this.spentUsd + this.uncertainUsd + this.reservedUsd;
  }

  reserve(usd: number): BudgetReservation {
    if (!Number.isFinite(usd) || usd < 0 || this.committedUsd + usd > this.ceilingUsd + 1e-12) {
      throw new BudgetAdmissionError(
        `next call cannot fit the remaining $${Math.max(0, this.ceilingUsd - this.committedUsd).toFixed(4)} budget`,
      );
    }
    const reservation = { id: this.nextId++, usd };
    this.reservations.set(reservation.id, usd);
    return reservation;
  }

  settle(reservation: BudgetReservation, cost: number, completeReportedUsage: boolean): void {
    if (!this.reservations.delete(reservation.id))
      throw new Error("budget reservation already settled");
    if (!Number.isFinite(cost) || cost < 0) throw new Error("invalid settled cost");
    this.spentUsd += cost;
    // A failed response or missing final usage can still be billed. Do not
    // release that allowance into a retry; keep uncertainty separate from spend.
    if (!completeReportedUsage) this.uncertainUsd += Math.max(0, reservation.usd - cost);
  }
}
