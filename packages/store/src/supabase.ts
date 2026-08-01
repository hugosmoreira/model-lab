/**
 * Supabase RunStore. Selected with `MODEL_LAB_STORE=supabase`.
 *
 * SERVER-ONLY: constructed with the service-role key
 * (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, see docs/SUPABASE_SETUP.md).
 * Neither variable is ever `NEXT_PUBLIC_`; the browser never talks to
 * Supabase. Construction throws a clear StoreError("CONFIG") when either
 * variable is missing.
 *
 * Column mapping is exact against supabase/migrations/0001_init.sql —
 * snake_case rows ↔ camelCase domain objects via the typed row interfaces
 * below (no `any` leaks past this module's casts of the untyped
 * supabase-js responses). All reads re-validate through the Zod schemas.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
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

// ---------------------------------------------------------------------------
// row shapes (Postgres column names; jsonb arrives pre-parsed as unknown)

interface RunRow {
  id: string; fingerprint: string; name: string; mode: string; status: string;
  pack_slug: string; pack_version: string; prompt_hash: string;
  samples_per_model: number; model_count: number;
  budget_ceiling_usd: number; cost_spent_usd: number;
  est_cost_low_usd: number | null; est_cost_high_usd: number | null;
  started_at: string; completed_at: string | null; elapsed_sec: number | null;
  runner_version: string; git_commit: string | null;
  composite_browser_pct: number; composite_visual_pct: number;
  composite_efficiency_pct: number;
  verdict_label: string | null; verdict_narrative: string | null;
  judge_reversal_count: number; configuration: unknown;
}

interface RunModelRow {
  run_id: string; endpoint_id: string; status: string;
  failed_sample_count: number; progress_pct: number; current_task: string | null;
  tokens_out: number; ttft_ms: number | null; total_latency_ms: number | null;
  cost_usd: number; visual_score_value: number | null; visual_score_n: number | null;
  tests_passed: number | null; tests_total: number | null; retries: number;
  unseeded: boolean; flag: string | null;
}

interface SampleRow {
  run_id: string; endpoint_id: string; sample_index: number; global_index: number;
  status: string; score_value: number | null; score_failed: boolean;
  primary_scorer: string | null; cost_usd: number; latency_ms: number | null;
  ttft_ms: number | null; seed: number | null; has_artifact: boolean;
  tokens_out: number | null; raw_ref: string | null; raw_excerpt: string;
  scorer_trace: unknown; judge_reversed: boolean; human_reviewed: boolean;
  human_note: string | null;
}

interface ArtifactRow {
  run_id: string; endpoint_id: string; sample_index: number;
  path: string; filename: string; size_kb: number; render_ok: boolean;
  is_best_of_model: boolean; source_ref: string | null;
  source_inline: string | null; screenshot_ref: string | null;
  console_lines: unknown; checks: unknown; judge_commentary: string | null;
  sandbox_isolated_origin: boolean; sandbox_network_blocked: boolean;
  sandbox_exec_limit_sec: number; sandbox_size_limit_mb: number;
}

interface EventRow {
  id: number; run_id: string; t: string; type: string;
  endpoint_id: string | null; sample_index: number | null;
  level: string; message: string; payload: unknown;
}

interface AnnotationRow {
  id: number; run_id: string; endpoint_id: string; sample_index: number;
  note: string; score_override: number | null; author: string; at: string;
}

interface VoteRow {
  run_id: string; pair_index: number; endpoint_a: string; endpoint_b: string;
  criterion: string; order_swapped: boolean; vote: string | null;
  confidence: string; voted_at: string | null; final: boolean;
}

interface ProviderRow {
  id: string; name: string; kind: string; is_local: boolean; status: string;
  health_latency_ms: number | null; models_available: number | null;
  models_loaded: number | null; last_tested_at: string | null;
  credential_masked: string; credential_store: string;
  warning_message: string | null; local_endpoint: string | null;
  local_hardware: string | null;
}

interface ModelDefinitionRow {
  id: string; family: string; short_name: string; identity_color: string;
  context_window_tokens: number; capabilities: string[]; supports_seed: boolean;
}

interface EndpointRow {
  id: string; model_id: string; provider_id: string; deployment: string;
  quantization: string | null; hardware: string | null;
  price_in_per_mtok_usd: number | null; price_out_per_mtok_usd: number | null;
  status: string; runs_count: number; reliability_pct: number | null;
  avg_visual_score: number | null; last_tested_at: string | null;
}

interface PackRow {
  slug: string; version: string; name: string; kind: string; source: string;
  description: string; task_count: number; browser_check_count: number | null;
  eval_scorer: string | null; scorers_summary: string;
  est_cost_per_model_usd: number | null; est_output_tokens_per_model: number | null;
  category: string | null; license: string; prompt: string | null;
  content_hash: string | null; last_run_at: string | null;
}

const TERMINAL_SAMPLE_STATUSES = new Set<string>(["scored", "failed"]);

export interface SupabaseStoreOptions {
  url?: string;
  serviceRoleKey?: string;
}

export class SupabaseStore implements RunStore {
  private readonly client: SupabaseClient;

  constructor(options: SupabaseStoreOptions = {}) {
    const url = options.url ?? process.env.SUPABASE_URL;
    const key = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      const missing = [
        !url ? "SUPABASE_URL" : null,
        !key ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter((v): v is string => v !== null);
      throw new StoreError(
        "CONFIG",
        `SupabaseStore: missing ${missing.join(" and ")}. Set them in the ` +
          "server environment (see docs/SUPABASE_SETUP.md) or use " +
          "MODEL_LAB_STORE=memory|sqlite.",
      );
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // -- runs -----------------------------------------------------------------

  async listRuns(): Promise<Run[]> {
    const { data, error } = await this.client
      .from("runs").select("*").order("started_at", { ascending: false });
    this.must(error, "listRuns");
    return ((data ?? []) as RunRow[]).map(rowToRun);
  }

  async getRun(runId: string): Promise<RunWithConfig | null> {
    const { data, error } = await this.client
      .from("runs").select("*").eq("id", runId).maybeSingle();
    this.must(error, "getRun");
    if (!data) return null;
    const row = data as RunRow;
    return {
      run: rowToRun(row),
      configuration: RunConfiguration.parse(row.configuration),
    };
  }

  async createRun(run: Run, config: RunConfiguration): Promise<void> {
    const { data: existing, error: selErr } = await this.client
      .from("runs").select("id").eq("id", run.id).maybeSingle();
    this.must(selErr, "createRun");
    if (existing) throw new StoreError("DUPLICATE", `run ${run.id} already exists`);
    const { error } = await this.client.from("runs").insert(runToRow(run, config));
    this.must(error, "createRun");
  }

  async updateRunStatus(runId: string, patch: RunStatusPatch): Promise<Run> {
    const existing = await this.getRun(runId);
    if (!existing) throw new StoreError("NOT_FOUND", `run ${runId} not found`);
    const run: Run = { ...existing.run, ...stripUndefined(patch) };
    const { error } = await this.client
      .from("runs")
      .update({
        status: run.status,
        cost_spent_usd: run.costSpentUsd,
        completed_at: run.completedAt,
        elapsed_sec: run.elapsedSec,
        verdict_label: run.verdict?.label ?? null,
        verdict_narrative: run.verdict?.narrative ?? null,
        judge_reversal_count: run.judgeReversalCount,
      })
      .eq("id", runId);
    this.must(error, "updateRunStatus");
    return run;
  }

  // -- per-model progress ---------------------------------------------------

  async upsertRunModel(rm: RunModel): Promise<void> {
    const { error } = await this.client
      .from("run_models")
      .upsert(runModelToRow(rm), { onConflict: "run_id,endpoint_id" });
    this.must(error, "upsertRunModel");
  }

  async listRunModels(runId: string): Promise<RunModel[]> {
    const { data, error } = await this.client
      .from("run_models").select("*").eq("run_id", runId)
      .order("endpoint_id", { ascending: true });
    this.must(error, "listRunModels");
    return ((data ?? []) as RunModelRow[]).map(rowToRunModel);
  }

  // -- immutable evidence streams -------------------------------------------

  async insertSample(s: SampleResult): Promise<void> {
    const { data: existing, error: selErr } = await this.client
      .from("samples").select("status")
      .eq("run_id", s.runId).eq("endpoint_id", s.endpointId)
      .eq("sample_index", s.sampleIndex).maybeSingle();
    this.must(selErr, "insertSample");
    const priorStatus = (existing as Pick<SampleRow, "status"> | null)?.status;
    if (priorStatus !== undefined && TERMINAL_SAMPLE_STATUSES.has(priorStatus)) {
      throw new StoreError(
        "IMMUTABLE",
        `sample ${s.runId}/${s.endpointId}#${s.sampleIndex} is ${priorStatus} — scored samples are immutable (use annotations)`,
      );
    }
    const { error } = await this.client
      .from("samples")
      .upsert(sampleToRow(s), { onConflict: "run_id,endpoint_id,sample_index" });
    this.must(error, "insertSample");
  }

  async insertArtifact(a: Artifact): Promise<void> {
    const { data: existing, error: selErr } = await this.client
      .from("artifacts").select("path")
      .eq("run_id", a.runId).eq("endpoint_id", a.endpointId)
      .eq("sample_index", a.sampleIndex).maybeSingle();
    this.must(selErr, "insertArtifact");
    if (existing) {
      throw new StoreError(
        "DUPLICATE",
        `artifact ${a.runId}/${a.endpointId}#${a.sampleIndex} already exists — artifacts are insert-only`,
      );
    }
    const { error } = await this.client.from("artifacts").insert(artifactToRow(a));
    this.must(error, "insertArtifact");
  }

  async appendEvent(e: RunEvent): Promise<StoredRunEvent> {
    const { data, error } = await this.client
      .from("run_events").insert(eventToRow(e)).select("id").single();
    this.must(error, "appendEvent");
    const id = (data as Pick<EventRow, "id"> | null)?.id;
    if (id === undefined) {
      throw new StoreError("BACKEND", "appendEvent: no id returned");
    }
    return { ...RunEvent.parse(e), id };
  }

  async listEvents(runId: string, afterId?: number): Promise<StoredRunEvent[]> {
    const { data, error } = await this.client
      .from("run_events").select("*").eq("run_id", runId)
      .gt("id", afterId ?? 0).order("id", { ascending: true });
    this.must(error, "listEvents");
    return ((data ?? []) as EventRow[]).map(rowToEvent);
  }

  async listSamples(runId: string): Promise<SampleResult[]> {
    const { data, error } = await this.client
      .from("samples").select("*").eq("run_id", runId)
      .order("global_index", { ascending: true });
    this.must(error, "listSamples");
    return ((data ?? []) as SampleRow[]).map(rowToSample);
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    const { data, error } = await this.client
      .from("artifacts").select("*").eq("run_id", runId)
      .order("endpoint_id", { ascending: true })
      .order("sample_index", { ascending: true });
    this.must(error, "listArtifacts");
    return ((data ?? []) as ArtifactRow[]).map(rowToArtifact);
  }

  // -- append-only human audit trail ----------------------------------------

  async insertAnnotation(a: HumanAnnotation): Promise<void> {
    const { error } = await this.client.from("annotations").insert({
      run_id: a.runId,
      endpoint_id: a.endpointId,
      sample_index: a.sampleIndex,
      note: a.note,
      score_override: a.scoreOverride,
      author: a.author,
      at: a.at,
    });
    this.must(error, "insertAnnotation");
  }

  async listAnnotations(runId: string): Promise<HumanAnnotation[]> {
    const { data, error } = await this.client
      .from("annotations").select("*").eq("run_id", runId)
      .order("id", { ascending: true });
    this.must(error, "listAnnotations");
    return ((data ?? []) as AnnotationRow[]).map((r) =>
      HumanAnnotation.parse({
        runId: r.run_id, endpointId: r.endpoint_id, sampleIndex: r.sample_index,
        note: r.note, scoreOverride: r.score_override, author: r.author, at: r.at,
      }),
    );
  }

  // -- head-to-head votes ---------------------------------------------------

  async upsertVote(v: PairwiseVote): Promise<void> {
    // NOTE: pairTotal is not a column (0001_init.sql); it is reconstructed on
    // read as the number of vote rows in the run.
    const { error } = await this.client.from("pairwise_votes").upsert(
      {
        run_id: v.runId,
        pair_index: v.pairIndex,
        endpoint_a: v.pairing[0],
        endpoint_b: v.pairing[1],
        criterion: v.criterion,
        order_swapped: v.orderSwapped,
        vote: v.vote,
        confidence: v.confidence,
        voted_at: v.votedAt,
        final: v.final,
      },
      { onConflict: "run_id,pair_index" },
    );
    this.must(error, "upsertVote");
  }

  async listVotes(runId: string): Promise<PairwiseVote[]> {
    const { data, error } = await this.client
      .from("pairwise_votes").select("*").eq("run_id", runId)
      .order("pair_index", { ascending: true });
    this.must(error, "listVotes");
    const rows = (data ?? []) as VoteRow[];
    return rows.map((r) =>
      PairwiseVote.parse({
        runId: r.run_id, pairIndex: r.pair_index, pairTotal: rows.length,
        pairing: [r.endpoint_a, r.endpoint_b], criterion: r.criterion,
        orderSwapped: r.order_swapped, vote: r.vote, confidence: r.confidence,
        votedAt: r.voted_at, final: r.final,
      }),
    );
  }

  // -- registry reads -------------------------------------------------------

  async listProviders(): Promise<Provider[]> {
    const { data, error } = await this.client
      .from("providers").select("*").order("id", { ascending: true });
    this.must(error, "listProviders");
    return ((data ?? []) as ProviderRow[]).map((r) =>
      Provider.parse({
        id: r.id, name: r.name, kind: r.kind, status: r.status,
        isLocal: r.is_local, healthLatencyMs: r.health_latency_ms,
        modelsAvailable: r.models_available, modelsLoaded: r.models_loaded,
        lastTestedAt: r.last_tested_at, credentialMasked: r.credential_masked,
        credentialStore: r.credential_store,
        warning: r.warning_message === null ? null : { message: r.warning_message },
        localEndpoint: r.local_endpoint, localHardware: r.local_hardware,
      }),
    );
  }

  async listModelDefinitions(): Promise<ModelDefinition[]> {
    const { data, error } = await this.client
      .from("model_definitions").select("*").order("id", { ascending: true });
    this.must(error, "listModelDefinitions");
    return ((data ?? []) as ModelDefinitionRow[]).map((r) =>
      ModelDefinition.parse({
        id: r.id, family: r.family, shortName: r.short_name,
        identityColor: r.identity_color,
        contextWindowTokens: r.context_window_tokens,
        capabilities: r.capabilities, supportsSeed: r.supports_seed,
      }),
    );
  }

  async listEndpoints(): Promise<ModelEndpoint[]> {
    const { data, error } = await this.client
      .from("model_endpoints").select("*").order("id", { ascending: true });
    this.must(error, "listEndpoints");
    return ((data ?? []) as EndpointRow[]).map((r) =>
      ModelEndpoint.parse({
        id: r.id, modelId: r.model_id, providerId: r.provider_id,
        deployment: r.deployment, quantization: r.quantization,
        hardware: r.hardware, priceInPerMtokUsd: r.price_in_per_mtok_usd,
        priceOutPerMtokUsd: r.price_out_per_mtok_usd, status: r.status,
        runsCount: r.runs_count, reliabilityPct: r.reliability_pct,
        avgVisualScore: r.avg_visual_score, lastTestedAt: r.last_tested_at,
      }),
    );
  }

  async listPacks(): Promise<BenchmarkPack[]> {
    const { data, error } = await this.client
      .from("benchmark_packs").select("*")
      .order("slug", { ascending: true }).order("version", { ascending: true });
    this.must(error, "listPacks");
    return ((data ?? []) as PackRow[]).map((r) =>
      BenchmarkPack.parse({
        slug: r.slug, name: r.name, version: r.version, kind: r.kind,
        source: r.source, description: r.description, taskCount: r.task_count,
        browserCheckCount: r.browser_check_count, evalScorer: r.eval_scorer,
        scorersSummary: r.scorers_summary,
        estCostPerModelUsd: r.est_cost_per_model_usd,
        estOutputTokensPerModel: r.est_output_tokens_per_model,
        category: r.category, license: r.license, prompt: r.prompt,
        lastRunAt: r.last_run_at,
      }),
    );
  }

  // -- registry seeding -------------------------------------------------------

  async seedRegistry(reg: RegistrySeed): Promise<void> {
    const upsert = async (
      table: string,
      rows: Record<string, unknown>[],
      onConflict: string,
    ): Promise<void> => {
      if (rows.length === 0) return;
      const { error } = await this.client.from(table).upsert(rows, { onConflict });
      this.must(error, `seedRegistry:${table}`);
    };

    // Upsert order matters for FKs: model_endpoints references both
    // providers(id) and model_definitions(id).
    await upsert("providers", reg.providers.map(providerToRow), "id");
    await upsert(
      "model_definitions",
      reg.modelDefinitions.map(modelDefinitionToRow),
      "id",
    );
    await upsert("model_endpoints", reg.endpoints.map(endpointToRow), "id");
    await upsert("benchmark_packs", reg.packs.map(packToRow), "slug,version");
  }

  // -- demo data ------------------------------------------------------------

  async seedDemo(fixtures: SeedFixtures): Promise<void> {
    await this.seedRegistry(fixtures);

    // Replace prior demo-run data wholesale.
    const runId = fixtures.run.id;
    for (const table of [
      "annotations", "pairwise_votes", "judge_pairs", "run_events",
      "artifacts", "samples", "run_models", "share_exports",
    ]) {
      const { error } = await this.client.from(table).delete().eq("run_id", runId);
      this.must(error, `seedDemo:delete:${table}`);
    }
    {
      const { error } = await this.client.from("runs").delete().eq("id", runId);
      this.must(error, "seedDemo:delete:runs");
    }

    await this.createRun(fixtures.run, fixtures.configuration);
    if (fixtures.runModels.length > 0) {
      const { error } = await this.client
        .from("run_models").insert(fixtures.runModels.map(runModelToRow));
      this.must(error, "seedDemo:run_models");
    }
    if (fixtures.samples.length > 0) {
      const { error } = await this.client
        .from("samples").insert(fixtures.samples.map(sampleToRow));
      this.must(error, "seedDemo:samples");
    }
    if (fixtures.artifacts.length > 0) {
      const { error } = await this.client
        .from("artifacts").insert(fixtures.artifacts.map(artifactToRow));
      this.must(error, "seedDemo:artifacts");
    }
    for (const e of fixtures.events) await this.appendEvent(e); // ordered ids
    for (const a of fixtures.annotations ?? []) await this.insertAnnotation(a);
    for (const v of fixtures.votes ?? []) await this.upsertVote(v);
  }

  // -- internals ------------------------------------------------------------

  private must(error: { message: string } | null, op: string): void {
    if (error) throw new StoreError("BACKEND", `SupabaseStore.${op}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// domain → row mappers

function runToRow(run: Run, config: RunConfiguration): Record<string, unknown> {
  return {
    id: run.id, fingerprint: run.fingerprint, name: run.name, mode: run.mode,
    status: run.status, pack_slug: run.pack.slug, pack_version: run.pack.version,
    prompt_hash: run.promptHash, samples_per_model: run.samplesPerModel,
    model_count: run.modelCount, budget_ceiling_usd: run.budgetCeilingUsd,
    cost_spent_usd: run.costSpentUsd,
    est_cost_low_usd: run.estCostRangeUsd?.[0] ?? null,
    est_cost_high_usd: run.estCostRangeUsd?.[1] ?? null,
    started_at: run.startedAt, completed_at: run.completedAt,
    elapsed_sec: run.elapsedSec, runner_version: run.runnerVersion,
    git_commit: run.gitCommit,
    composite_browser_pct: run.compositeWeighting.browser,
    composite_visual_pct: run.compositeWeighting.visual,
    composite_efficiency_pct: run.compositeWeighting.efficiency,
    verdict_label: run.verdict?.label ?? null,
    verdict_narrative: run.verdict?.narrative ?? null,
    judge_reversal_count: run.judgeReversalCount,
    configuration: config,
  };
}

function runModelToRow(rm: RunModel): Record<string, unknown> {
  return {
    run_id: rm.runId, endpoint_id: rm.endpointId, status: rm.status,
    failed_sample_count: rm.failedSampleCount, progress_pct: rm.progressPct,
    current_task: rm.currentTask, tokens_out: rm.tokensOut, ttft_ms: rm.ttftMs,
    total_latency_ms: rm.totalLatencyMs, cost_usd: rm.costUsd,
    visual_score_value: rm.visualScore?.value ?? null,
    visual_score_n: rm.visualScore?.n ?? null,
    tests_passed: rm.testsPassed, tests_total: rm.testsTotal,
    retries: rm.retries, unseeded: rm.unseeded, flag: rm.flag,
  };
}

function sampleToRow(s: SampleResult): Record<string, unknown> {
  return {
    run_id: s.runId, endpoint_id: s.endpointId, sample_index: s.sampleIndex,
    global_index: s.globalIndex, status: s.status,
    score_value: s.score !== null && "value" in s.score ? s.score.value : null,
    score_failed: s.score !== null && "failed" in s.score,
    primary_scorer: s.primaryScorer, cost_usd: s.costUsd,
    latency_ms: s.latencyMs, ttft_ms: s.ttftMs, seed: s.seed,
    has_artifact: s.hasArtifact, tokens_out: s.tokensOut,
    raw_ref: null, raw_excerpt: s.rawExcerpt, scorer_trace: s.scorerTrace,
    judge_reversed: s.judgeReversed, human_reviewed: s.humanReviewed,
    human_note: s.humanNote,
  };
}

function artifactToRow(a: Artifact): Record<string, unknown> {
  return {
    run_id: a.runId, endpoint_id: a.endpointId, sample_index: a.sampleIndex,
    path: a.path, filename: a.filename, size_kb: a.sizeKb,
    render_ok: a.renderOk, is_best_of_model: a.isBestOfModel,
    source_ref: null, source_inline: a.source, screenshot_ref: a.screenshotRef,
    console_lines: a.consoleLines, checks: a.checks,
    judge_commentary: a.judgeCommentary,
    sandbox_isolated_origin: a.sandbox.isolatedOrigin,
    sandbox_network_blocked: a.sandbox.networkBlocked,
    sandbox_exec_limit_sec: a.sandbox.execLimitSec,
    sandbox_size_limit_mb: a.sandbox.sizeLimitMb,
  };
}

function eventToRow(e: RunEvent): Record<string, unknown> {
  return {
    run_id: e.runId, t: e.t, type: e.type, endpoint_id: e.endpointId,
    sample_index: e.sampleIndex, level: e.level, message: e.message,
    payload: e.payload,
  };
}

function providerToRow(p: Provider): Record<string, unknown> {
  return {
    id: p.id, name: p.name, kind: p.kind, is_local: p.isLocal, status: p.status,
    health_latency_ms: p.healthLatencyMs, models_available: p.modelsAvailable,
    models_loaded: p.modelsLoaded, last_tested_at: isoOrNull(p.lastTestedAt),
    credential_masked: p.credentialMasked, credential_store: p.credentialStore,
    warning_message: p.warning?.message ?? null,
    local_endpoint: p.localEndpoint, local_hardware: p.localHardware,
  };
}

function modelDefinitionToRow(m: ModelDefinition): Record<string, unknown> {
  return {
    id: m.id, family: m.family, short_name: m.shortName,
    identity_color: m.identityColor,
    context_window_tokens: m.contextWindowTokens,
    capabilities: m.capabilities, supports_seed: m.supportsSeed,
  };
}

function endpointToRow(e: ModelEndpoint): Record<string, unknown> {
  // apiModel is intentionally omitted: the DB has no column for it and
  // registry persistence doesn't need it; rowTo parse defaults it to null.
  return {
    id: e.id, model_id: e.modelId, provider_id: e.providerId,
    deployment: e.deployment, quantization: e.quantization, hardware: e.hardware,
    price_in_per_mtok_usd: e.priceInPerMtokUsd,
    price_out_per_mtok_usd: e.priceOutPerMtokUsd, status: e.status,
    runs_count: e.runsCount, reliability_pct: e.reliabilityPct,
    avg_visual_score: e.avgVisualScore, last_tested_at: isoOrNull(e.lastTestedAt),
  };
}

/**
 * Fixture registry rows carry human display strings in timestamp-ish fields
 * ("today", "6d ago"). Postgres timestamptz rejects them — persist only values
 * that actually parse as ISO-like dates, null otherwise.
 */
function isoOrNull(value: string | null): string | null {
  if (value == null) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

function packToRow(p: BenchmarkPack): Record<string, unknown> {
  return {
    slug: p.slug, version: p.version, name: p.name, kind: p.kind,
    source: p.source, description: p.description, task_count: p.taskCount,
    browser_check_count: p.browserCheckCount, eval_scorer: p.evalScorer,
    scorers_summary: p.scorersSummary,
    est_cost_per_model_usd: p.estCostPerModelUsd,
    est_output_tokens_per_model: p.estOutputTokensPerModel,
    category: p.category, license: p.license, prompt: p.prompt,
    content_hash: null, last_run_at: isoOrNull(p.lastRunAt),
  };
}

// ---------------------------------------------------------------------------
// row → domain mappers (validated through Zod on the way out)

function rowToRun(r: RunRow): Run {
  return Run.parse({
    id: r.id, fingerprint: r.fingerprint, name: r.name, mode: r.mode,
    status: r.status, pack: { slug: r.pack_slug, version: r.pack_version },
    promptHash: r.prompt_hash, samplesPerModel: r.samples_per_model,
    modelCount: r.model_count, budgetCeilingUsd: r.budget_ceiling_usd,
    costSpentUsd: r.cost_spent_usd,
    estCostRangeUsd:
      r.est_cost_low_usd === null || r.est_cost_high_usd === null
        ? null
        : [r.est_cost_low_usd, r.est_cost_high_usd],
    startedAt: r.started_at, completedAt: r.completed_at,
    elapsedSec: r.elapsed_sec, runnerVersion: r.runner_version,
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
    runId: r.run_id, endpointId: r.endpoint_id, status: r.status,
    failedSampleCount: r.failed_sample_count, progressPct: r.progress_pct,
    currentTask: r.current_task, tokensOut: r.tokens_out, ttftMs: r.ttft_ms,
    totalLatencyMs: r.total_latency_ms, costUsd: r.cost_usd,
    visualScore:
      r.visual_score_value === null || r.visual_score_n === null
        ? null
        : { value: r.visual_score_value, n: r.visual_score_n },
    testsPassed: r.tests_passed, testsTotal: r.tests_total, retries: r.retries,
    unseeded: r.unseeded, flag: r.flag,
  });
}

function rowToSample(r: SampleRow): SampleResult {
  return SampleResult.parse({
    runId: r.run_id, endpointId: r.endpoint_id, sampleIndex: r.sample_index,
    globalIndex: r.global_index, status: r.status,
    score: r.score_failed
      ? { failed: true }
      : r.score_value === null
        ? null
        : { value: r.score_value },
    primaryScorer: r.primary_scorer, costUsd: r.cost_usd,
    latencyMs: r.latency_ms, ttftMs: r.ttft_ms, seed: r.seed,
    hasArtifact: r.has_artifact, tokensOut: r.tokens_out,
    rawExcerpt: r.raw_excerpt, scorerTrace: r.scorer_trace,
    judgeReversed: r.judge_reversed, humanReviewed: r.human_reviewed,
    humanNote: r.human_note,
  });
}

function rowToArtifact(r: ArtifactRow): Artifact {
  return Artifact.parse({
    runId: r.run_id, endpointId: r.endpoint_id, sampleIndex: r.sample_index,
    path: r.path, filename: r.filename, sizeKb: r.size_kb,
    renderOk: r.render_ok, isBestOfModel: r.is_best_of_model,
    source: r.source_inline ?? "", screenshotRef: r.screenshot_ref,
    consoleLines: r.console_lines, checks: r.checks,
    judgeCommentary: r.judge_commentary,
    sandbox: {
      isolatedOrigin: r.sandbox_isolated_origin,
      networkBlocked: r.sandbox_network_blocked,
      execLimitSec: r.sandbox_exec_limit_sec,
      sizeLimitMb: r.sandbox_size_limit_mb,
    },
  });
}

function rowToEvent(r: EventRow): StoredRunEvent {
  return {
    ...RunEvent.parse({
      t: r.t, type: r.type, runId: r.run_id, endpointId: r.endpoint_id,
      sampleIndex: r.sample_index, level: r.level, message: r.message,
      payload: r.payload,
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
