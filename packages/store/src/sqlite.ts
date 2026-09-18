/**
 * SQLite RunStore over Node 22's built-in `node:sqlite` (`DatabaseSync`).
 * Zero native dependencies. Selected with `MODEL_LAB_STORE=sqlite`.
 *
 * File path: `MODEL_LAB_SQLITE_PATH`, defaulting to
 * `<repo>/artifacts-data/model-lab.db` (repo root located by walking up from
 * `process.cwd()` to the nearest `pnpm-workspace.yaml`).
 *
 * The DDL mirrors supabase/migrations/0001_init.sql in SQLite dialect:
 * TEXT/INTEGER/REAL, booleans as INTEGER 0/1, jsonb + text[] as JSON TEXT,
 * timestamptz as ISO-8601 TEXT, bigint identities as INTEGER PRIMARY KEY
 * AUTOINCREMENT. FK clauses are kept for documentation parity; SQLite leaves
 * `PRAGMA foreign_keys` off by default and this store does not enable it
 * (the interface has no delete path, so cascades never fire).
 *
 * All reads re-validate through the Zod schemas, so a corrupted row fails
 * loudly instead of leaking a malformed object into the app.
 */
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
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
import { validateAnnotation, validateVote } from "./evaluations";

// ---------------------------------------------------------------------------
// path resolution

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function defaultSqlitePath(): string {
  const fromEnv = process.env.MODEL_LAB_SQLITE_PATH;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  return join(findRepoRoot(process.cwd()), "artifacts-data", "model-lab.db");
}

// ---------------------------------------------------------------------------
// row shapes (SQLite column names, SQLite-representable types)

interface RunRow {
  id: string;
  fingerprint: string;
  name: string;
  mode: string;
  status: string;
  pack_slug: string;
  pack_version: string;
  prompt_hash: string;
  samples_per_model: number;
  model_count: number;
  budget_ceiling_usd: number;
  cost_spent_usd: number;
  est_cost_low_usd: number | null;
  est_cost_high_usd: number | null;
  started_at: string;
  completed_at: string | null;
  elapsed_sec: number | null;
  runner_version: string;
  git_commit: string | null;
  composite_browser_pct: number;
  composite_visual_pct: number;
  composite_efficiency_pct: number;
  verdict_label: string | null;
  verdict_narrative: string | null;
  judge_reversal_count: number;
  configuration: string;
}

interface RunModelRow {
  run_id: string;
  endpoint_id: string;
  status: string;
  failed_sample_count: number;
  progress_pct: number;
  current_task: string | null;
  tokens_out: number;
  ttft_ms: number | null;
  total_latency_ms: number | null;
  cost_usd: number;
  visual_score_value: number | null;
  visual_score_n: number | null;
  tests_passed: number | null;
  tests_total: number | null;
  retries: number;
  unseeded: number;
  flag: string | null;
}

interface SampleRow {
  run_id: string;
  endpoint_id: string;
  sample_index: number;
  global_index: number;
  status: string;
  score_value: number | null;
  score_failed: number;
  primary_scorer: string | null;
  cost_usd: number;
  latency_ms: number | null;
  ttft_ms: number | null;
  seed: number | null;
  has_artifact: number;
  tokens_out: number | null;
  raw_ref: string | null;
  raw_excerpt: string;
  scorer_trace: string;
  judge_reversed: number;
  human_reviewed: number;
  human_note: string | null;
}

interface ArtifactRow {
  run_id: string;
  endpoint_id: string;
  sample_index: number;
  path: string;
  filename: string;
  size_kb: number;
  render_ok: number;
  is_best_of_model: number;
  source_ref: string | null;
  source_inline: string | null;
  screenshot_ref: string | null;
  console_lines: string;
  checks: string;
  judge_commentary: string | null;
  sandbox_isolated_origin: number;
  sandbox_network_blocked: number;
  sandbox_exec_limit_sec: number;
  sandbox_size_limit_mb: number;
}

interface EventRow {
  id: number;
  run_id: string;
  t: string;
  type: string;
  endpoint_id: string | null;
  sample_index: number | null;
  level: string;
  message: string;
  payload: string;
}

interface AnnotationRow {
  id: number;
  run_id: string;
  endpoint_id: string;
  sample_index: number;
  note: string;
  score_override: number | null;
  author: string;
  at: string;
}

interface VoteRow {
  run_id: string;
  pair_index: number;
  endpoint_a: string;
  endpoint_b: string;
  criterion: string;
  order_swapped: number;
  vote: string | null;
  confidence: string;
  voted_at: string | null;
  final: number;
}

interface JudgePairRow {
  run_id: string;
  pair_index: number;
  endpoint_a: string;
  endpoint_b: string;
  verdict_ab: string | null;
  verdict_ba: string | null;
  reversed: number;
  excluded_from_tally: number;
  commentary: string | null;
}

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  is_local: number;
  status: string;
  health_latency_ms: number | null;
  models_available: number | null;
  models_loaded: number | null;
  last_tested_at: string | null;
  credential_masked: string;
  credential_store: string;
  warning_message: string | null;
  local_endpoint: string | null;
  local_hardware: string | null;
}

interface ModelDefinitionRow {
  id: string;
  family: string;
  short_name: string;
  identity_color: string;
  context_window_tokens: number;
  capabilities: string;
  supports_seed: number;
}

interface EndpointRow {
  id: string;
  model_id: string;
  provider_id: string;
  deployment: string;
  quantization: string | null;
  hardware: string | null;
  price_in_per_mtok_usd: number | null;
  price_out_per_mtok_usd: number | null;
  status: string;
  runs_count: number;
  reliability_pct: number | null;
  avg_visual_score: number | null;
  last_tested_at: string | null;
}

interface PackRow {
  slug: string;
  version: string;
  name: string;
  kind: string;
  source: string;
  description: string;
  task_count: number;
  browser_check_count: number | null;
  eval_scorer: string | null;
  scorers_summary: string;
  est_cost_per_model_usd: number | null;
  est_output_tokens_per_model: number | null;
  category: string | null;
  license: string;
  prompt: string | null;
  content_hash: string | null;
  last_run_at: string | null;
}

// ---------------------------------------------------------------------------
// small codecs

const b = (v: boolean): number => (v ? 1 : 0);
const nb = (v: number): boolean => v !== 0;
const json = (v: unknown): string => JSON.stringify(v);
const unjson = (v: string): unknown => JSON.parse(v) as unknown;

const SCHEMA_SQL = `
create table if not exists providers (
  id                text primary key,
  name              text not null,
  kind              text not null,
  is_local          integer not null default 0,
  status            text not null default 'disconnected',
  health_latency_ms integer,
  models_available  integer,
  models_loaded     integer,
  last_tested_at    text,
  credential_masked text not null default 'not configured',
  credential_store  text not null default 'unset',
  warning_message   text,
  local_endpoint    text,
  local_hardware    text
);

create table if not exists model_definitions (
  id                    text primary key,
  family                text not null,
  short_name            text not null,
  identity_color        text not null,
  context_window_tokens integer not null,
  capabilities          text not null default '[]',
  supports_seed         integer not null default 0
);

create table if not exists model_endpoints (
  id            text primary key,
  model_id      text not null references model_definitions(id),
  provider_id   text not null references providers(id),
  deployment    text not null,
  quantization  text,
  hardware      text,
  price_in_per_mtok_usd  real,
  price_out_per_mtok_usd real,
  status        text not null default 'healthy',
  runs_count    integer not null default 0,
  reliability_pct real,
  avg_visual_score real,
  last_tested_at text
);

create table if not exists benchmark_packs (
  slug          text not null,
  version       text not null,
  name          text not null,
  kind          text not null,
  source        text not null,
  description   text not null default '',
  task_count    integer not null default 1,
  browser_check_count integer,
  eval_scorer   text,
  scorers_summary text not null default '',
  est_cost_per_model_usd real,
  est_output_tokens_per_model integer,
  category      text,
  license       text not null default 'MIT',
  prompt        text,
  content_hash  text,
  last_run_at   text,
  primary key (slug, version)
);

create table if not exists runs (
  id            text primary key,
  fingerprint   text not null,
  name          text not null,
  mode          text not null,
  status        text not null,
  pack_slug     text not null,
  pack_version  text not null,
  prompt_hash   text not null,
  samples_per_model integer not null,
  model_count   integer not null,
  budget_ceiling_usd real not null,
  cost_spent_usd real not null default 0,
  est_cost_low_usd  real,
  est_cost_high_usd real,
  started_at    text not null,
  completed_at  text,
  elapsed_sec   integer,
  runner_version text not null,
  git_commit    text,
  composite_browser_pct    integer not null default 50,
  composite_visual_pct     integer not null default 35,
  composite_efficiency_pct integer not null default 15,
  verdict_label text,
  verdict_narrative text,
  judge_reversal_count integer not null default 0,
  configuration text not null default '{}'
);

create table if not exists run_models (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  status        text not null,
  failed_sample_count integer not null default 0,
  progress_pct  real not null default 0,
  current_task  text,
  tokens_out    integer not null default 0,
  ttft_ms       integer,
  total_latency_ms integer,
  cost_usd      real not null default 0,
  visual_score_value real,
  visual_score_n     integer,
  tests_passed  integer,
  tests_total   integer,
  retries       integer not null default 0,
  unseeded      integer not null default 0,
  flag          text,
  primary key (run_id, endpoint_id)
);

create table if not exists samples (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  sample_index  integer not null,
  global_index  integer not null,
  status        text not null,
  score_value   real,
  score_failed  integer not null default 0,
  primary_scorer text,
  cost_usd      real not null default 0,
  latency_ms    integer,
  ttft_ms       integer,
  seed          integer,
  has_artifact  integer not null default 0,
  tokens_out    integer,
  raw_ref       text,
  raw_excerpt   text not null default '',
  scorer_trace  text not null default '[]',
  judge_reversed integer not null default 0,
  human_reviewed integer not null default 0,
  human_note    text,
  primary key (run_id, endpoint_id, sample_index)
);

create table if not exists artifacts (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  sample_index  integer not null,
  path          text not null,
  filename      text not null,
  size_kb       real not null,
  render_ok     integer not null,
  is_best_of_model integer not null default 0,
  source_ref    text,
  source_inline text,
  screenshot_ref text,
  console_lines text not null default '[]',
  checks        text not null default '[]',
  judge_commentary text,
  sandbox_isolated_origin integer not null default 1,
  sandbox_network_blocked integer not null default 1,
  sandbox_exec_limit_sec  integer not null default 30,
  sandbox_size_limit_mb   integer not null default 2,
  primary key (run_id, endpoint_id, sample_index)
);

create table if not exists run_events (
  id            integer primary key autoincrement,
  run_id        text not null references runs(id) on delete cascade,
  t             text not null,
  type          text not null,
  endpoint_id   text,
  sample_index  integer,
  level         text not null default 'info',
  message       text not null,
  payload       text not null default '{}'
);
create index if not exists run_events_run_idx on run_events (run_id, t);

create table if not exists judge_pairs (
  run_id        text not null references runs(id) on delete cascade,
  pair_index    integer not null,
  endpoint_a    text not null,
  endpoint_b    text not null,
  verdict_ab    text,
  verdict_ba    text,
  reversed      integer not null default 0,
  excluded_from_tally integer not null default 0,
  commentary    text,
  primary key (run_id, pair_index)
);

create table if not exists pairwise_votes (
  run_id        text not null references runs(id) on delete cascade,
  pair_index    integer not null,
  endpoint_a    text not null,
  endpoint_b    text not null,
  criterion     text not null,
  order_swapped integer not null default 0,
  vote          text,
  confidence    text not null default 'med',
  voted_at      text,
  final         integer not null default 0,
  primary key (run_id, pair_index)
);

create table if not exists annotations (
  id            integer primary key autoincrement,
  run_id        text not null,
  endpoint_id   text not null,
  sample_index  integer not null,
  note          text not null,
  score_override real,
  author        text not null default 'local',
  at            text not null
);

create table if not exists share_exports (
  id            integer primary key autoincrement,
  run_id        text not null references runs(id) on delete cascade,
  filename      text not null,
  template      text not null,
  aspect        text not null,
  theme         text not null,
  exported_at   text not null
);
`;

const TERMINAL_SAMPLE_STATUSES = new Set<string>(["scored", "failed"]);

// Triggers also protect writes from another SQLite connection. They apply to
// future writes without deleting historical annotations in existing databases.
const EVALUATION_GUARDS_SQL = `
create trigger if not exists annotations_require_sample
before insert on annotations
when not exists (
  select 1 from samples s
  join run_models rm on rm.run_id = s.run_id and rm.endpoint_id = s.endpoint_id
  join runs r on r.id = s.run_id
  where s.run_id = new.run_id and s.endpoint_id = new.endpoint_id
    and s.sample_index = new.sample_index
)
begin
  select raise(abort, 'evaluation_reference_not_found');
end;

create trigger if not exists pairwise_votes_require_participants
before insert on pairwise_votes
when not exists (select 1 from runs where id = new.run_id)
  or not exists (select 1 from run_models where run_id = new.run_id and endpoint_id = new.endpoint_a)
  or not exists (select 1 from run_models where run_id = new.run_id and endpoint_id = new.endpoint_b)
begin
  select raise(abort, 'evaluation_reference_not_found');
end;

create trigger if not exists pairwise_votes_validate_update
before update on pairwise_votes
begin
  select raise(abort, 'final_vote_immutable') where old.final = 1;
  select raise(abort, 'evaluation_reference_not_found')
    where not exists (select 1 from runs where id = new.run_id)
      or not exists (select 1 from run_models where run_id = new.run_id and endpoint_id = new.endpoint_a)
      or not exists (select 1 from run_models where run_id = new.run_id and endpoint_id = new.endpoint_b);
end;
`;

function rethrowEvaluationError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("evaluation_reference_not_found")) {
    throw new StoreError(
      "NOT_FOUND",
      "Evaluation references a run, participant or sample that does not exist.",
    );
  }
  if (message.includes("final_vote_immutable")) {
    throw new StoreError("IMMUTABLE", "This pair already has a final vote.");
  }
  throw new StoreError("BACKEND", `SQLite evaluation write failed: ${message}`);
}

export class SqliteStore implements RunStore {
  private readonly db: DatabaseSync;
  /** Exact opened database path, used for adjacent process ownership records. */
  readonly databasePath: string;

  constructor(path: string = defaultSqlitePath()) {
    this.databasePath = resolve(path);
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma busy_timeout = 5000;");
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec(SCHEMA_SQL);
    this.db.exec(EVALUATION_GUARDS_SQL);
  }

  /** Closes the underlying database handle (tests / graceful shutdown). */
  close(): void {
    this.db.close();
  }

  // -- runs -----------------------------------------------------------------

  async listRuns(): Promise<Run[]> {
    return this.many<RunRow>("select * from runs order by started_at desc").map(rowToRun);
  }

  async getRun(runId: string): Promise<RunWithConfig | null> {
    const row = this.one<RunRow>("select * from runs where id = ?", runId);
    if (!row) return null;
    return {
      run: rowToRun(row),
      configuration: RunConfiguration.parse(unjson(row.configuration)),
    };
  }

  async createRun(run: Run, config: RunConfiguration): Promise<void> {
    if (this.one<RunRow>("select id from runs where id = ?", run.id)) {
      throw new StoreError("DUPLICATE", `run ${run.id} already exists`);
    }
    this.db
      .prepare(
        `insert into runs (
           id, fingerprint, name, mode, status, pack_slug, pack_version,
           prompt_hash, samples_per_model, model_count, budget_ceiling_usd,
           cost_spent_usd, est_cost_low_usd, est_cost_high_usd, started_at,
           completed_at, elapsed_sec, runner_version, git_commit,
           composite_browser_pct, composite_visual_pct, composite_efficiency_pct,
           verdict_label, verdict_narrative, judge_reversal_count, configuration
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        run.id,
        run.fingerprint,
        run.name,
        run.mode,
        run.status,
        run.pack.slug,
        run.pack.version,
        run.promptHash,
        run.samplesPerModel,
        run.modelCount,
        run.budgetCeilingUsd,
        run.costSpentUsd,
        run.estCostRangeUsd?.[0] ?? null,
        run.estCostRangeUsd?.[1] ?? null,
        run.startedAt,
        run.completedAt,
        run.elapsedSec,
        run.runnerVersion,
        run.gitCommit,
        run.compositeWeighting.browser,
        run.compositeWeighting.visual,
        run.compositeWeighting.efficiency,
        run.verdict?.label ?? null,
        run.verdict?.narrative ?? null,
        run.judgeReversalCount,
        json(config),
      );
  }

  async updateRunStatus(runId: string, patch: RunStatusPatch): Promise<Run> {
    const existing = await this.getRun(runId);
    if (!existing) throw new StoreError("NOT_FOUND", `run ${runId} not found`);
    const run: Run = { ...existing.run, ...stripUndefined(patch) };
    this.db
      .prepare(
        `update runs set status = ?, cost_spent_usd = ?, completed_at = ?,
           elapsed_sec = ?, verdict_label = ?, verdict_narrative = ?,
           judge_reversal_count = ?
         where id = ?`,
      )
      .run(
        run.status,
        run.costSpentUsd,
        run.completedAt,
        run.elapsedSec,
        run.verdict?.label ?? null,
        run.verdict?.narrative ?? null,
        run.judgeReversalCount,
        runId,
      );
    return run;
  }

  // -- per-model progress ---------------------------------------------------

  async upsertRunModel(rm: RunModel): Promise<void> {
    this.db
      .prepare(
        `insert into run_models (
           run_id, endpoint_id, status, failed_sample_count, progress_pct,
           current_task, tokens_out, ttft_ms, total_latency_ms, cost_usd,
           visual_score_value, visual_score_n, tests_passed, tests_total,
           retries, unseeded, flag
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict (run_id, endpoint_id) do update set
           status = excluded.status,
           failed_sample_count = excluded.failed_sample_count,
           progress_pct = excluded.progress_pct,
           current_task = excluded.current_task,
           tokens_out = excluded.tokens_out,
           ttft_ms = excluded.ttft_ms,
           total_latency_ms = excluded.total_latency_ms,
           cost_usd = excluded.cost_usd,
           visual_score_value = excluded.visual_score_value,
           visual_score_n = excluded.visual_score_n,
           tests_passed = excluded.tests_passed,
           tests_total = excluded.tests_total,
           retries = excluded.retries,
           unseeded = excluded.unseeded,
           flag = excluded.flag`,
      )
      .run(
        rm.runId,
        rm.endpointId,
        rm.status,
        rm.failedSampleCount,
        rm.progressPct,
        rm.currentTask,
        rm.tokensOut,
        rm.ttftMs,
        rm.totalLatencyMs,
        rm.costUsd,
        rm.visualScore?.value ?? null,
        rm.visualScore?.n ?? null,
        rm.testsPassed,
        rm.testsTotal,
        rm.retries,
        b(rm.unseeded),
        rm.flag,
      );
  }

  async listRunModels(runId: string): Promise<RunModel[]> {
    return this.many<RunModelRow>(
      "select * from run_models where run_id = ? order by rowid",
      runId,
    ).map(rowToRunModel);
  }

  // -- immutable evidence streams -------------------------------------------

  async insertSample(s: SampleResult): Promise<void> {
    const existing = this.one<Pick<SampleRow, "status">>(
      "select status from samples where run_id = ? and endpoint_id = ? and sample_index = ?",
      s.runId,
      s.endpointId,
      s.sampleIndex,
    );
    if (existing && TERMINAL_SAMPLE_STATUSES.has(existing.status)) {
      throw new StoreError(
        "IMMUTABLE",
        `sample ${s.runId}/${s.endpointId}#${s.sampleIndex} is ${existing.status} — scored samples are immutable (use annotations)`,
      );
    }
    const scoreValue = s.score !== null && "value" in s.score ? s.score.value : null;
    const scoreFailed = s.score !== null && "failed" in s.score;
    this.db
      .prepare(
        `insert or replace into samples (
           run_id, endpoint_id, sample_index, global_index, status,
           score_value, score_failed, primary_scorer, cost_usd, latency_ms,
           ttft_ms, seed, has_artifact, tokens_out, raw_ref, raw_excerpt,
           scorer_trace, judge_reversed, human_reviewed, human_note
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.runId,
        s.endpointId,
        s.sampleIndex,
        s.globalIndex,
        s.status,
        scoreValue,
        b(scoreFailed),
        s.primaryScorer,
        s.costUsd,
        s.latencyMs,
        s.ttftMs,
        s.seed,
        b(s.hasArtifact),
        s.tokensOut,
        null,
        s.rawExcerpt,
        json(s.scorerTrace),
        b(s.judgeReversed),
        b(s.humanReviewed),
        s.humanNote,
      );
  }

  async insertArtifact(a: Artifact): Promise<void> {
    const existing = this.one<Pick<ArtifactRow, "path">>(
      "select path from artifacts where run_id = ? and endpoint_id = ? and sample_index = ?",
      a.runId,
      a.endpointId,
      a.sampleIndex,
    );
    if (existing) {
      throw new StoreError(
        "DUPLICATE",
        `artifact ${a.runId}/${a.endpointId}#${a.sampleIndex} already exists — artifacts are insert-only`,
      );
    }
    this.db
      .prepare(
        `insert into artifacts (
           run_id, endpoint_id, sample_index, path, filename, size_kb,
           render_ok, is_best_of_model, source_ref, source_inline,
           screenshot_ref, console_lines, checks, judge_commentary,
           sandbox_isolated_origin, sandbox_network_blocked,
           sandbox_exec_limit_sec, sandbox_size_limit_mb
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        a.runId,
        a.endpointId,
        a.sampleIndex,
        a.path,
        a.filename,
        a.sizeKb,
        b(a.renderOk),
        b(a.isBestOfModel),
        null,
        a.source,
        a.screenshotRef,
        json(a.consoleLines),
        json(a.checks),
        a.judgeCommentary,
        b(a.sandbox.isolatedOrigin),
        b(a.sandbox.networkBlocked),
        a.sandbox.execLimitSec,
        a.sandbox.sizeLimitMb,
      );
  }

  async appendEvent(e: RunEvent): Promise<StoredRunEvent> {
    const result = this.db
      .prepare(
        `insert into run_events (run_id, t, type, endpoint_id, sample_index, level, message, payload)
         values (?,?,?,?,?,?,?,?)`,
      )
      .run(e.runId, e.t, e.type, e.endpointId, e.sampleIndex, e.level, e.message, json(e.payload));
    return { ...RunEvent.parse(e), id: Number(result.lastInsertRowid) };
  }

  async listEvents(runId: string, afterId?: number): Promise<StoredRunEvent[]> {
    return this.many<EventRow>(
      "select * from run_events where run_id = ? and id > ? order by id asc",
      runId,
      afterId ?? 0,
    ).map(rowToEvent);
  }

  async listSamples(runId: string): Promise<SampleResult[]> {
    return this.many<SampleRow>(
      "select * from samples where run_id = ? order by global_index asc",
      runId,
    ).map(rowToSample);
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    return this.many<ArtifactRow>(
      "select * from artifacts where run_id = ? order by rowid",
      runId,
    ).map(rowToArtifact);
  }

  // -- append-only human audit trail ----------------------------------------

  async insertAnnotation(a: HumanAnnotation): Promise<void> {
    validateAnnotation(a);
    try {
      this.db
        .prepare(
          `insert into annotations (run_id, endpoint_id, sample_index, note, score_override, author, at)
           values (?,?,?,?,?,?,?)`,
        )
        .run(a.runId, a.endpointId, a.sampleIndex, a.note, a.scoreOverride, a.author, a.at);
    } catch (error) {
      rethrowEvaluationError(error);
    }
  }

  async listAnnotations(runId: string): Promise<HumanAnnotation[]> {
    return this.many<AnnotationRow>(
      "select * from annotations where run_id = ? order by id asc",
      runId,
    ).map((r) =>
      HumanAnnotation.parse({
        runId: r.run_id,
        endpointId: r.endpoint_id,
        sampleIndex: r.sample_index,
        note: r.note,
        scoreOverride: r.score_override,
        author: r.author,
        at: r.at,
      }),
    );
  }

  // -- head-to-head votes ---------------------------------------------------

  async upsertVote(v: PairwiseVote): Promise<void> {
    validateVote(v);
    // NOTE: pairTotal is not a column (0001_init.sql); it is reconstructed on
    // read as the number of vote rows in the run.
    try {
      this.db
        .prepare(
          `insert into pairwise_votes (
           run_id, pair_index, endpoint_a, endpoint_b, criterion,
           order_swapped, vote, confidence, voted_at, final
         ) values (?,?,?,?,?,?,?,?,?,?)
         on conflict (run_id, pair_index) do update set
           endpoint_a = excluded.endpoint_a,
           endpoint_b = excluded.endpoint_b,
           criterion = excluded.criterion,
           order_swapped = excluded.order_swapped,
           vote = excluded.vote,
           confidence = excluded.confidence,
           voted_at = excluded.voted_at,
           final = excluded.final`,
        )
        .run(
          v.runId,
          v.pairIndex,
          v.pairing[0],
          v.pairing[1],
          v.criterion,
          b(v.orderSwapped),
          v.vote,
          v.confidence,
          v.votedAt,
          b(v.final),
        );
    } catch (error) {
      rethrowEvaluationError(error);
    }
  }

  async listVotes(runId: string): Promise<PairwiseVote[]> {
    const rows = this.many<VoteRow>(
      "select * from pairwise_votes where run_id = ? order by pair_index asc",
      runId,
    );
    return rows.map((r) =>
      PairwiseVote.parse({
        runId: r.run_id,
        pairIndex: r.pair_index,
        pairTotal: rows.length,
        pairing: [r.endpoint_a, r.endpoint_b],
        criterion: r.criterion,
        orderSwapped: nb(r.order_swapped),
        vote: r.vote,
        confidence: r.confidence,
        votedAt: r.voted_at,
        final: nb(r.final),
      }),
    );
  }

  // -- LLM-judge pairwise verdicts ------------------------------------------

  async insertJudgePair(p: JudgePairResult): Promise<void> {
    this.db
      .prepare(
        `insert or replace into judge_pairs (
           run_id, pair_index, endpoint_a, endpoint_b, verdict_ab, verdict_ba,
           reversed, excluded_from_tally, commentary
         ) values (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.runId,
        p.pairIndex,
        p.pairing[0],
        p.pairing[1],
        p.verdictAB,
        p.verdictBA,
        b(p.reversed),
        b(p.excludedFromTally),
        p.commentary,
      );
  }

  async listJudgePairs(runId: string): Promise<JudgePairResult[]> {
    return this.many<JudgePairRow>(
      "select * from judge_pairs where run_id = ? order by pair_index asc",
      runId,
    ).map((r) =>
      JudgePairResult.parse({
        runId: r.run_id,
        pairIndex: r.pair_index,
        pairing: [r.endpoint_a, r.endpoint_b],
        verdictAB: r.verdict_ab,
        verdictBA: r.verdict_ba,
        reversed: nb(r.reversed),
        excludedFromTally: nb(r.excluded_from_tally),
        commentary: r.commentary,
      }),
    );
  }

  // -- registry reads -------------------------------------------------------

  async listProviders(): Promise<Provider[]> {
    return this.many<ProviderRow>("select * from providers order by rowid").map((r) =>
      Provider.parse({
        id: r.id,
        name: r.name,
        kind: r.kind,
        status: r.status,
        isLocal: nb(r.is_local),
        healthLatencyMs: r.health_latency_ms,
        modelsAvailable: r.models_available,
        modelsLoaded: r.models_loaded,
        lastTestedAt: r.last_tested_at,
        credentialMasked: r.credential_masked,
        credentialStore: r.credential_store,
        warning: r.warning_message === null ? null : { message: r.warning_message },
        localEndpoint: r.local_endpoint,
        localHardware: r.local_hardware,
      }),
    );
  }

  async listModelDefinitions(): Promise<ModelDefinition[]> {
    return this.many<ModelDefinitionRow>("select * from model_definitions order by rowid").map(
      (r) =>
        ModelDefinition.parse({
          id: r.id,
          family: r.family,
          shortName: r.short_name,
          identityColor: r.identity_color,
          contextWindowTokens: r.context_window_tokens,
          capabilities: unjson(r.capabilities),
          supportsSeed: nb(r.supports_seed),
        }),
    );
  }

  async listEndpoints(): Promise<ModelEndpoint[]> {
    return this.many<EndpointRow>("select * from model_endpoints order by rowid").map((r) =>
      ModelEndpoint.parse({
        id: r.id,
        modelId: r.model_id,
        providerId: r.provider_id,
        deployment: r.deployment,
        quantization: r.quantization,
        hardware: r.hardware,
        priceInPerMtokUsd: r.price_in_per_mtok_usd,
        priceOutPerMtokUsd: r.price_out_per_mtok_usd,
        status: r.status,
        runsCount: r.runs_count,
        reliabilityPct: r.reliability_pct,
        avgVisualScore: r.avg_visual_score,
        lastTestedAt: r.last_tested_at,
      }),
    );
  }

  async listPacks(): Promise<BenchmarkPack[]> {
    return this.many<PackRow>("select * from benchmark_packs order by rowid").map((r) =>
      BenchmarkPack.parse({
        slug: r.slug,
        name: r.name,
        version: r.version,
        kind: r.kind,
        source: r.source,
        description: r.description,
        taskCount: r.task_count,
        browserCheckCount: r.browser_check_count,
        evalScorer: r.eval_scorer,
        scorersSummary: r.scorers_summary,
        estCostPerModelUsd: r.est_cost_per_model_usd,
        estOutputTokensPerModel: r.est_output_tokens_per_model,
        category: r.category,
        license: r.license,
        prompt: r.prompt,
        lastRunAt: r.last_run_at,
      }),
    );
  }

  // -- registry seeding -------------------------------------------------------

  async seedRegistry(reg: RegistrySeed): Promise<void> {
    // INSERT OR REPLACE per table, in FK order:
    // providers → model_definitions → model_endpoints → benchmark_packs.
    for (const p of reg.providers) this.upsertProvider(p);
    for (const m of reg.modelDefinitions) this.upsertModelDefinition(m);
    for (const e of reg.endpoints) this.upsertEndpoint(e);
    for (const p of reg.packs) this.upsertPack(p);
  }

  // -- demo data ------------------------------------------------------------

  async seedDemo(fixtures: SeedFixtures): Promise<void> {
    this.db.exec("begin");
    try {
      await this.seedRegistry(fixtures);

      // Replace prior demo-run data wholesale (FK enforcement is off, so
      // children are deleted explicitly).
      const runId = fixtures.run.id;
      for (const table of [
        "annotations",
        "pairwise_votes",
        "judge_pairs",
        "run_events",
        "artifacts",
        "samples",
        "run_models",
        "share_exports",
      ]) {
        this.db.prepare(`delete from ${table} where run_id = ?`).run(runId);
      }
      this.db.prepare("delete from runs where id = ?").run(runId);

      await this.createRun(fixtures.run, fixtures.configuration);
      for (const rm of fixtures.runModels) await this.upsertRunModel(rm);
      for (const s of fixtures.samples) await this.insertSample(s);
      for (const a of fixtures.artifacts) await this.insertArtifact(a);
      for (const e of fixtures.events) await this.appendEvent(e);
      for (const a of fixtures.annotations ?? []) await this.insertAnnotation(a);
      for (const v of fixtures.votes ?? []) await this.upsertVote(v);
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
  }

  // -- internals ------------------------------------------------------------

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  private many<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private upsertProvider(p: Provider): void {
    this.db
      .prepare(
        `insert or replace into providers (
           id, name, kind, is_local, status, health_latency_ms,
           models_available, models_loaded, last_tested_at, credential_masked,
           credential_store, warning_message, local_endpoint, local_hardware
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id,
        p.name,
        p.kind,
        b(p.isLocal),
        p.status,
        p.healthLatencyMs,
        p.modelsAvailable,
        p.modelsLoaded,
        p.lastTestedAt,
        p.credentialMasked,
        p.credentialStore,
        p.warning?.message ?? null,
        p.localEndpoint,
        p.localHardware,
      );
  }

  private upsertModelDefinition(m: ModelDefinition): void {
    this.db
      .prepare(
        `insert or replace into model_definitions (
           id, family, short_name, identity_color, context_window_tokens,
           capabilities, supports_seed
         ) values (?,?,?,?,?,?,?)`,
      )
      .run(
        m.id,
        m.family,
        m.shortName,
        m.identityColor,
        m.contextWindowTokens,
        json(m.capabilities),
        b(m.supportsSeed),
      );
  }

  private upsertEndpoint(e: ModelEndpoint): void {
    // apiModel is intentionally not a column: registry persistence doesn't
    // need it; listEndpoints' ModelEndpoint.parse defaults it to null.
    this.db
      .prepare(
        `insert or replace into model_endpoints (
           id, model_id, provider_id, deployment, quantization, hardware,
           price_in_per_mtok_usd, price_out_per_mtok_usd, status, runs_count,
           reliability_pct, avg_visual_score, last_tested_at
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.id,
        e.modelId,
        e.providerId,
        e.deployment,
        e.quantization,
        e.hardware,
        e.priceInPerMtokUsd,
        e.priceOutPerMtokUsd,
        e.status,
        e.runsCount,
        e.reliabilityPct,
        e.avgVisualScore,
        e.lastTestedAt,
      );
  }

  private upsertPack(p: BenchmarkPack): void {
    this.db
      .prepare(
        `insert or replace into benchmark_packs (
           slug, version, name, kind, source, description, task_count,
           browser_check_count, eval_scorer, scorers_summary,
           est_cost_per_model_usd, est_output_tokens_per_model, category,
           license, prompt, content_hash, last_run_at
         ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.slug,
        p.version,
        p.name,
        p.kind,
        p.source,
        p.description,
        p.taskCount,
        p.browserCheckCount,
        p.evalScorer,
        p.scorersSummary,
        p.estCostPerModelUsd,
        p.estOutputTokensPerModel,
        p.category,
        p.license,
        p.prompt,
        null,
        p.lastRunAt,
      );
  }
}

// ---------------------------------------------------------------------------
// row → domain mappers (validated through Zod on the way out)

function rowToRun(r: RunRow): Run {
  return Run.parse({
    id: r.id,
    fingerprint: r.fingerprint,
    name: r.name,
    mode: r.mode,
    status: r.status,
    pack: { slug: r.pack_slug, version: r.pack_version },
    promptHash: r.prompt_hash,
    samplesPerModel: r.samples_per_model,
    modelCount: r.model_count,
    budgetCeilingUsd: r.budget_ceiling_usd,
    costSpentUsd: r.cost_spent_usd,
    estCostRangeUsd:
      r.est_cost_low_usd === null || r.est_cost_high_usd === null
        ? null
        : [r.est_cost_low_usd, r.est_cost_high_usd],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    elapsedSec: r.elapsed_sec,
    runnerVersion: r.runner_version,
    gitCommit: r.git_commit,
    compositeWeighting: {
      browser: r.composite_browser_pct,
      visual: r.composite_visual_pct,
      efficiency: r.composite_efficiency_pct,
    },
    verdict:
      r.verdict_label === null || r.verdict_narrative === null
        ? null
        : { label: r.verdict_label, narrative: r.verdict_narrative },
    judgeReversalCount: r.judge_reversal_count,
  });
}

function rowToRunModel(r: RunModelRow): RunModel {
  return RunModel.parse({
    runId: r.run_id,
    endpointId: r.endpoint_id,
    status: r.status,
    failedSampleCount: r.failed_sample_count,
    progressPct: r.progress_pct,
    currentTask: r.current_task,
    tokensOut: r.tokens_out,
    ttftMs: r.ttft_ms,
    totalLatencyMs: r.total_latency_ms,
    costUsd: r.cost_usd,
    visualScore:
      r.visual_score_value === null || r.visual_score_n === null
        ? null
        : { value: r.visual_score_value, n: r.visual_score_n },
    testsPassed: r.tests_passed,
    testsTotal: r.tests_total,
    retries: r.retries,
    unseeded: nb(r.unseeded),
    flag: r.flag,
  });
}

function rowToSample(r: SampleRow): SampleResult {
  return SampleResult.parse({
    runId: r.run_id,
    endpointId: r.endpoint_id,
    sampleIndex: r.sample_index,
    globalIndex: r.global_index,
    status: r.status,
    score: nb(r.score_failed)
      ? { failed: true }
      : r.score_value === null
        ? null
        : { value: r.score_value },
    primaryScorer: r.primary_scorer,
    costUsd: r.cost_usd,
    latencyMs: r.latency_ms,
    ttftMs: r.ttft_ms,
    seed: r.seed,
    hasArtifact: nb(r.has_artifact),
    tokensOut: r.tokens_out,
    rawExcerpt: r.raw_excerpt,
    scorerTrace: unjson(r.scorer_trace),
    judgeReversed: nb(r.judge_reversed),
    humanReviewed: nb(r.human_reviewed),
    humanNote: r.human_note,
  });
}

function rowToArtifact(r: ArtifactRow): Artifact {
  return Artifact.parse({
    runId: r.run_id,
    endpointId: r.endpoint_id,
    sampleIndex: r.sample_index,
    path: r.path,
    filename: r.filename,
    sizeKb: r.size_kb,
    renderOk: nb(r.render_ok),
    isBestOfModel: nb(r.is_best_of_model),
    source: r.source_inline ?? "",
    screenshotRef: r.screenshot_ref,
    consoleLines: unjson(r.console_lines),
    checks: unjson(r.checks),
    judgeCommentary: r.judge_commentary,
    sandbox: {
      isolatedOrigin: nb(r.sandbox_isolated_origin),
      networkBlocked: nb(r.sandbox_network_blocked),
      execLimitSec: r.sandbox_exec_limit_sec,
      sizeLimitMb: r.sandbox_size_limit_mb,
    },
  });
}

function rowToEvent(r: EventRow): StoredRunEvent {
  return {
    ...RunEvent.parse({
      t: r.t,
      type: r.type,
      runId: r.run_id,
      endpointId: r.endpoint_id,
      sampleIndex: r.sample_index,
      level: r.level,
      message: r.message,
      payload: unjson(r.payload),
    }),
    id: r.id,
  };
}

/** Drops `undefined` members so a patch spread never clobbers fields. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
