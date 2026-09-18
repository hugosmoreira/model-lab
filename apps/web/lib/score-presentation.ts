import type { RunModel } from "@model-lab/schemas";

export type ScoreSource = "human" | "browser" | "objective" | "rubric" | "unknown";

export const SCORE_LABELS: Record<ScoreSource, string> = {
  human: "Human visual",
  browser: "Browser capability",
  objective: "Objective accuracy",
  rubric: "Judge rubric",
  unknown: "Unspecified source",
};

/** A configured scorer does not establish the provenance of an individual value. */
export function modelScoreSource(model: Pick<RunModel, "visualSource">): ScoreSource {
  return model.visualSource ?? "unknown";
}

/** Mixed methods may share a scale, but must not imply one comparable measurement. */
export function scoreAxisLabel(sources: readonly ScoreSource[]): string {
  const unique = [...new Set(sources)];
  return unique.length === 1 ? SCORE_LABELS[unique[0]!] : "Score (sources vary)";
}
