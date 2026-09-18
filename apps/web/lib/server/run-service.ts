/**
 * Run orchestration service — the in-process bridge between the web app and
 * the native Build Arena runner (Phase 2 integration).
 *
 * SERVER-ONLY. This module imports @model-lab/store (process.env, node:sqlite,
 * Supabase service key) and @model-lab/build-arena-runner (node:fs, fetch,
 * Playwright). Never import it from a client component.
 *
 * Responsibilities:
 *  1. `startRun(input)` — resolve the wizard's endpoint selection against the
 *     schemas registry, build a RunnerConfig, start the native runner, and
 *     register the run in the Phase 1 in-memory registry (so the live page's
 *     server render keeps resolving endpointIds/samplesPerModel unchanged).
 *  2. Pipe every RunEvent the runner emits to
 *       (a) an in-memory ring buffer per run (SSE replay-from-start), and
 *       (b) the persistence store: appendEvent per event, cost patches on
 *           budget.status, and a full snapshot upsert (run/models/samples/
 *           artifacts) once the run reaches a terminal state.
 *  3. `subscribeRun(runId)` — an AsyncIterable<RunEvent> that first yields the
 *     buffered events, then live ones; for finished/stored runs it replays the
 *     persisted event log and ends.
 *
 * Provider keys: this app reads no provider credential itself — the runner
 * resolves ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY /
 * GOOGLE_API_KEY / DEEPSEEK_API_KEY / OLLAMA_BASE_URL from process.env
 * server-side. This module only *checks presence* of those variables to
 * decide mock substitution.
 *
 * Mock substitution (keyless demo fidelity):
 *  - MODEL_LAB_MOCK_PROVIDERS=1 → every selected endpoint runs the deterministic
 *    mock provider (a mock flag must never spend money or hit a network).
 *  - MODEL_LAB_MOCK_PROVIDERS=0 → never substitute (force real providers,
 *    e.g. a local Ollama with no cloud keys).
 *  - unset → auto: substitution is PER-ENDPOINT. Endpoints whose required key is absent (e.g.
 *    deepseek/google before keys exist) run the mock provider — the runner's
 *    model.started message shows "· mock" for those endpoints — while keyed
 *    endpoints and keyless-by-design Ollama run real.
 *  - A mocked qwen-ish endpoint (id/modelId contains "qwen") gets
 *    failSample = { endpointId, sampleIndex: 2 } so the demo's preserved
 *    render-failure path stays exercised.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  Artifact,
  JudgePairResult,
  ModelEndpoint,
  Run,
  RunConfiguration,
  RunEvent,
  RunMode,
  RunStatus,
} from "@model-lab/schemas";
import {
  benchmarkPacks,
  endpoints as endpointCatalog,
  modelDefinitions,
  providers,
  runConfiguration as defaultRunConfiguration,
  workspaceSettings,
} from "@model-lab/schemas/fixtures";
import { getStore, type RunStore } from "@model-lab/store";
import {
  FsRunStore,
  RUNNER_VERSION,
  captureSourceRevision,
  computeFingerprint,
  promptHash,
  startRun as runnerStartRun,
  type BaseKind,
  type EndpointConfig,
  type PackConfig,
  type RunHandle,
  type RunnerConfig,
  type StoredRunResults,
} from "@model-lab/build-arena-runner";
import { registerRun, type RunRecord } from "@/lib/live/run-registry";
import { loadPackFromDisk, tasksForPack } from "@/lib/server/packs";
import { acquireRunLease, reconcileInterruptedRuns, type RunLease } from "./run-recovery";

/** Input contract — matches the wizard's POST /api/runs body (agent A). */
export interface StartRunInput {
  name: string | null;
  mode: RunMode;
  packSlug: string;
  endpointIds: string[];
  samplesPerModel: number;
  /** hard ceiling in USD; the workspace default when omitted */
  maxBudgetUsd?: number;
}

/** Configuration/lookup failures the API maps to HTTP 400. */
export class RunServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunServiceError";
  }
}

/* ------------------------------------------------------------------------- *
 * Event feed: ring buffer + wake-on-push fanout (replay-from-start SSE)
 * ------------------------------------------------------------------------- */

const MAX_BUFFERED_EVENTS = 10_000;

class EventFeed {
  private readonly events: RunEvent[] = [];
  private dropped = 0;
  private finished = false;
  private resolveNext: () => void = () => {};
  private next: Promise<void>;

  constructor() {
    this.next = new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  push(event: RunEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_BUFFERED_EVENTS) {
      this.events.shift();
      this.dropped += 1;
    }
    this.wake();
  }

  finish(): void {
    this.finished = true;
    this.wake();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private wake(): void {
    const resolve = this.resolveNext;
    this.next = new Promise((r) => {
      this.resolveNext = r;
    });
    resolve();
  }

  /** Buffered events first, then live ones; ends after `finish()`. */
  async *stream(): AsyncGenerator<RunEvent, void, void> {
    let cursor = this.dropped; // absolute event index
    for (;;) {
      if (cursor < this.dropped) cursor = this.dropped; // ring overwrote history
      const index = cursor - this.dropped;
      if (index < this.events.length) {
        const event = this.events[index];
        cursor += 1;
        if (event !== undefined) yield event;
        continue;
      }
      if (this.finished) return;
      await this.next;
    }
  }
}

interface ActiveRun {
  record: RunRecord;
  handle: RunHandle;
  feed: EventFeed;
  config: RunnerConfig;
  lease: RunLease | null;
}

/* Survives next-dev module reloads, mirroring lib/live/run-registry. Finished
   runs stay in the map as a fast replay source (buffer is ring-capped). */
const globalStash = globalThis as typeof globalThis & {
  __modelLabRunService?: Map<string, ActiveRun>;
  __modelLabRegistrySeeded?: WeakSet<RunStore>;
};
const activeRuns: Map<string, ActiveRun> = (globalStash.__modelLabRunService ??= new Map<
  string,
  ActiveRun
>());
/* Store instances whose registry tables were seeded this process (once per
   process per instance; a store instance is a process-lifetime singleton). */
const seededStores: WeakSet<RunStore> = (globalStash.__modelLabRegistrySeeded ??=
  new WeakSet<RunStore>());

/* ------------------------------------------------------------------------- *
 * Endpoint / pack resolution
 * ------------------------------------------------------------------------- */

/**
 * Output cap for real runs. The demo fixture's 16k starves reasoning models:
 * their hidden thinking is billed inside the same budget, so a reasoner can
 * spend the whole cap thinking and return a truncated file — or nothing at all
 * (observed on run_0cf7aa08: deepseek 16.0k out / 0 chars, gemini cut mid-line).
 * 32k leaves room to think AND emit a full single-file artifact; spend is
 * unaffected for models that stop early, and the budget ceiling still guards it.
 * Override with MODEL_LAB_MAX_OUTPUT_TOKENS.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

export function resolveMaxOutputTokens(): number {
  const raw = Number.parseInt((process.env["MODEL_LAB_MAX_OUTPUT_TOKENS"] ?? "").trim(), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OUTPUT_TOKENS;
}

/** Env var that must be present for a real (non-mock) provider call. */
function requiredKeyEnv(providerId: string): string | null {
  switch (providerId) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "ollama":
      return null; // keyless by design
    case "baseline":
      return null; // deterministic control, never a real call
    default:
      // matches the runner's explicit-baseUrl convention: <PROVIDERID>_API_KEY
      return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  }
}

function hasRequiredKey(providerId: string): boolean {
  const env = requiredKeyEnv(providerId);
  if (env === null) return false; // no key can prove a local server exists
  const value = process.env[env];
  return value !== undefined && value !== "";
}

/**
 * Auto mode mocks only endpoints missing a required key. Keyless local
 * providers run real even when no cloud key is configured. Reachability is
 * established by the actual local call, not by a cloud credential's presence.
 */
export function resolveMockPolicy(): (ep: Pick<ModelEndpoint, "providerId">) => boolean {
  const flag = (process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim();
  if (flag === "1") return () => true;
  if (flag === "0") return () => false;
  return (ep) => requiredKeyEnv(ep.providerId) !== null && !hasRequiredKey(ep.providerId);
}

/** One registry endpoint with what this environment can do with it (the CLI's `models`). */
export interface EndpointAvailability {
  id: string;
  providerId: string;
  modelId: string;
  deployment: ModelEndpoint["deployment"];
  /** the provider's key is present (always false for keyless Ollama) */
  keyed: boolean;
  /** what a run started right now would do with it */
  mocked: boolean;
}

/** Every registry endpoint, resolved under the current mock policy. */
export function listEndpointAvailability(): EndpointAvailability[] {
  const mockFor = resolveMockPolicy();
  return endpointCatalog.map((ep) => ({
    id: ep.id,
    providerId: ep.providerId,
    modelId: ep.modelId,
    deployment: ep.deployment,
    keyed: hasRequiredKey(ep.providerId),
    mocked: ep.providerId === "baseline" ? true : mockFor(ep),
  }));
}

/** providerId → runner baseKind (+ explicit baseUrl where needed). */
function baseFor(providerId: string): { baseKind: BaseKind; baseUrl?: string } {
  switch (providerId) {
    case "anthropic":
      return { baseKind: "anthropic" };
    case "ollama":
      return { baseKind: "ollama" }; // baseUrl via OLLAMA_BASE_URL in the runner
    case "deepseek":
      // OpenAI-compatible surface; key resolves from DEEPSEEK_API_KEY
      // (the runner derives <PROVIDERID>_API_KEY for explicit base URLs).
      return { baseKind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" };
    case "google":
      // Google's OpenAI-compatible surface; key resolves from GOOGLE_API_KEY.
      return {
        baseKind: "openai-compatible",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      };
    default:
      // openai / openrouter / custom → openai-compatible (runner picks base URL)
      return { baseKind: "openai-compatible" };
  }
}

function toEndpointConfig(ep: ModelEndpoint, mock: boolean): EndpointConfig {
  const def = modelDefinitions.find((m) => m.id === ep.modelId);
  // The baseline control is the mock's blank document whatever the policy says.
  const base =
    mock || ep.providerId === "baseline"
      ? { baseKind: "mock" as BaseKind }
      : baseFor(ep.providerId);
  const config: EndpointConfig = {
    id: ep.id,
    providerId: ep.providerId,
    modelId: ep.modelId,
    baseKind: base.baseKind,
    // provider-facing name: apiModel when it differs (e.g. ollama tags)
    model: ep.apiModel ?? ep.modelId,
    priceInPerMtokUsd: ep.priceInPerMtokUsd,
    priceOutPerMtokUsd: ep.priceOutPerMtokUsd,
    supportsSeed: def?.supportsSeed ?? false,
  };
  if ("baseUrl" in base && base.baseUrl !== undefined) config.baseUrl = base.baseUrl;
  if (ep.quantization != null && ep.quantization !== "") config.quantization = ep.quantization;
  return config;
}

function toPackConfig(packSlug: string): PackConfig {
  const pack = benchmarkPacks.find((p) => p.slug === packSlug);
  if (pack === undefined) {
    throw new RunServiceError(`Unknown benchmark pack: ${packSlug}`);
  }
  const prompt =
    pack.prompt ??
    `${pack.description} Build it as ONE self-contained HTML file with no external ` +
      `network dependencies. Return only the HTML document.`;
  return {
    slug: pack.slug,
    version: pack.version,
    prompt,
    browserCheckCount: pack.browserCheckCount ?? 12,
  };
}

/**
 * Verified mode: the pack must exist natively on disk with an objective task
 * list (benchmark-packs/<slug>/pack.json). The runner iterates these tasks —
 * one sample per task — and scores each with the task's objective scorer.
 */
function toVerifiedPackConfig(packSlug: string): PackConfig {
  const disk = loadPackFromDisk(packSlug);
  if (disk === null) {
    throw new RunServiceError(
      `Benchmark pack "${packSlug}" has no native pack.json — verified mode needs benchmark-packs/<slug>/pack.json`,
    );
  }
  const tasks = tasksForPack(disk);
  if (tasks.length === 0) {
    throw new RunServiceError(
      `Benchmark pack "${packSlug}" defines no tasks — verified mode requires at least one`,
    );
  }
  return {
    slug: disk.slug,
    version: disk.version,
    // promptHash covers every task prompt, so the fingerprint pins the task list
    prompt: tasks.map((t) => `[${t.id}] ${t.prompt}`).join("\n"),
    browserCheckCount: 0,
    tasks,
  };
}

/** Judge defaults: Sonnet 4.6 at $3/$15 per Mtok (env-overridable model). */
const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-6";
const DEFAULT_JUDGE_PRICE_IN = 3;
const DEFAULT_JUDGE_PRICE_OUT = 15;

/**
 * LLM-judge gate: build-arena runs only, judge calls need ANTHROPIC_API_KEY,
 * opt-out via MODEL_LAB_JUDGE=0. A forced all-mock run (MODEL_LAB_MOCK_PROVIDERS=1)
 * never judges — a mock flag must never spend money or hit a network.
 */
export function resolveJudgeConfig(mode: RunMode): RunnerConfig["judge"] {
  if (mode !== "build-arena") return undefined;
  if ((process.env["ANTHROPIC_API_KEY"] ?? "") === "") return undefined;
  if ((process.env["MODEL_LAB_JUDGE"] ?? "").trim() === "0") return undefined;
  if ((process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim() === "1") return undefined;
  return {
    model: process.env["MODEL_LAB_JUDGE_MODEL"] ?? DEFAULT_JUDGE_MODEL,
    priceInPerMtokUsd: DEFAULT_JUDGE_PRICE_IN,
    priceOutPerMtokUsd: DEFAULT_JUDGE_PRICE_OUT,
  };
}

function newRunId(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const id = `run_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (!activeRuns.has(id)) return id;
  }
  return `run_${Date.now().toString(16).slice(-8)}`;
}

/* ------------------------------------------------------------------------- *
 * Store persistence (best-effort: the live stream must never die on it)
 * ------------------------------------------------------------------------- */

async function getStoreSafe(): Promise<RunStore | null> {
  try {
    return await getStore();
  } catch {
    return null; // misconfigured store — run continues, events stay in-memory
  }
}

/** First line only, secrets redacted, capped at 160 chars — log-safe. */
function scrub(message: string): string {
  const firstLine = (message.split("\n", 1)[0] ?? "")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, "[redacted]");
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

const FK_ERROR_RE = /foreign key|violates.*constraint|\b23503\b/i;

/**
 * Shared catch handler for best-effort persistence: the run must continue
 * even if persistence fails, but the failure lands in the server log instead
 * of vanishing. When `store` is given and the error looks like an FK
 * violation, the per-process "registry seeded" flag is reset so the next run
 * start re-seeds the registry tables (belt and braces).
 */
function warnPersist(label: string, store?: RunStore): (err: unknown) => undefined {
  return (err: unknown): undefined => {
    const message = err instanceof Error ? err.message : String(err);
    if (store !== undefined && FK_ERROR_RE.test(message)) seededStores.delete(store);
    console.warn("[model-lab] persist failed:", label, scrub(message));
    return undefined;
  };
}

/**
 * Upserts the registry fixtures (providers → model_definitions →
 * model_endpoints → benchmark_packs) so run_models/samples/artifacts rows
 * never hit FK violations on a fresh database — for ANY backend. Runs once
 * per process per store instance; warnPersist resets the flag on FK-looking
 * failures.
 */
async function ensureRegistrySeeded(store: RunStore): Promise<void> {
  if (seededStores.has(store)) return;
  await store.seedRegistry({
    providers,
    modelDefinitions,
    endpoints: endpointCatalog,
    packs: benchmarkPacks,
  });
  seededStores.add(store);
}

function synthesizeRun(cfg: RunnerConfig, startedAt: string): Run {
  return {
    id: cfg.runId,
    fingerprint: computeFingerprint(cfg),
    name: cfg.name,
    mode: cfg.mode,
    status: "running",
    pack: { slug: cfg.pack.slug, version: cfg.pack.version },
    promptHash: promptHash(cfg.pack.prompt),
    // verified runs: per-model sample count = task count (1 sample per task)
    samplesPerModel:
      cfg.mode === "verified"
        ? (cfg.pack.tasks?.length ?? cfg.samplesPerModel)
        : cfg.samplesPerModel,
    modelCount: cfg.endpoints.length,
    budgetCeilingUsd: cfg.maxBudgetUsd,
    costSpentUsd: 0,
    estCostRangeUsd: null,
    startedAt,
    completedAt: null,
    elapsedSec: 0,
    runnerVersion: RUNNER_VERSION,
    gitCommit: captureSourceRevision().commit,
    compositeWeighting: { browser: 50, visual: 35, efficiency: 15 },
    verdict: null,
    judgeReversalCount: 0,
  };
}

function synthesizeConfiguration(cfg: RunnerConfig): RunConfiguration {
  return {
    temperature: cfg.temperature,
    maxOutputTokens: cfg.maxOutputTokens,
    seed: cfg.seed,
    samplesPerModel: cfg.samplesPerModel,
    concurrency: cfg.concurrency,
    retryPolicy: { generation: "none", transportRetries: cfg.transportRetries },
    maxBudgetUsd: cfg.maxBudgetUsd,
    toolAccess: false,
    artifactNetworkPolicy: "blocked",
    saveReasoningMetadata: true,
    scorers:
      cfg.mode === "verified"
        ? [
            {
              type: "objective",
              name: `Objective scorer — ${cfg.pack.tasks?.length ?? 0} tasks`,
              rubricVersion: null,
              orderSwapped: false,
              enabled: true,
            },
          ]
        : [
            {
              type: "browser",
              name: `Browser checks — ${cfg.pack.browserCheckCount} assertions`,
              rubricVersion: null,
              orderSwapped: false,
              enabled: true,
            },
            // Results' scorer badges show LLM JUDGE when judging is enabled
            ...(cfg.judge !== undefined
              ? [
                  {
                    type: "llm-judge" as const,
                    name: `LLM judge — ${cfg.judge.model} · rubric + order-swapped pairs`,
                    rubricVersion: "v1",
                    orderSwapped: true,
                    enabled: true,
                  },
                ]
              : []),
          ],
    configDifferences: cfg.endpoints
      .filter((ep) => cfg.seed !== null && !ep.supportsSeed)
      .map((ep) => `${ep.modelId} (${ep.providerId}) runs unseeded — provider lacks seed support`),
  };
}

async function persistRunCreation(
  store: RunStore,
  cfg: RunnerConfig,
  startedAt: string,
): Promise<void> {
  // FK safety on a fresh database: registry rows must exist before
  // run_models/samples/artifacts reference them.
  await ensureRegistrySeeded(store);
  await store.createRun(synthesizeRun(cfg, startedAt), synthesizeConfiguration(cfg));
  for (const ep of cfg.endpoints) {
    await store.upsertRunModel({
      runId: cfg.runId,
      endpointId: ep.id,
      status: "queued",
      failedSampleCount: 0,
      progressPct: 0,
      currentTask: null,
      tokensOut: 0,
      ttftMs: null,
      totalLatencyMs: null,
      costUsd: 0,
      visualScore: null,
      visualSource: null,
      testsPassed: null,
      testsTotal: null,
      retries: 0,
      unseeded: cfg.seed !== null && !ep.supportsSeed,
      flag: null,
    });
  }
}

function artifactSource(root: string, relPath: string): string {
  try {
    return readFileSync(join(root, relPath), "utf8");
  } catch {
    return ""; // artifact file missing — metadata row still lands
  }
}

async function persistFinalSnapshot(
  store: RunStore,
  runId: string,
  fallbackStatus: RunStatus,
  snapshot: StoredRunResults | null,
  fsRoot: string,
): Promise<void> {
  if (snapshot === null) {
    await store
      .updateRunStatus(runId, { status: fallbackStatus })
      .catch(warnPersist("updateRunStatus:fallback", store));
    return;
  }
  await store
    .updateRunStatus(runId, {
      status: snapshot.run.status,
      costSpentUsd: snapshot.run.costSpentUsd,
      completedAt: snapshot.run.completedAt,
      elapsedSec: snapshot.run.elapsedSec,
      judgeReversalCount: snapshot.run.judgeReversalCount,
    })
    .catch(warnPersist("updateRunStatus:final", store));
  for (const model of snapshot.models) {
    await store
      .upsertRunModel(model)
      .catch(warnPersist(`upsertRunModel:${model.endpointId}`, store));
  }
  for (const sample of snapshot.samples) {
    // Terminal rows only; IMMUTABLE/DUPLICATE from an earlier flush is benign.
    await store
      .insertSample(sample)
      .catch(warnPersist(`insertSample:${sample.endpointId}#${sample.sampleIndex}`, store));
  }
  for (const stored of snapshot.artifacts) {
    const artifact: Artifact = {
      runId,
      endpointId: stored.endpointId,
      sampleIndex: stored.sampleIndex,
      path: stored.path,
      filename: stored.filename,
      sizeKb: stored.sizeKb,
      renderOk: stored.renderOk,
      isBestOfModel: false,
      source: artifactSource(fsRoot, stored.path),
      // absolute runner path → data-root-relative ("screenshots/8f3a/…") so the
      // web app can serve it via /api/runs/[runId]/screenshots/[...path]
      screenshotRef:
        stored.screenshotPath !== null
          ? relative(fsRoot, stored.screenshotPath).split("\\").join("/")
          : null,
      consoleLines: stored.consoleLines,
      checks: stored.checks,
      judgeCommentary: stored.judgeCommentary ?? null,
      sandbox: {
        isolatedOrigin: true,
        networkBlocked: true,
        execLimitSec: 30,
        sizeLimitMb: 2,
      },
    };
    await store
      .insertArtifact(artifact)
      .catch(warnPersist(`insertArtifact:${artifact.endpointId}#${artifact.sampleIndex}`, store));
  }
  // Judge pair verdicts (build-arena judge phase). Snapshots written before
  // the judge phase existed have no judgePairs field — treat as empty.
  const judgePairs: JudgePairResult[] =
    (snapshot.judgePairs as JudgePairResult[] | undefined) ?? [];
  for (const pair of judgePairs) {
    await store
      .insertJudgePair(pair)
      .catch(warnPersist(`insertJudgePair:${pair.pairIndex}`, store));
  }
}

/* ------------------------------------------------------------------------- *
 * Event pump: runner bus → ring buffer + store
 * ------------------------------------------------------------------------- */

async function pumpEvents(
  active: ActiveRun,
  store: RunStore | null,
  fsStore: FsRunStore,
): Promise<void> {
  /* appendEvent calls are chained so store event ids preserve stream order. */
  let persistChain: Promise<unknown> = Promise.resolve();
  try {
    for await (const event of active.handle.events) {
      active.feed.push(event);
      if (store !== null) {
        persistChain = persistChain
          .then(async () => {
            await store.appendEvent(event);
            if (event.type === "budget.status") {
              const spent = event.payload["spentUsd"];
              if (typeof spent === "number") {
                await store.updateRunStatus(active.record.id, { costSpentUsd: spent });
              }
            }
          })
          .catch(warnPersist(`appendEvent:${event.type}`, store));
      }
    }
  } catch {
    // runner event stream crashed — terminal handling below still runs
  }

  let fallbackStatus: RunStatus = "failed";
  try {
    const outcome = await active.handle.done;
    fallbackStatus = outcome.status;
  } catch {
    fallbackStatus = "failed";
  }
  await persistChain.catch(warnPersist("persistChain", store ?? undefined));

  const snapshot = fsStore.loadSnapshot(active.record.id);
  const finalStatus: RunStatus = snapshot?.run.status ?? fallbackStatus;
  if (store !== null) {
    await persistFinalSnapshot(store, active.record.id, finalStatus, snapshot, fsStore.root).catch(
      warnPersist("finalSnapshot", store),
    );
  }

  const finished: RunRecord = { ...active.record, status: finalStatus };
  active.record = finished;
  registerRun(finished); // live page + GET /api/runs see the terminal status
  active.feed.finish();
  if (store !== null && active.lease !== null) {
    const persisted = await store.getRun(active.record.id).catch(() => null);
    if (persisted !== null && !["running", "queued", "paused"].includes(persisted.run.status)) {
      active.lease.release();
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Public surface
 * ------------------------------------------------------------------------- */

/**
 * Validates the selection, starts the native runner, wires persistence, and
 * returns the new run id. Throws RunServiceError on unknown pack/endpoints.
 */
export async function startRun(input: StartRunInput): Promise<{ runId: string }> {
  const selected = input.endpointIds.map((id) => {
    const ep = endpointCatalog.find((candidate) => candidate.id === id);
    if (ep === undefined) throw new RunServiceError(`Unknown model endpoint: ${id}`);
    return ep;
  });
  const verified = input.mode === "verified";
  const pack = verified ? toVerifiedPackConfig(input.packSlug) : toPackConfig(input.packSlug);
  const mockFor = resolveMockPolicy();
  const endpoints = selected.map((ep) => toEndpointConfig(ep, mockFor(ep)));
  const runId = newRunId();
  const name =
    input.name ?? benchmarkPacks.find((p) => p.slug === input.packSlug)?.name ?? input.packSlug;

  const cfg: RunnerConfig = {
    runId,
    name,
    mode: input.mode,
    pack,
    endpoints,
    // verified MVP: 1 sample per task — the runner iterates the task list
    samplesPerModel: verified ? 1 : input.samplesPerModel,
    temperature: defaultRunConfiguration.temperature,
    maxOutputTokens: resolveMaxOutputTokens(),
    seed: defaultRunConfiguration.seed,
    concurrency: workspaceSettings.defaultConcurrency,
    maxBudgetUsd: input.maxBudgetUsd ?? workspaceSettings.defaultRunBudgetUsd,
    transportRetries: defaultRunConfiguration.retryPolicy.transportRetries,
  };
  // LLM-judge phase (build-arena + ANTHROPIC_API_KEY + not opted out/mocked)
  const judge = resolveJudgeConfig(input.mode);
  if (judge !== undefined) cfg.judge = judge;
  // Verified runs never inject the broken-artifact failSample (no artifacts,
  // no browser checks) — the mock's wrong-answer path covers the 0-score demo.
  // Only a MOCKED qwen-ish endpoint qualifies: never sabotage a real run.
  if (!verified && input.samplesPerModel >= 2) {
    const qwenish = endpoints.find(
      (ep) => ep.baseKind === "mock" && (ep.id.includes("qwen") || ep.modelId.includes("qwen")),
    );
    if (qwenish !== undefined) {
      cfg.failSample = { endpointId: qwenish.id, sampleIndex: 2 };
    }
  }

  const createdAt = new Date().toISOString();
  const record: RunRecord = {
    id: runId,
    config: {
      name: input.name,
      mode: input.mode,
      packSlug: input.packSlug,
      endpointIds: [...input.endpointIds],
      samplesPerModel: input.samplesPerModel,
    },
    createdAt,
    status: "running",
  };
  const store = await getStoreSafe();
  if (store !== null) await reconcileInterruptedRuns(store);
  const lease = store !== null ? acquireRunLease(store, runId) : null;
  if (store !== null) {
    // Non-fatal: the live run continues even if the store rejects it, but the
    // failure (e.g. a seedRegistry error against a fresh database) is logged.
    await persistRunCreation(store, cfg, createdAt).catch(warnPersist("runCreation", store));
  }

  let fsStore: FsRunStore;
  let handle: RunHandle;
  try {
    fsStore = new FsRunStore();
    handle = runnerStartRun(cfg, { store: fsStore });
  } catch (err) {
    lease?.stop();
    if (store !== null) {
      const ended = await store
        .updateRunStatus(runId, { status: "failed", completedAt: new Date().toISOString() })
        .catch(warnPersist("runStartupFailure", store));
      if (ended !== undefined) lease?.release();
    }
    throw err;
  }
  const active: ActiveRun = { record, handle, feed: new EventFeed(), config: cfg, lease };
  activeRuns.set(runId, active);
  registerRun(record);

  void pumpEvents(active, store, fsStore)
    .catch(warnPersist("eventPump", store ?? undefined))
    .finally(() => lease?.stop());
  return { runId };
}

/** True while the run's in-process feed exists (running or freshly finished). */
export function isActiveRun(runId: string): boolean {
  return activeRuns.has(runId);
}

/**
 * AsyncIterable of the run's events: buffered-from-start, then live; the
 * iterable ends once the run is terminal. Stored (persisted) runs replay
 * their event log and end immediately. Returns null when the run is unknown
 * to both the in-process service and the store. Storage failures propagate;
 * an unknown run never substitutes a fixture event stream.
 */
export async function subscribeRun(runId: string): Promise<AsyncIterable<RunEvent> | null> {
  const active = activeRuns.get(runId);
  if (active !== undefined) return active.feed.stream();

  const store = await getStore();
  await reconcileInterruptedRuns(store);
  const run = await store.getRun(runId);
  if (run === null) return null;
  const stored = await store.listEvents(runId);
  return (async function* replay(): AsyncGenerator<RunEvent, void, void> {
    for (const entry of stored) {
      const { id: _storeEventId, ...event } = entry;
      yield event;
    }
  })();
}

/** Cancels an active run; returns false when the run isn't in-process. */
export function cancelRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (active === undefined || active.feed.isFinished) return false;
  active.handle.cancel();
  return true;
}
