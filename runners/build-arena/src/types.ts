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

export const RUNNER_VERSION = "build-arena-runner v0.2.0-rc.2";

export type BaseKind = "anthropic" | "openai-compatible" | "ollama" | "mock";

/** A model endpoint as configured for one run. */
export interface EndpointConfig {
  id: string; // "anthropic/claude-sonnet-4-6"
  providerId: string; // "anthropic"
  modelId: string; // "claude-sonnet-4-6"
  baseKind: BaseKind;
  /** provider-facing model name (may differ from modelId, e.g. openrouter) */
  model: string;
  priceInPerMtokUsd: number | null; // null is free only for mock/local endpoints
  priceOutPerMtokUsd: number | null;
  supportsSeed: boolean;
  /** explicit base URL override (openai-compatible / ollama) */
  baseUrl?: string;
  /** quantization tag for local models, e.g. "q4_K_M" — provenance only */
  quantization?: string;
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
  maxBudgetUsd: number; // conservative pre-call admission ceiling; provider invoices remain authoritative
  transportRetries: number; // per-sample transport retries (generation retries: none)
  /** mock provider only: force one (endpoint, sample) to emit a broken artifact */
  failSample?: { endpointId: string; sampleIndex: number };
  /** build-arena only: LLM-judge phase after all samples complete */
  judge?: JudgeConfig;
}

/**
 * Why a generation stopped. "length" means the provider truncated the answer
 * at our maxTokens cap — the model was cut off, it did not choose to stop.
 * Adapters normalize provider spellings (Anthropic "max_tokens" → "length").
 */
export type FinishReason = "stop" | "length" | "content_filter" | "other";

/** Streaming chunks every provider adapter emits: deltas, then one usage. */
export type ProviderChunk =
  | { type: "delta"; text: string }
  | {
      type: "usage";
      tokensIn: number;
      tokensOut: number;
      /** Missing usage is estimated, never silently represented as provider-reported. */
      usageSource?: "reported" | "estimated";
      /** False for intermediate/partial records; only final usage releases a reservation. */
      usageComplete?: boolean;
      /** null when the provider reported none */
      finishReason?: FinishReason | null;
      /** hidden reasoning tokens billed inside tokensOut (0 when none/unknown) */
      reasoningTokens?: number;
      /**
       * The model identifier the provider says it served — a dated snapshot
       * behind an alias, or the alias itself. null when the API reports none.
       */
      servedModel?: string | null;
    };

/** A rendered capture attached to a request, for judges that can see. */
export interface RequestImage {
  /** "image/png" — the only type the checks runner produces today */
  mediaType: string;
  dataBase64: string;
  /** shown to the model so it knows which build a capture belongs to */
  label: string;
}

export interface GenerateRequest {
  system?: string;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /**
   * Images precede the prompt text in the assembled message. Providers that
   * cannot accept them must throw rather than silently drop them — a judge
   * that believes it saw a screenshot and did not would produce exactly the
   * mislabeled "visual" score this field exists to eliminate.
   */
  images?: RequestImage[];
  seed?: number;
  signal?: AbortSignal;
  /** Internal admission hook before a provider adapter repeats its HTTP request. */
  beforeRetry?: () => void;
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

/**
 * Where a run actually executed — the provenance a fingerprint cannot carry,
 * because two identical configurations can run on different machines against
 * different model snapshots.
 */
export interface RunEnvironment {
  /** process.version, e.g. "v22.20.0" */
  node: string;
  /** "win32 x64 10.0.26200" */
  platform: string;
  /** RUNNER_VERSION */
  runner: string;
  /** "chromium 141.0.7390.37" once the browser checks launched; null when they never ran */
  chromium: string | null;
  /** endpoint id → model identifier the provider reported serving */
  servedModels: Record<string, string>;
  /** MODEL_LAB_LOCAL_HARDWARE as the operator set it, e.g. "RTX 4090 · 24 GB"; null when unset */
  localHardware: string | null;
  /** endpoint id → quantization tag from the registry, for the local models that have one */
  quantizations: Record<string, string>;
  /** ISO timestamp of the run start */
  recordedAt: string;
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
  /** absent in snapshots written before provenance was recorded */
  environment?: RunEnvironment;
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
