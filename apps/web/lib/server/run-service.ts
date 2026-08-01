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
 * GOOGLE_API_KEY / OLLAMA_BASE_URL from process.env server-side. This module
 * only *checks presence* of those variables to decide mock substitution.
 *
 * Mock substitution (keyless demo fidelity):
 *  - MODEL_LAB_MOCK_PROVIDERS=1 → every selected endpoint runs the deterministic
 *    mock provider (a mock flag must never spend money or hit a network).
 *  - MODEL_LAB_MOCK_PROVIDERS=0 → never substitute (force real providers,
 *    e.g. a local Ollama with no cloud keys).
 *  - unset → auto: when NO selected endpoint has its required API key present
 *    (Ollama counts as keyless — presence of a local server can't be proven by
 *    an env var), the whole run is mocked.
 *  - In mock mode, a qwen-ish endpoint (id/modelId contains "qwen") gets
 *    failSample = { endpointId, sampleIndex: 2 } so the demo's preserved
 *    render-failure path stays exercised.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  Artifact,
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
  runConfiguration as defaultRunConfiguration,
  workspaceSettings,
} from "@model-lab/schemas/fixtures";
import { getStore, type RunStore } from "@model-lab/store";
import {
  FsRunStore,
  RUNNER_VERSION,
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

/** Input contract — matches the wizard's POST /api/runs body (agent A). */
export interface StartRunInput {
  name: string | null;
  mode: RunMode;
  packSlug: string;
  endpointIds: string[];
  samplesPerModel: number;
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
}

/* Survives next-dev module reloads, mirroring lib/live/run-registry. Finished
   runs stay in the map as a fast replay source (buffer is ring-capped). */
const globalStash = globalThis as typeof globalThis & {
  __modelLabRunService?: Map<string, ActiveRun>;
};
const activeRuns: Map<string, ActiveRun> = (globalStash.__modelLabRunService ??=
  new Map<string, ActiveRun>());

/* ------------------------------------------------------------------------- *
 * Endpoint / pack resolution
 * ------------------------------------------------------------------------- */

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
    case "ollama":
      return null; // keyless by design
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

function resolveMockMode(selected: ModelEndpoint[]): boolean {
  const flag = (process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim();
  if (flag === "1") return true;
  if (flag === "0") return false;
  return selected.every((ep) => !hasRequiredKey(ep.providerId));
}

/** providerId → runner baseKind (+ explicit baseUrl where needed). */
function baseFor(providerId: string): { baseKind: BaseKind; baseUrl?: string } {
  switch (providerId) {
    case "anthropic":
      return { baseKind: "anthropic" };
    case "ollama":
      return { baseKind: "ollama" }; // baseUrl via OLLAMA_BASE_URL in the runner
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
  const base = mock ? { baseKind: "mock" as BaseKind } : baseFor(ep.providerId);
  const config: EndpointConfig = {
    id: ep.id,
    providerId: ep.providerId,
    modelId: ep.modelId,
    baseKind: base.baseKind,
    model: ep.modelId, // provider-facing name; MVP uses the catalog modelId
    priceInPerMtokUsd: ep.priceInPerMtokUsd,
    priceOutPerMtokUsd: ep.priceOutPerMtokUsd,
    supportsSeed: def?.supportsSeed ?? false,
  };
  if ("baseUrl" in base && base.baseUrl !== undefined) config.baseUrl = base.baseUrl;
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

function synthesizeRun(cfg: RunnerConfig, startedAt: string): Run {
  return {
    id: cfg.runId,
    fingerprint: computeFingerprint(cfg),
    name: cfg.name,
    mode: cfg.mode,
    status: "running",
    pack: { slug: cfg.pack.slug, version: cfg.pack.version },
    promptHash: promptHash(cfg.pack.prompt),
    samplesPerModel: cfg.samplesPerModel,
    modelCount: cfg.endpoints.length,
    budgetCeilingUsd: cfg.maxBudgetUsd,
    costSpentUsd: 0,
    estCostRangeUsd: null,
    startedAt,
    completedAt: null,
    elapsedSec: 0,
    runnerVersion: RUNNER_VERSION,
    gitCommit: null,
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
    scorers: [
      {
        type: "browser",
        name: `Browser checks — ${cfg.pack.browserCheckCount} assertions`,
        rubricVersion: null,
        orderSwapped: false,
        enabled: true,
      },
    ],
    configDifferences: cfg.endpoints
      .filter((ep) => cfg.seed !== null && !ep.supportsSeed)
      .map(
        (ep) => `${ep.modelId} (${ep.providerId}) runs unseeded — provider lacks seed support`,
      ),
  };
}

async function persistRunCreation(
  store: RunStore,
  cfg: RunnerConfig,
  startedAt: string,
): Promise<void> {
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
    await store.updateRunStatus(runId, { status: fallbackStatus }).catch(() => undefined);
    return;
  }
  await store
    .updateRunStatus(runId, {
      status: snapshot.run.status,
      costSpentUsd: snapshot.run.costSpentUsd,
      completedAt: snapshot.run.completedAt,
      elapsedSec: snapshot.run.elapsedSec,
    })
    .catch(() => undefined);
  for (const model of snapshot.models) {
    await store.upsertRunModel(model).catch(() => undefined);
  }
  for (const sample of snapshot.samples) {
    // Terminal rows only; IMMUTABLE/DUPLICATE from an earlier flush is benign.
    await store.insertSample(sample).catch(() => undefined);
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
      judgeCommentary: null,
      sandbox: {
        isolatedOrigin: true,
        networkBlocked: true,
        execLimitSec: 30,
        sizeLimitMb: 2,
      },
    };
    await store.insertArtifact(artifact).catch(() => undefined);
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
          .catch(() => undefined);
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
  await persistChain.catch(() => undefined);

  const snapshot = fsStore.loadSnapshot(active.record.id);
  const finalStatus: RunStatus = snapshot?.run.status ?? fallbackStatus;
  if (store !== null) {
    await persistFinalSnapshot(store, active.record.id, finalStatus, snapshot, fsStore.root).catch(
      () => undefined,
    );
  }

  const finished: RunRecord = { ...active.record, status: finalStatus };
  active.record = finished;
  registerRun(finished); // live page + GET /api/runs see the terminal status
  active.feed.finish();
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
  const pack = toPackConfig(input.packSlug);
  const mock = resolveMockMode(selected);
  const endpoints = selected.map((ep) => toEndpointConfig(ep, mock));
  const runId = newRunId();
  const name =
    input.name ??
    benchmarkPacks.find((p) => p.slug === input.packSlug)?.name ??
    input.packSlug;

  const cfg: RunnerConfig = {
    runId,
    name,
    mode: input.mode,
    pack,
    endpoints,
    samplesPerModel: input.samplesPerModel,
    temperature: defaultRunConfiguration.temperature,
    maxOutputTokens: defaultRunConfiguration.maxOutputTokens,
    seed: defaultRunConfiguration.seed,
    concurrency: workspaceSettings.defaultConcurrency,
    maxBudgetUsd: workspaceSettings.defaultRunBudgetUsd,
    transportRetries: defaultRunConfiguration.retryPolicy.transportRetries,
  };
  if (mock && input.samplesPerModel >= 2) {
    const qwenish = endpoints.find(
      (ep) => ep.id.includes("qwen") || ep.modelId.includes("qwen"),
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
  registerRun(record);

  const store = await getStoreSafe();
  if (store !== null) {
    await persistRunCreation(store, cfg, createdAt).catch(() => undefined);
  }

  const fsStore = new FsRunStore();
  const handle = runnerStartRun(cfg, { store: fsStore });
  const active: ActiveRun = { record, handle, feed: new EventFeed(), config: cfg };
  activeRuns.set(runId, active);

  void pumpEvents(active, store, fsStore);
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
 * to both the in-process service and the store — callers fall back to the
 * Phase 1 fixture replay.
 */
export async function subscribeRun(runId: string): Promise<AsyncIterable<RunEvent> | null> {
  const active = activeRuns.get(runId);
  if (active !== undefined) return active.feed.stream();

  const store = await getStoreSafe();
  if (store === null) return null;
  const run = await store.getRun(runId).catch(() => null);
  if (run === null) return null;
  const stored = await store.listEvents(runId).catch(() => []);
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
