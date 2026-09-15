import { z } from "zod";

export const RunMode = z.enum(["build-arena", "verified", "performance", "head-to-head", "custom"]);
export type RunMode = z.infer<typeof RunMode>;

export const RunStatus = z.enum([
  "queued",
  "running",
  "paused",
  "partial",
  "completed",
  "cancelled",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const ScorerType = z.enum(["objective", "browser", "llm-judge", "human", "hybrid"]);
export type ScorerType = z.infer<typeof ScorerType>;

export const ScorerConfig = z.object({
  type: ScorerType,
  name: z.string(), // "Browser checks — 12 assertions"
  rubricVersion: z.string().nullable().default(null),
  orderSwapped: z.boolean().default(false), // judge only
  enabled: z.boolean().default(true),
});
export type ScorerConfig = z.infer<typeof ScorerConfig>;

export const RunConfiguration = z.object({
  temperature: z.number(),
  maxOutputTokens: z.number(),
  seed: z.number().nullable(), // null = unseeded run-wide
  samplesPerModel: z.number(),
  concurrency: z.number(),
  /** scope is explicit — fixes the prototype's "1 retry" vs "none (first-shot)" conflict */
  retryPolicy: z.object({
    generation: z.enum(["none"]).default("none"), // first-shot only in MVP
    transportRetries: z.number().default(1),
  }),
  maxBudgetUsd: z.number(),
  toolAccess: z.boolean().default(false),
  artifactNetworkPolicy: z.enum(["blocked"]).default("blocked"),
  saveReasoningMetadata: z.boolean().default(true),
  scorers: z.array(ScorerConfig),
  /** rule-generated provenance caveats, e.g. "qwen3-coder-32b (ollama) runs unseeded" */
  configDifferences: z.array(z.string()).default([]),
});
export type RunConfiguration = z.infer<typeof RunConfiguration>;

export const RunModelStatus = z.enum([
  "queued",
  "generating",
  "testing",
  "scoring",
  "completed",
  "failed",
]);
export type RunModelStatus = z.infer<typeof RunModelStatus>;

/** One endpoint's participation in one run. */
export const RunModel = z.object({
  runId: z.string(),
  endpointId: z.string(),
  status: RunModelStatus,
  /** failed samples do NOT make the model failed; the run keeps going */
  failedSampleCount: z.number().default(0),
  progressPct: z.number(),
  currentTask: z.string().nullable().default(null),
  tokensOut: z.number().default(0),
  ttftMs: z.number().nullable().default(null),
  totalLatencyMs: z.number().nullable().default(null),
  costUsd: z.number().default(0),
  visualScore: z.object({ value: z.number(), n: z.number() }).nullable().default(null),
  testsPassed: z.number().nullable().default(null),
  testsTotal: z.number().nullable().default(null),
  retries: z.number().default(0),
  unseeded: z.boolean().default(false),
  flag: z.string().nullable().default(null), // "best visual" | "all tests pass" | ...
});
export type RunModel = z.infer<typeof RunModel>;

export const Run = z.object({
  id: z.string(), // "run_8f3ac21e"
  /** content-addressed config hash — distinct from id (audit §7) */
  fingerprint: z.string(),
  name: z.string(),
  mode: RunMode,
  status: RunStatus,
  pack: z.object({ slug: z.string(), version: z.string() }),
  promptHash: z.string(),
  samplesPerModel: z.number(),
  modelCount: z.number(),
  budgetCeilingUsd: z.number(),
  costSpentUsd: z.number(),
  estCostRangeUsd: z.tuple([z.number(), z.number()]).nullable().default(null),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  elapsedSec: z.number().nullable().default(null),
  runnerVersion: z.string(),
  gitCommit: z.string().nullable().default(null),
  compositeWeighting: z
    .object({ browser: z.number(), visual: z.number(), efficiency: z.number() })
    .default({ browser: 50, visual: 35, efficiency: 15 }),
  verdict: z.object({ label: z.string(), narrative: z.string() }).nullable().default(null),
  judgeReversalCount: z.number().default(0),
});
export type Run = z.infer<typeof Run>;

export const CheckStatus = z.enum(["passed", "failed", "skipped", "warn"]);

/**
 * What a check is FOR — the three kinds answer different questions and must
 * never be averaged together:
 *  - "gate"       correctness precondition (html.parses, page.loads,
 *                 console.clean, canvas.renders). A failed gate means the
 *                 artifact is broken; the headline score is 0 regardless of
 *                 what else passed.
 *  - "capability" did the model build what the brief asked for
 *                 (interaction.*, minimap.present, textures.applied,
 *                 resize.handled). THIS is the headline score.
 *  - "diagnostic" measures the harness / rendering environment rather than the
 *                 artifact (screenshot.captured, fps.stable, a11y.contrast).
 *                 Reported, never scored.
 */
export const CheckCategory = z.enum(["gate", "capability", "diagnostic"]);
export type CheckCategory = z.infer<typeof CheckCategory>;

export const BrowserTestResult = z.object({
  name: z.string(), // namespaced: "html.parses", "interaction.wasd", ...
  status: CheckStatus,
  note: z.string().default(""),
  durationMs: z.number().nullable().default(null),
  /**
   * Defaulted on purpose: traces stored before the taxonomy existed are jsonb
   * and must keep parsing, so no DB migration is required. Historical rows
   * read back as "capability", which is what the old flat score treated every
   * check as.
   */
  category: CheckCategory.default("capability"),
});
export type BrowserTestResult = z.infer<typeof BrowserTestResult>;

export const SampleStatus = z.enum([
  "queued",
  "generating",
  "testing",
  "scoring",
  "scored",
  "failed",
]);

export const SampleScore = z.union([
  z.object({ value: z.number() }),
  z.object({ failed: z.literal(true) }),
]);
export type SampleScore = z.infer<typeof SampleScore>;

export const SampleResult = z.object({
  runId: z.string(),
  endpointId: z.string(),
  sampleIndex: z.number(), // 1-based within model
  globalIndex: z.number(), // 1-based within run
  status: SampleStatus,
  score: SampleScore.nullable().default(null), // primary display score
  primaryScorer: ScorerType.nullable().default(null),
  costUsd: z.number(),
  latencyMs: z.number().nullable().default(null),
  ttftMs: z.number().nullable().default(null),
  seed: z.number().nullable(), // null = unseeded (unsupported)
  hasArtifact: z.boolean().default(false),
  tokensOut: z.number().nullable().default(null),
  /** immutable raw output reference (path/URL); excerpt inlined for fixtures */
  rawExcerpt: z.string().default(""),
  scorerTrace: z.array(BrowserTestResult).default([]),
  judgeReversed: z.boolean().default(false),
  humanReviewed: z.boolean().default(false),
  humanNote: z.string().nullable().default(null),
});
export type SampleResult = z.infer<typeof SampleResult>;

export const ConsoleLine = z.object({
  t: z.string(), // "0.212s" relative
  level: z.enum(["info", "warn", "error", "muted"]),
  msg: z.string(),
});
export type ConsoleLine = z.infer<typeof ConsoleLine>;

export const Artifact = z.object({
  runId: z.string(),
  endpointId: z.string(),
  sampleIndex: z.number(),
  path: z.string(), // "artifacts/8f3a/sonnet-4-6/raycaster.html"
  filename: z.string(),
  sizeKb: z.number(),
  renderOk: z.boolean(),
  isBestOfModel: z.boolean().default(false),
  source: z.string(), // single-file HTML (fixture: excerpt)
  screenshotRef: z.string().nullable().default(null),
  consoleLines: z.array(ConsoleLine).default([]),
  checks: z.array(BrowserTestResult).default([]),
  judgeCommentary: z.string().nullable().default(null),
  sandbox: z.object({
    isolatedOrigin: z.boolean(),
    networkBlocked: z.boolean(),
    execLimitSec: z.number(),
    sizeLimitMb: z.number(),
  }),
});
export type Artifact = z.infer<typeof Artifact>;

export const HumanAnnotation = z.object({
  runId: z.string(),
  endpointId: z.string(),
  sampleIndex: z.number(),
  note: z.string(),
  scoreOverride: z.number().nullable().default(null),
  author: z.string(),
  at: z.string(), // ISO — audit trail is append-only
});
export type HumanAnnotation = z.infer<typeof HumanAnnotation>;

export const RunManifest = z.object({
  runId: z.string(),
  fingerprint: z.string(),
  benchmark: z.string(), // "raycaster-oneshot v1.3"
  promptHash: z.string(),
  runnerVersion: z.string(),
  date: z.string(), // ISO date of run start
  samplesPerModel: z.number(),
  modelCount: z.number(),
  scorers: z.array(ScorerType),
  gitCommit: z.string().nullable().default(null),
});
export type RunManifest = z.infer<typeof RunManifest>;
