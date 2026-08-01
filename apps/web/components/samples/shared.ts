import type { SampleResult } from "@model-lab/schemas";

/** A sample enriched server-side with endpoint/model display metadata. */
export type SampleRowData = {
  sample: SampleResult;
  modelId: string;
  /** Model identity color (square dots only — never encodes status). */
  color: string;
  /** "anthropic" or "ollama · local" — detail header meta line. */
  providerLabel: string;
  isLocal: boolean;
  /** "ollama · local · RTX 4090" — metadata endpoint row. */
  endpointLabel: string;
};

/** "9.4" | "failed" | "—" (no score recorded). */
export function scoreText(sample: SampleResult): string {
  if (sample.score == null) return "—";
  return "failed" in sample.score ? "failed" : sample.score.value.toFixed(1);
}

export function isFailed(sample: SampleResult): boolean {
  return sample.status === "failed";
}

/** Endpoint ids contain "/" — encode for URLs by swapping to "~". */
export function encodeEndpointId(id: string): string {
  return id.replace(/\//g, "~");
}
