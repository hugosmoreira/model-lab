/**
 * Native Build Arena runner — shared types.
 * Node-only (no Next/React imports). Implements the language-agnostic adapter
 * boundary from docs/REPO_AUDIT_AND_FRONTEND_PLAN.md §13.2.
 *
 * All @model-lab/schemas imports across this package are type-only, so the
 * runner has zero runtime dependency on the schemas package.
 */
import type {
  BrowserTestResult,
  ConsoleLine,
  JudgePairResult,
  Run,
  RunEvent,
  RunMode,
  RunModel,
  SampleResult,
} from "@model-lab/schemas";

export const RUNNER_VERSION = "build-arena-runner v0.1.0";

export type BaseKind = "anthropic" | "openai-compatible" | "ollama" | "mock";

/** A model endpoint as configured for one run. */
export interface EndpointConfig {
  id: string; // "anthropic/claude-sonnet-4-6"
  providerId: string; // "anthropic"
  modelId: string; // "claude-sonnet-4-6"
  baseKind: BaseKind;
  /** provider-facing model name (may differ from modelId, e.g. openrouter) */
  model: string;
  priceInPerMtokUsd: number | null; // null => free/local, accounted as $0
  priceOutPerMtokUsd: number | null;
  supportsSeed: boolean;
  /** explicit base URL override (openai-compatible / ollama) */
  baseUrl?: string;
}

/** Objective scorer kinds for verified-benchmark tasks. */
export type TaskScorer = "exact-match" | "contains" | "json-field";

/** One objective task in a verified-benchmark (eval) pack. */
export interface Task {
  id: string;
  /** sent verbatim as the user prompt for this task's sample */
  prompt: string;
  /** exact-match / contains expectation */
  expected?: string;
  scorer: TaskScorer;
  /** json-field expectation: dot-path into the parsed JSON output */
  jsonField?: { path: string; expected: string };
}

export interface PackConfig {
  slug: string; // "raycaster-oneshot"
  version: string; // "v1.3"
  prompt: string; // the challenge text sent verbatim as the user prompt
  browserCheckCount: number; // 12 (0 for verified/eval packs)
  /** verified mode: objective task list — ignored in build-arena mode */
  tasks?: Task[];
}

/**
 * LLM-as-judge configuration. Absent = no judging. Judge calls go through the
 * anthropic provider; token usage is charged into the run cost at these prices.
 */
export interface JudgeConfig {
  model: string; // e.g. "claude-sonnet-4-6"
  priceInPerMtokUsd: number;
  priceOutPerMtokUsd: number;
}

export interface RunnerConfig {
  runId: string; // "run_8f3ac21e"
  name: string;
  mode: RunMode;
  pack: PackConfig;
  endpoints: EndpointConfig[];
  samplesPerModel: number;
  temperature: number;
  maxOutputTokens: number;
  seed: number | null; // null = unseeded run-wide
  concurrency: number; // endpoints in parallel; samples per endpoint are sequential
  maxBudgetUsd: number; // HARD ceiling — projected overrun stops the run
  transportRetries: number; // per-sample transport retries (generation retries: none)
  /** mock provider only: force one (endpoint, sample) to emit a broken artifact */
  failSample?: { endpointId: string; sampleIndex: number };
  /** build-arena only: LLM-judge phase after all samples complete */
  judge?: JudgeConfig;
}

/** Streaming chunks every provider adapter emits: deltas, then one usage. */
export type ProviderChunk =
  | { type: "delta"; text: string }
  | { type: "usage"; tokensIn: number; tokensOut: number };

export interface GenerateRequest {
  system?: string;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  seed?: number;
  signal?: AbortSignal;
  /** mock determinism: output varies per (model, sampleIndex) */
  sampleIndex?: number;
  /** mock failure path: emit the null-canvas-bug artifact */
  injectFailure?: boolean;
  /** verified mode: the task backing this sample (the mock echoes its expectation) */
  task?: Task;
  /** mock determinism: verified mode — emit a deliberately wrong answer */
  answerWrong?: boolean;
}

export interface Provider {
  readonly kind: BaseKind;
  generate(req: GenerateRequest): AsyncGenerator<ProviderChunk, void, void>;
}

export interface RunOutcome {
  status: "completed" | "partial" | "cancelled";
  spentUsd: number;
  samplesScored: number;
  samplesFailed: number;
}

export interface RunHandle {
  runId: string;
  /** full RunEvent stream (schemas union); ends after the terminal event */
  events: AsyncIterable<RunEvent>;
  cancel(): void;
  pause?(): void;
  resume?(): void;
  /** resolves once the executor has fully finished */
  done: Promise<RunOutcome>;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface EndpointEstimate {
  endpointId: string;
  estCostUsd: number;
}

export interface RunEstimate {
  totalSamples: number;
  estTokensInPerSample: number;
  estOutputTokensPerModel: number;
  perEndpoint: EndpointEstimate[];
  estCostRangeUsd: [number, number];
  estDurationSec: number;
  withinBudget: boolean;
}

export interface ModelListing {
  endpointId: string;
  providerId: string;
  modelId: string;
  baseKind: BaseKind;
  model: string;
  available: boolean;
  note: string;
}

/** Per-sample artifact metadata persisted alongside the run snapshot. */
export interface StoredArtifact {
  endpointId: string;
  sampleIndex: number;
  path: string; // relative to the data root, forward slashes
  filename: string;
  sizeKb: number;
  renderOk: boolean;
  screenshotPath: string | null; // absolute path or null
  consoleLines: ConsoleLine[];
  checks: BrowserTestResult[];
  /** LLM-judge rubric commentary (judge phase; persists to artifacts.judge_commentary) */
  judgeCommentary?: string | null;
}

export interface StoredRunResults {
  run: Run;
  models: RunModel[];
  samples: SampleResult[];
  artifacts: StoredArtifact[];
  config: RunnerConfig;
  /** LLM-judge pairwise verdicts (empty when the run was not judged; may be
   *  absent in snapshots written before the judge phase existed) */
  judgePairs: JudgePairResult[];
}

export interface BundleResult {
  runId: string;
  fingerprint: string;
  dir: string;
  files: string[];
}

/** The runner adapter boundary (audit §13.2). */
export interface RunnerAdapter {
  listModels(): Promise<ModelListing[]>;
  validateConfiguration(cfg: RunnerConfig): ValidationResult;
  estimateRun(cfg: RunnerConfig): RunEstimate;
  startRun(cfg: RunnerConfig): RunHandle;
  loadResults(runId: string): Promise<StoredRunResults | null>;
  exportBundle(runId: string): Promise<BundleResult>;
}
