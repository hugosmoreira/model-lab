/**
 * In-memory RunStore backed by Maps. Default backend (`MODEL_LAB_STORE=memory`).
 * State lives for the lifetime of the server process; the factory auto-seeds
 * the demo scenario so every screen has real store data immediately.
 */
import type {
  Artifact,
  BenchmarkPack,
  HumanAnnotation,
  JudgePairResult,
  ModelDefinition,
  ModelEndpoint,
  PairwiseVote,
  Provider,
  Run,
  RunConfiguration,
  RunEvent,
  RunModel,
  SampleResult,
} from "@model-lab/schemas";
import {
  StoreError,
  type RegistrySeed,
  type RunStatusPatch,
  type RunStore,
  type RunWithConfig,
  type SeedFixtures,
  type StoredRunEvent,
} from "./types";

const sampleKey = (endpointId: string, sampleIndex: number): string =>
  `${endpointId}#${sampleIndex}`;
const packKey = (slug: string, version: string): string => `${slug}@${version}`;

const TERMINAL_SAMPLE_STATUSES = new Set<string>(["scored", "failed"]);

interface RunRecord {
  run: Run;
  configuration: RunConfiguration;
  /** insertion-ordered per-endpoint participation */
  runModels: Map<string, RunModel>;
  samples: Map<string, SampleResult>;
  artifacts: Map<string, Artifact>;
  events: StoredRunEvent[];
  annotations: HumanAnnotation[];
  votes: Map<number, PairwiseVote>;
  judgePairs: Map<number, JudgePairResult>;
}

export class MemoryStore implements RunStore {
  private readonly providers = new Map<string, Provider>();
  private readonly modelDefinitions = new Map<string, ModelDefinition>();
  private readonly endpoints = new Map<string, ModelEndpoint>();
  private readonly packs = new Map<string, BenchmarkPack>();
  private readonly runs = new Map<string, RunRecord>();
  /** Global monotonic event id (mirrors the SQL bigint identity). */
  private nextEventId = 1;

  // -- runs -----------------------------------------------------------------

  async listRuns(): Promise<Run[]> {
    const all = [...this.runs.values()].map((r) => structuredClone(r.run));
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all;
  }

  async getRun(runId: string): Promise<RunWithConfig | null> {
    const rec = this.runs.get(runId);
    if (!rec) return null;
    return structuredClone({ run: rec.run, configuration: rec.configuration });
  }

  async createRun(run: Run, config: RunConfiguration): Promise<void> {
    if (this.runs.has(run.id)) {
      throw new StoreError("DUPLICATE", `run ${run.id} already exists`);
    }
    this.runs.set(run.id, {
      run: structuredClone(run),
      configuration: structuredClone(config),
      runModels: new Map(),
      samples: new Map(),
      artifacts: new Map(),
      events: [],
      annotations: [],
      votes: new Map(),
      judgePairs: new Map(),
    });
  }

  async updateRunStatus(runId: string, patch: RunStatusPatch): Promise<Run> {
    const rec = this.mustGet(runId);
    const run = rec.run;
    if (patch.status !== undefined) run.status = patch.status;
    if (patch.costSpentUsd !== undefined) run.costSpentUsd = patch.costSpentUsd;
    if (patch.completedAt !== undefined) run.completedAt = patch.completedAt;
    if (patch.elapsedSec !== undefined) run.elapsedSec = patch.elapsedSec;
    if (patch.verdict !== undefined) run.verdict = patch.verdict;
    if (patch.judgeReversalCount !== undefined) {
      run.judgeReversalCount = patch.judgeReversalCount;
    }
    return structuredClone(run);
  }

  // -- per-model progress ---------------------------------------------------

  async upsertRunModel(rm: RunModel): Promise<void> {
    this.mustGet(rm.runId).runModels.set(rm.endpointId, structuredClone(rm));
  }

  async listRunModels(runId: string): Promise<RunModel[]> {
    const rec = this.runs.get(runId);
    return rec ? [...rec.runModels.values()].map((m) => structuredClone(m)) : [];
  }

  // -- immutable evidence streams -------------------------------------------

  async insertSample(s: SampleResult): Promise<void> {
    const rec = this.mustGet(s.runId);
    const key = sampleKey(s.endpointId, s.sampleIndex);
    const existing = rec.samples.get(key);
    if (existing && TERMINAL_SAMPLE_STATUSES.has(existing.status)) {
      throw new StoreError(
        "IMMUTABLE",
        `sample ${s.runId}/${key} is ${existing.status} — scored samples are immutable (use annotations)`,
      );
    }
    rec.samples.set(key, structuredClone(s));
  }

  async insertArtifact(a: Artifact): Promise<void> {
    const rec = this.mustGet(a.runId);
    const key = sampleKey(a.endpointId, a.sampleIndex);
    if (rec.artifacts.has(key)) {
      throw new StoreError(
        "DUPLICATE",
        `artifact ${a.runId}/${key} already exists — artifacts are insert-only`,
      );
    }
    rec.artifacts.set(key, structuredClone(a));
  }

  async appendEvent(e: RunEvent): Promise<StoredRunEvent> {
    const rec = this.mustGet(e.runId);
    const stored: StoredRunEvent = { ...structuredClone(e), id: this.nextEventId++ };
    rec.events.push(stored);
    return structuredClone(stored);
  }

  async listEvents(runId: string, afterId?: number): Promise<StoredRunEvent[]> {
    const rec = this.runs.get(runId);
    if (!rec) return [];
    const from = afterId ?? 0;
    return rec.events.filter((e) => e.id > from).map((e) => structuredClone(e));
  }

  async listSamples(runId: string): Promise<SampleResult[]> {
    const rec = this.runs.get(runId);
    if (!rec) return [];
    const all = [...rec.samples.values()].map((s) => structuredClone(s));
    all.sort((a, b) => a.globalIndex - b.globalIndex);
    return all;
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    const rec = this.runs.get(runId);
    return rec ? [...rec.artifacts.values()].map((a) => structuredClone(a)) : [];
  }

  // -- append-only human audit trail ----------------------------------------

  async insertAnnotation(a: HumanAnnotation): Promise<void> {
    // annotations may reference runs the store no longer tracks; keep them
    // only when the run exists (SQL table has no FK either, but memory keys
    // records per run).
    this.mustGet(a.runId).annotations.push(structuredClone(a));
  }

  async listAnnotations(runId: string): Promise<HumanAnnotation[]> {
    const rec = this.runs.get(runId);
    return rec ? rec.annotations.map((a) => structuredClone(a)) : [];
  }

  // -- head-to-head votes ---------------------------------------------------

  async upsertVote(v: PairwiseVote): Promise<void> {
    this.mustGet(v.runId).votes.set(v.pairIndex, structuredClone(v));
  }

  async listVotes(runId: string): Promise<PairwiseVote[]> {
    const rec = this.runs.get(runId);
    if (!rec) return [];
    const all = [...rec.votes.values()].map((v) => structuredClone(v));
    all.sort((a, b) => a.pairIndex - b.pairIndex);
    return all;
  }

  // -- LLM-judge pairwise verdicts ------------------------------------------

  async insertJudgePair(p: JudgePairResult): Promise<void> {
    this.mustGet(p.runId).judgePairs.set(p.pairIndex, structuredClone(p));
  }

  async listJudgePairs(runId: string): Promise<JudgePairResult[]> {
    const rec = this.runs.get(runId);
    if (!rec) return [];
    const all = [...rec.judgePairs.values()].map((p) => structuredClone(p));
    all.sort((a, b) => a.pairIndex - b.pairIndex);
    return all;
  }

  // -- registry reads -------------------------------------------------------

  async listProviders(): Promise<Provider[]> {
    return [...this.providers.values()].map((p) => structuredClone(p));
  }

  async listModelDefinitions(): Promise<ModelDefinition[]> {
    return [...this.modelDefinitions.values()].map((m) => structuredClone(m));
  }

  async listEndpoints(): Promise<ModelEndpoint[]> {
    return [...this.endpoints.values()].map((e) => structuredClone(e));
  }

  async listPacks(): Promise<BenchmarkPack[]> {
    return [...this.packs.values()].map((p) => structuredClone(p));
  }

  // -- registry seeding -------------------------------------------------------

  async seedRegistry(reg: RegistrySeed): Promise<void> {
    for (const p of reg.providers) this.providers.set(p.id, structuredClone(p));
    for (const m of reg.modelDefinitions) {
      this.modelDefinitions.set(m.id, structuredClone(m));
    }
    for (const e of reg.endpoints) this.endpoints.set(e.id, structuredClone(e));
    for (const p of reg.packs) {
      this.packs.set(packKey(p.slug, p.version), structuredClone(p));
    }
  }

  // -- demo data ------------------------------------------------------------

  async seedDemo(fixtures: SeedFixtures): Promise<void> {
    await this.seedRegistry(fixtures);

    // Replace any prior state for the demo run wholesale (idempotent reseed).
    this.runs.delete(fixtures.run.id);
    await this.createRun(fixtures.run, fixtures.configuration);
    for (const rm of fixtures.runModels) await this.upsertRunModel(rm);
    for (const s of fixtures.samples) await this.insertSample(s);
    for (const a of fixtures.artifacts) await this.insertArtifact(a);
    for (const e of fixtures.events) await this.appendEvent(e);
    for (const a of fixtures.annotations ?? []) await this.insertAnnotation(a);
    for (const v of fixtures.votes ?? []) await this.upsertVote(v);
  }

  // -- internals ------------------------------------------------------------

  private mustGet(runId: string): RunRecord {
    const rec = this.runs.get(runId);
    if (!rec) throw new StoreError("NOT_FOUND", `run ${runId} not found`);
    return rec;
  }
}
