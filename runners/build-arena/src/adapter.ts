/**
 * BuildArenaAdapter — the language-agnostic runner adapter boundary
 * (audit §13.2): listModels · validateConfiguration · estimateRun · startRun
 * · loadResults · exportBundle. Event streaming + cancel live on the
 * RunHandle returned by startRun.
 */
import { exportBundle } from "./bundle";
import { endpointPrices } from "./budget";
import { startRun, type StartRunOptions } from "./run";
import { FsRunStore, sanitizeSegment } from "./store-fs";
import type {
  BundleResult,
  ModelListing,
  RunEstimate,
  RunHandle,
  RunnerAdapter,
  RunnerConfig,
  StoredRunResults,
  ValidationIssue,
  ValidationResult,
} from "./types";

const BASE_KINDS = ["anthropic", "openai-compatible", "ollama", "mock"] as const;

/** Default per-model output estimate (matches the pack's estOutputTokensPerModel). */
export const EST_OUTPUT_TOKENS_PER_MODEL = 20_000;

/** Verified mode: estimated output tokens per objective task (short answers). */
export const EST_OUTPUT_TOKENS_PER_TASK_VERIFIED = 200;

export class BuildArenaAdapter implements RunnerAdapter {
  private readonly store: FsRunStore;

  constructor(store?: FsRunStore) {
    this.store = store ?? new FsRunStore();
  }

  /** Static catalog with env-derived availability. Never performs network IO. */
  listModels(): Promise<ModelListing[]> {
    const env = process.env;
    const has = (key: string): boolean => env[key] !== undefined && env[key] !== "";
    const ollamaBase = env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1";
    const listings: ModelListing[] = [
      {
        endpointId: "mock/mock-raycaster",
        providerId: "mock",
        modelId: "mock-raycaster",
        baseKind: "mock",
        model: "mock-raycaster-v1",
        available: true,
        note: "deterministic keyless provider for E2E tests",
      },
      {
        endpointId: "anthropic/claude-sonnet-4-6",
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        baseKind: "anthropic",
        model: "claude-sonnet-4-6",
        available: has("ANTHROPIC_API_KEY"),
        note: has("ANTHROPIC_API_KEY") ? "" : "set ANTHROPIC_API_KEY",
      },
      {
        endpointId: "openai/gpt-5.2-mini",
        providerId: "openai",
        modelId: "gpt-5.2-mini",
        baseKind: "openai-compatible",
        model: "gpt-5.2-mini",
        available: has("OPENAI_API_KEY"),
        note: has("OPENAI_API_KEY") ? "" : "set OPENAI_API_KEY",
      },
      {
        endpointId: "openrouter/gemini-3-flash",
        providerId: "openrouter",
        modelId: "gemini-3-flash",
        baseKind: "openai-compatible",
        model: "google/gemini-3-flash",
        available: has("OPENROUTER_API_KEY"),
        note: has("OPENROUTER_API_KEY") ? "" : "set OPENROUTER_API_KEY",
      },
      {
        endpointId: "ollama/qwen3-coder-32b",
        providerId: "ollama",
        modelId: "qwen3-coder-32b",
        baseKind: "ollama",
        model: "qwen3-coder-32b",
        available: true,
        note: `assumes local server at ${ollamaBase}`,
      },
    ];
    return Promise.resolve(listings);
  }

  validateConfiguration(cfg: RunnerConfig): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const error = (field: string, message: string): void => {
      errors.push({ field, message });
    };
    const warn = (field: string, message: string): void => {
      warnings.push({ field, message });
    };

    if (cfg.runId.trim() === "") error("runId", "must not be empty");
    else if (sanitizeSegment(cfg.runId) !== cfg.runId) {
      error("runId", "contains unsafe path characters");
    } else if (!/^run_[a-z0-9]{4,}$/i.test(cfg.runId)) {
      warn("runId", 'does not match the "run_<hex>" convention');
    }
    if (cfg.name.trim() === "") warn("name", "run name is empty");
    if (cfg.pack.prompt.trim() === "") error("pack.prompt", "challenge prompt must not be empty");
    const verified = cfg.mode === "verified";
    if (!verified && cfg.pack.browserCheckCount !== 12) {
      warn("pack.browserCheckCount", `expected 12 checks, got ${cfg.pack.browserCheckCount}`);
    }
    if (verified) {
      const tasks = cfg.pack.tasks ?? [];
      if (tasks.length === 0) error("pack.tasks", "verified mode requires at least one task");
      const seenTasks = new Set<string>();
      tasks.forEach((task, i) => {
        const field = `pack.tasks[${i}]`;
        if (task.id.trim() === "") error(field, "task id must not be empty");
        else if (seenTasks.has(task.id)) error(field, `duplicate task id "${task.id}"`);
        seenTasks.add(task.id);
        if (task.prompt.trim() === "") error(field, "task prompt must not be empty");
        if (task.scorer === "json-field") {
          if (task.jsonField === undefined) {
            error(field, "json-field task needs a jsonField {path, expected} expectation");
          }
        } else if (task.expected === undefined || task.expected.trim() === "") {
          error(field, `${task.scorer} task needs an expected answer`);
        }
      });
    } else if (cfg.pack.tasks !== undefined && cfg.pack.tasks.length > 0) {
      warn("pack.tasks", "task list is ignored outside verified mode");
    }
    if (cfg.endpoints.length === 0) error("endpoints", "at least one endpoint is required");
    if (cfg.endpoints.length > 8)
      warn("endpoints", `${cfg.endpoints.length} endpoints is a large run`);
    const seen = new Set<string>();
    for (const ep of cfg.endpoints) {
      const field = `endpoints[${ep.id}]`;
      if (seen.has(ep.id)) error(field, "duplicate endpoint id");
      seen.add(ep.id);
      if (!(BASE_KINDS as readonly string[]).includes(ep.baseKind)) {
        error(field, `unknown baseKind "${ep.baseKind as string}"`);
      }
      if (ep.model.trim() === "") error(field, "model must not be empty");
      try {
        endpointPrices(ep);
      } catch {
        error(
          field,
          "finite non-negative input and output prices required; null is free only for mock/Ollama endpoints",
        );
      }
      if (ep.baseKind === "anthropic" && (process.env["ANTHROPIC_API_KEY"] ?? "") === "") {
        warn(field, "ANTHROPIC_API_KEY is not set — generation will fail at run time");
      }
      if (cfg.seed !== null && !ep.supportsSeed) {
        warn(field, `${ep.modelId} (${ep.providerId}) runs unseeded — provider lacks seed support`);
      }
    }
    if (cfg.samplesPerModel < 1) error("samplesPerModel", "must be ≥ 1");
    if (cfg.samplesPerModel > 10) warn("samplesPerModel", "more than 10 samples per model");
    if (cfg.temperature < 0 || cfg.temperature > 2) error("temperature", "must be within [0, 2]");
    if (!Number.isSafeInteger(cfg.maxOutputTokens) || cfg.maxOutputTokens <= 0)
      error("maxOutputTokens", "must be a positive integer");
    else if (!verified && cfg.maxOutputTokens < 4_000) {
      warn("maxOutputTokens", "under 4k tokens the raycaster artifact may truncate");
    }
    if (cfg.concurrency < 1) error("concurrency", "must be ≥ 1");
    if (!Number.isFinite(cfg.maxBudgetUsd) || cfg.maxBudgetUsd <= 0)
      error("maxBudgetUsd", "must be finite and > 0");
    if (
      cfg.judge !== undefined &&
      (!Number.isFinite(cfg.judge.priceInPerMtokUsd) ||
        cfg.judge.priceInPerMtokUsd < 0 ||
        !Number.isFinite(cfg.judge.priceOutPerMtokUsd) ||
        cfg.judge.priceOutPerMtokUsd < 0)
    ) {
      error("judge", "finite non-negative input and output prices required");
    }
    if (cfg.transportRetries < 0) error("transportRetries", "must be ≥ 0");
    if (cfg.failSample !== undefined) {
      const known = cfg.endpoints.some((ep) => ep.id === cfg.failSample?.endpointId);
      if (!known) warn("failSample", "endpointId does not match any configured endpoint");
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  estimateRun(cfg: RunnerConfig): RunEstimate {
    const verified = cfg.mode === "verified";
    const tasks = cfg.pack.tasks ?? [];
    const samplesPerEndpoint = verified ? tasks.length : cfg.samplesPerModel;
    const totalSamples = cfg.endpoints.length * samplesPerEndpoint;
    // verified: mean task prompt length; arena: the single challenge prompt
    const estTokensInPerSample =
      verified && tasks.length > 0
        ? Math.ceil(tasks.reduce((acc, t) => acc + t.prompt.length, 0) / tasks.length / 4) + 64
        : Math.ceil(cfg.pack.prompt.length / 4) + 64;
    const estOutputTokensPerModel = verified
      ? tasks.length * EST_OUTPUT_TOKENS_PER_TASK_VERIFIED
      : Math.min(EST_OUTPUT_TOKENS_PER_MODEL, cfg.maxOutputTokens * cfg.samplesPerModel);
    const perEndpoint = cfg.endpoints.map((ep) => {
      const priceIn = ep.priceInPerMtokUsd ?? 0;
      const priceOut = ep.priceOutPerMtokUsd ?? 0;
      const estCostUsd =
        (estTokensInPerSample * samplesPerEndpoint * priceIn + estOutputTokensPerModel * priceOut) /
        1_000_000;
      return { endpointId: ep.id, estCostUsd: Math.round(estCostUsd * 10_000) / 10_000 };
    });
    const total = perEndpoint.reduce((acc, e) => acc + e.estCostUsd, 0);
    const low = Math.round(total * 0.8 * 100) / 100;
    const high = Math.round(total * 1.25 * 100) / 100;
    const waves = Math.ceil(cfg.endpoints.length / Math.max(1, cfg.concurrency));
    return {
      totalSamples,
      estTokensInPerSample,
      estOutputTokensPerModel,
      perEndpoint,
      estCostRangeUsd: [low, high],
      // arena ~45s/sample incl. checks; verified ~10s/task (no browser)
      estDurationSec: waves * samplesPerEndpoint * (verified ? 10 : 45),
      withinBudget: high <= cfg.maxBudgetUsd,
    };
  }

  startRun(cfg: RunnerConfig, options: StartRunOptions = {}): RunHandle {
    const validation = this.validateConfiguration(cfg);
    if (!validation.ok) {
      throw new Error(
        `invalid configuration: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
    return startRun(cfg, { store: this.store, ...options });
  }

  loadResults(runId: string): Promise<StoredRunResults | null> {
    return Promise.resolve(this.store.loadSnapshot(runId));
  }

  exportBundle(runId: string): Promise<BundleResult> {
    return exportBundle(runId, this.store);
  }
}

export function createBuildArenaAdapter(store?: FsRunStore): BuildArenaAdapter {
  return new BuildArenaAdapter(store);
}
