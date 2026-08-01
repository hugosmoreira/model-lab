/**
 * Human visual-score derivations (scoring contract §3).
 *
 * A "scored annotation" is a HumanAnnotation with `scoreOverride` set (0–10,
 * one decimal). Per (endpointId, sampleIndex) the LATEST scored annotation
 * wins — `listAnnotations` returns append order, so last-in-list is latest.
 * Per-endpoint visual = mean over samples of that latest override; n = the
 * number of samples with at least one scored annotation.
 *
 * CLIENT-SAFE — pure functions over schemas types only. The Artifact rating
 * panel and the server loaders share these rules so the "your rating" readout
 * always matches the derived RunModel.visualScore.
 */
import type { HumanAnnotation } from "@model-lab/schemas";

export interface HumanVisualScore {
  /** Mean of the latest per-sample overrides, rounded to one decimal. */
  value: number;
  /** Number of samples with at least one scored annotation. */
  n: number;
}

/** Composite map key — endpoint ids never contain "::". */
export function sampleKey(endpointId: string, sampleIndex: number): string {
  return `${endpointId}::${sampleIndex}`;
}

/** Latest scoreOverride per (endpointId, sampleIndex); append order, last wins. */
export function latestOverrideBySample(
  annotations: readonly HumanAnnotation[],
): Map<string, { endpointId: string; sampleIndex: number; score: number }> {
  const latest = new Map<string, { endpointId: string; sampleIndex: number; score: number }>();
  for (const a of annotations) {
    if (a.scoreOverride == null) continue;
    latest.set(sampleKey(a.endpointId, a.sampleIndex), {
      endpointId: a.endpointId,
      sampleIndex: a.sampleIndex,
      score: a.scoreOverride,
    });
  }
  return latest;
}

/** Derived per-endpoint visual score — empty map when nothing is scored yet. */
export function humanVisualByEndpoint(
  annotations: readonly HumanAnnotation[],
): Map<string, HumanVisualScore> {
  const byEndpoint = new Map<string, number[]>();
  for (const { endpointId, score } of latestOverrideBySample(annotations).values()) {
    const scores = byEndpoint.get(endpointId) ?? [];
    scores.push(score);
    byEndpoint.set(endpointId, scores);
  }
  const out = new Map<string, HumanVisualScore>();
  for (const [endpointId, scores] of byEndpoint) {
    const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length;
    out.set(endpointId, { value: Math.round(mean * 10) / 10, n: scores.length });
  }
  return out;
}
