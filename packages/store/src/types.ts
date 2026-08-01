/**
 * @model-lab/store — persistence contracts.
 *
 * SERVER-SIDE ONLY. This package must never be imported from client
 * components; it reaches for `process.env`, `node:sqlite`, and the Supabase
 * service-role key. No `NEXT_PUBLIC_` variable is read anywhere in it.
 *
 * Immutability rules (mirrors supabase/migrations/0001_init.sql):
 * - `samples`, `artifacts`, `run_events` are INSERT-only from the app's
 *   perspective. A sample row may be re-inserted while in flight (status
 *   progression snapshots), but once it reaches a terminal state
 *   ('scored' | 'failed') any further insert with the same key throws.
 * - Artifacts never overwrite: a duplicate (runId, endpointId, sampleIndex)
 *   insert throws.
 * - Score corrections go through the append-only `annotations` stream —
 *   annotations are inserted, never updated or deleted.
 */
import type {
  Artifact,
  BenchmarkPack,
  HumanAnnotation,
  ModelDefinition,
  ModelEndpoint,
  PairwiseVote,
  Provider,
  Run,
  RunConfiguration,
  RunEvent,
  RunModel,
  RunStatus,
  SampleResult,
} from "@model-lab/schemas";

/** Every store failure is thrown as a StoreError with a stable `code`. */
export type StoreErrorCode =
  | "NOT_FOUND"
  | "IMMUTABLE"
  | "DUPLICATE"
  | "CONFIG"
  | "BACKEND";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

/** A run + the full RunConfiguration snapshot persisted alongside it. */
export interface RunWithConfig {
  run: Run;
  configuration: RunConfiguration;
}

/** Partial mutation applied to a run's lifecycle fields. */
export interface RunStatusPatch {
  status?: RunStatus;
  costSpentUsd?: number;
  completedAt?: string | null;
  elapsedSec?: number | null;
  verdict?: { label: string; narrative: string } | null;
  judgeReversalCount?: number;
}

/** A run event after persistence: the store assigns a monotonic `id`. */
export interface StoredRunEvent extends RunEvent {
  /** Monotonically increasing per store (bigint identity in SQL backends). */
  id: number;
}

/**
 * Registry rows only — the catalog tables run/sample/artifact rows reference
 * via foreign keys. Never carries run data.
 */
export interface RegistrySeed {
  providers: Provider[];
  modelDefinitions: ModelDefinition[];
  endpoints: ModelEndpoint[];
  packs: BenchmarkPack[];
}

/** Everything `seedDemo` needs to materialise one demo scenario. */
export interface SeedFixtures extends RegistrySeed {
  run: Run;
  configuration: RunConfiguration;
  runModels: RunModel[];
  samples: SampleResult[];
  artifacts: Artifact[];
  events: RunEvent[];
  annotations?: HumanAnnotation[];
  votes?: PairwiseVote[];
}

/**
 * The one conformance shape all backends implement
 * (MemoryStore, SqliteStore, SupabaseStore).
 *
 * All methods are async so the Supabase backend fits naturally; the
 * in-process backends resolve immediately.
 */
export interface RunStore {
  // -- runs -----------------------------------------------------------------
  /** All runs, newest `startedAt` first. */
  listRuns(): Promise<Run[]>;
  /** Run + configuration snapshot, or null when unknown. */
  getRun(runId: string): Promise<RunWithConfig | null>;
  /** Throws StoreError("DUPLICATE") when the run id already exists. */
  createRun(run: Run, config: RunConfiguration): Promise<void>;
  /** Applies the patch; returns the updated run. Throws NOT_FOUND. */
  updateRunStatus(runId: string, patch: RunStatusPatch): Promise<Run>;

  // -- per-model progress ---------------------------------------------------
  upsertRunModel(rm: RunModel): Promise<void>;
  /** Participants of a run in insertion order. */
  listRunModels(runId: string): Promise<RunModel[]>;

  // -- immutable evidence streams -------------------------------------------
  /**
   * INSERT-only: re-inserting a (runId, endpointId, sampleIndex) key is
   * allowed only while the stored row is still in flight; once the stored
   * status is 'scored' or 'failed' this throws StoreError("IMMUTABLE").
   */
  insertSample(s: SampleResult): Promise<void>;
  /** Duplicate (runId, endpointId, sampleIndex) throws StoreError("DUPLICATE"). */
  insertArtifact(a: Artifact): Promise<void>;
  /** Append-only event log; returns the event with its assigned id. */
  appendEvent(e: RunEvent): Promise<StoredRunEvent>;
  /** Events for a run ordered by id; `afterId` returns only ids > afterId. */
  listEvents(runId: string, afterId?: number): Promise<StoredRunEvent[]>;
  /** Samples ordered by globalIndex. */
  listSamples(runId: string): Promise<SampleResult[]>;
  listArtifacts(runId: string): Promise<Artifact[]>;

  // -- append-only human audit trail ----------------------------------------
  insertAnnotation(a: HumanAnnotation): Promise<void>;
  /** Annotations for a run in append order. */
  listAnnotations(runId: string): Promise<HumanAnnotation[]>;

  // -- head-to-head votes (mutable until `final`) ---------------------------
  upsertVote(v: PairwiseVote): Promise<void>;
  /** Votes ordered by pairIndex. */
  listVotes(runId: string): Promise<PairwiseVote[]>;

  // -- registry reads -------------------------------------------------------
  listProviders(): Promise<Provider[]>;
  listModelDefinitions(): Promise<ModelDefinition[]>;
  listEndpoints(): Promise<ModelEndpoint[]>;
  listPacks(): Promise<BenchmarkPack[]>;

  // -- registry seeding -------------------------------------------------------
  /**
   * Idempotent upsert of registry rows only — never touches run data.
   * Existing rows with the same key are replaced. Insert order matters for
   * FKs: providers → model_definitions → model_endpoints → packs.
   */
  seedRegistry(reg: RegistrySeed): Promise<void>;

  // -- demo data ------------------------------------------------------------
  /**
   * Idempotently loads one demo scenario: registry rows are upserted and any
   * prior data for `fixtures.run.id` is replaced wholesale.
   */
  seedDemo(fixtures: SeedFixtures): Promise<void>;
}
