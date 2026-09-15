/**
 * Unified server-side run loaders (Phase 3).
 *
 * SERVER-ONLY — imports @model-lab/store. Never import from a client component.
 *
 * `getRunView(runId)` resolves everything the Results / Samples / Artifacts
 * pages consume, from ONE of two sources:
 *  - the demo run (run_8f3ac21e) — and any unknown/deep-linked id — keeps the
 *    rich fixture scenario (judge matrix, human rubric, verdict narrative);
 *  - every run known to the persistence store renders ITS OWN data, with
 *    derived fields (latency ranges, warn counts) computed from its samples
 *    and events. Fields a real run lacks (verdict, judge data) come back null
 *    so pages can degrade gracefully.
 *
 * `listAllRuns()` merges store runs + the in-process registry + the fixture
 * demo rows, newest first, for the runs index and Mission Control.
 */
import type {
  Artifact,
  HumanAnnotation,
  JudgePairResult,
  Run,
  RunConfiguration,
  RunManifest,
  RunMode,
  RunModel,
  RunStatus,
  SampleResult,
  WtlCell,
} from "@model-lab/schemas";
import * as fx from "@model-lab/schemas/fixtures";
import { getStore, type RunStore } from "@model-lab/store";
import { BROWSER_CHECK_COUNT, CAPABILITY_CHECK_COUNT, capabilityChecksOf } from "@/lib/checks";
import { humanVisualByEndpoint, latestOverrideBySample, sampleKey } from "@/lib/human-score";
import { listRuns as listRegistryRuns } from "@/lib/live/run-registry";

export const DEMO_RUN_ID = "run_8f3ac21e";

/* ------------------------------------------------------------------------- *
 * Run view
 * ------------------------------------------------------------------------- */

export interface LatencyRange {
  min: number;
  median: number;
  max: number;
}

/** Judge-derived data — present only when the run had an llm-judge scorer. */
export interface RunJudgeView {
  wtlMatrix: Record<string, Record<string, WtlCell>>;
  judgePairs: JudgePairResult[];
  /** Brief-adherence rubric grade (0–10) per endpoint. */
  briefScores: Record<string, number>;
}

export interface RunView {
  source: "fixtures" | "store";
  run: Run;
  configuration: RunConfiguration;
  runModels: RunModel[];
  samples: SampleResult[];
  artifacts: Artifact[];
  manifest: RunManifest;
  /** The challenge prompt shown on Samples/Artifacts. */
  challengePrompt: string;
  /** "One-Shot Raycaster" — pack display name. */
  packName: string;
  /** How many browser checks RAN per artifact (the full list — gates + capability + diagnostics). */
  checksTotal: number;
  /**
   * How many of them are CAPABILITY checks — the denominator of the headline
   * browser score. Gates are preconditions and diagnostics measure the harness,
   * so neither is scored; see lib/checks.ts.
   */
  capabilityTotal: number;
  /** Per-endpoint latency min/median/max (ms) — derived from samples for store runs. */
  latencyRanges: Record<string, LatencyRange>;
  /** check.warn event count per endpoint (reliability panel). */
  checkWarnCounts: Record<string, number>;
  /** null when the run had no judge scorer — pages render an EmptyState. */
  judge: RunJudgeView | null;
  /** Append-only human audit trail. */
  annotations: HumanAnnotation[];
}

async function getStoreSafe(): Promise<RunStore | null> {
  try {
    return await getStore();
  } catch {
    return null;
  }
}

/** min/median/max per endpoint over the run's own sample latencies. */
function latencyRangesFrom(samples: SampleResult[]): Record<string, LatencyRange> {
  const byEndpoint = new Map<string, number[]>();
  for (const s of samples) {
    if (s.latencyMs == null) continue;
    const arr = byEndpoint.get(s.endpointId) ?? [];
    arr.push(s.latencyMs);
    byEndpoint.set(s.endpointId, arr);
  }
  const out: Record<string, LatencyRange> = {};
  for (const [endpointId, values] of byEndpoint) {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    if (min === undefined || max === undefined) continue;
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? (sorted[mid] ?? min)
        : Math.round(((sorted[mid - 1] ?? min) + (sorted[mid] ?? max)) / 2);
    out[endpointId] = { min, median, max };
  }
  return out;
}

function warnCountsFrom(
  events: ReadonlyArray<{ type: string; endpointId: string | null }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type === "check.warn" && ev.endpointId != null) {
      counts[ev.endpointId] = (counts[ev.endpointId] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * FIXED CONTRACT (scoring phase): the store package gains
 * `listJudgePairs(runId)` (ordered by pairIndex). Typed structurally so this
 * app also typechecks against a store build that predates the method — an
 * absent method degrades to "no pairs" (judge stays null).
 */
async function judgePairsFrom(store: RunStore, runId: string): Promise<JudgePairResult[]> {
  const reads = store as RunStore & {
    listJudgePairs?: (runId: string) => Promise<JudgePairResult[]>;
  };
  if (typeof reads.listJudgePairs !== "function") return [];
  return reads.listJudgePairs(runId).catch((): JudgePairResult[] => []);
}

interface RubricView {
  /** Brief-adherence grade (0–10, one decimal) per endpoint. */
  scores: Record<string, number>;
  /** Judge commentary per endpoint (feeds Artifact inspector when unset). */
  commentary: Record<string, string>;
}

/**
 * `judge.vote` events with payload kind:"rubric" → per-endpoint brief scores
 * ({kind, endpointId, score, commentary}). Events arrive in id order; the last
 * rubric event per endpoint wins.
 */
function rubricFrom(
  events: ReadonlyArray<{
    type: string;
    endpointId: string | null;
    payload: Record<string, unknown>;
  }>,
): RubricView {
  const scores: Record<string, number> = {};
  const commentary: Record<string, string> = {};
  for (const ev of events) {
    if (ev.type !== "judge.vote") continue;
    const p = ev.payload;
    if (p["kind"] !== "rubric") continue;
    const endpointId = typeof p["endpointId"] === "string" ? p["endpointId"] : ev.endpointId;
    if (endpointId == null || endpointId === "") continue;
    const score = p["score"];
    if (typeof score === "number" && Number.isFinite(score)) {
      scores[endpointId] = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
    }
    const note = p["commentary"];
    if (typeof note === "string" && note !== "") commentary[endpointId] = note;
  }
  return { scores, commentary };
}

/**
 * W–T–L matrix (row vs column) from persisted judge pairs. Each real pair is
 * ONE judgment pair (best build judged in both presentation orders):
 * - orders agree → one consensus unit per pair, so cells read "1–0–0" style;
 * - reversed → the two disagreeing order-verdicts are tallied raw (e.g.
 *   "1–0–1"), flagged ⟲, and excluded from the aggregate verdict — the demo
 *   convention the WTLMatrix legend documents.
 * Verdict letters refer to pairing slots: "A" = pairing[0], "B" = pairing[1].
 */
function wtlMatrixFrom(pairs: JudgePairResult[]): Record<string, Record<string, WtlCell>> {
  const matrix: Record<string, Record<string, WtlCell>> = {};
  const cell = (row: string, col: string): WtlCell => {
    const r = (matrix[row] ??= {});
    return (r[col] ??= { w: 0, t: 0, l: 0, reversalFlagged: false });
  };
  const tally = (verdict: "A" | "B" | "tie", a: string, b: string): void => {
    const ab = cell(a, b);
    const ba = cell(b, a);
    if (verdict === "tie") {
      ab.t += 1;
      ba.t += 1;
    } else if (verdict === "A") {
      ab.w += 1;
      ba.l += 1;
    } else {
      ab.l += 1;
      ba.w += 1;
    }
  };
  for (const p of pairs) {
    const [a, b] = p.pairing;
    const verdicts = [p.verdictAB, p.verdictBA].filter((v): v is "A" | "B" | "tie" => v != null);
    const first = verdicts[0];
    if (first === undefined) continue;
    if (p.reversed) {
      for (const v of verdicts) tally(v, a, b);
      cell(a, b).reversalFlagged = true;
      cell(b, a).reversalFlagged = true;
    } else {
      // both orders agree — one consensus judgment per pair
      tally(first, a, b);
    }
  }
  return matrix;
}

/**
 * Screenshot refs persist as data-root-relative paths ("screenshots/8f3a/…").
 * Rewrite to the streaming API URL; tolerate legacy absolute paths.
 */
function screenshotUrl(runId: string, ref: string | null): string | null {
  if (ref == null || ref === "") return null;
  const norm = ref.split("\\").join("/");
  const marker = "screenshots/";
  const idx = norm.lastIndexOf(marker);
  if (idx < 0) return null;
  const tail = norm.slice(idx + marker.length);
  if (tail === "" || tail.includes("..")) return null;
  return `/api/runs/${encodeURIComponent(runId)}/screenshots/${tail
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/**
 * Store artifacts land without isBestOfModel — derive it: the artifact of the
 * endpoint's highest-scored sample (ties → lower sampleIndex), falling back to
 * the first renderOk artifact, then the first artifact.
 */
function enrichArtifacts(
  runId: string,
  samples: SampleResult[],
  artifacts: Artifact[],
): Artifact[] {
  const bestSample = new Map<string, number>();
  for (const s of samples) {
    if (!s.hasArtifact || s.score == null || !("value" in s.score)) continue;
    const current = bestSample.get(s.endpointId);
    if (current === undefined) {
      bestSample.set(s.endpointId, s.sampleIndex);
      continue;
    }
    const currentScore = samples.find(
      (c) => c.endpointId === s.endpointId && c.sampleIndex === current,
    )?.score;
    const currentValue = currentScore != null && "value" in currentScore ? currentScore.value : -1;
    if (s.score.value > currentValue) bestSample.set(s.endpointId, s.sampleIndex);
  }
  for (const a of artifacts) {
    if (bestSample.has(a.endpointId)) continue;
    if (a.renderOk) bestSample.set(a.endpointId, a.sampleIndex);
  }
  for (const a of artifacts) {
    if (!bestSample.has(a.endpointId)) bestSample.set(a.endpointId, a.sampleIndex);
  }
  return artifacts.map((a) => ({
    ...a,
    isBestOfModel: bestSample.get(a.endpointId) === a.sampleIndex,
    screenshotRef: screenshotUrl(runId, a.screenshotRef),
  }));
}

/** Mirrors run-service's toPackConfig prompt synthesis for store runs. */
function promptFor(packSlug: string, promptHash: string): string {
  const pack = fx.benchmarkPacks.find((p) => p.slug === packSlug);
  if (pack?.prompt != null) return pack.prompt;
  if (pack !== undefined) {
    return (
      `${pack.description} Build it as ONE self-contained HTML file with no external ` +
      `network dependencies. Return only the HTML document.`
    );
  }
  return `Prompt recorded as hash ${promptHash} — original text unavailable.`;
}

function manifestFor(run: Run, configuration: RunConfiguration): RunManifest {
  return {
    runId: run.id,
    fingerprint: run.fingerprint,
    benchmark: `${run.pack.slug} ${run.pack.version}`,
    promptHash: run.promptHash,
    runnerVersion: run.runnerVersion,
    date: run.startedAt.slice(0, 10),
    samplesPerModel: run.samplesPerModel,
    modelCount: run.modelCount,
    scorers: configuration.scorers.filter((s) => s.enabled).map((s) => s.type),
    gitCommit: run.gitCommit,
  };
}

/** Largest non-zero value of `pick` over `items` — 0 when there is nothing to read. */
function maxOver<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((max, item) => Math.max(max, pick(item)), 0);
}

/** The demo scenario exactly as the pages consumed it pre-Phase 3. */
async function fixtureView(annotations: HumanAnnotation[]): Promise<RunView> {
  return {
    source: "fixtures",
    run: fx.runCompleted,
    configuration: fx.runConfiguration,
    runModels: fx.getRunModels("completed"),
    samples: fx.samples,
    artifacts: fx.artifacts,
    manifest: fx.runManifest,
    challengePrompt: fx.challengePrompt,
    packName:
      fx.benchmarkPacks.find((p) => p.slug === fx.runCompleted.pack.slug)?.name ??
      fx.runCompleted.name,
    checksTotal: fx.CHECK_NAMES.length,
    capabilityTotal:
      maxOver(fx.artifacts, (a) => capabilityChecksOf(a.checks).length) || CAPABILITY_CHECK_COUNT,
    latencyRanges: fx.latencyRanges,
    checkWarnCounts: warnCountsFrom([...fx.liveEvents, ...fx.completionEvents]),
    judge: {
      wtlMatrix: fx.wtlMatrix,
      judgePairs: fx.judgePairs,
      briefScores: fx.judgeBriefScores,
    },
    annotations,
  };
}

/**
 * Resolve everything the run detail pages need. The demo run and unknown ids
 * render the fixture scenario; store-known runs render their own data.
 */
export async function getRunView(runId: string): Promise<RunView> {
  const store = await getStoreSafe();

  if (runId === DEMO_RUN_ID || store === null) {
    const annotations = store !== null ? await store.listAnnotations(runId).catch(() => []) : [];
    return fixtureView(annotations);
  }

  const stored = await store.getRun(runId).catch(() => null);
  if (stored === null) {
    // Unknown id (fixture-only deep link) — preserve the Phase 0 behavior.
    return fixtureView([]);
  }

  const { run, configuration } = stored;
  const [runModels, samples, rawArtifacts, events, annotations, judgePairs] = await Promise.all([
    store.listRunModels(runId).catch(() => []),
    store.listSamples(runId).catch(() => []),
    store.listArtifacts(runId).catch(() => []),
    store.listEvents(runId).catch(() => []),
    store.listAnnotations(runId).catch(() => []),
    judgePairsFrom(store, runId),
  ]);

  const pack = fx.benchmarkPacks.find((p) => p.slug === run.pack.slug);
  /**
   * Two different questions, two different numbers. `checksTotal` is "how many
   * checks ran" and must be read off the traces themselves — RunModel.testsTotal
   * now carries the CAPABILITY count, so deriving it from the rollup would
   * quietly report 5 checks per artifact. `capabilityTotal` is the headline
   * denominator, taken from the traces first (legacy traces carry no category
   * field but classify correctly by name) and from the rollup only when the run
   * stored no artifacts to read.
   */
  const checksTotal =
    maxOver(rawArtifacts, (a) => a.checks.length) || pack?.browserCheckCount || BROWSER_CHECK_COUNT;
  const capabilityTotal =
    maxOver(rawArtifacts, (a) => capabilityChecksOf(a.checks).length) ||
    maxOver(runModels, (rm) => rm.testsTotal ?? 0) ||
    CAPABILITY_CHECK_COUNT;

  // Judge view — persisted pairs + rubric grades from judge.vote events.
  // No pairs recorded → judge stays null and the pages render EmptyStates.
  const rubric = rubricFrom(events);
  const judge: RunJudgeView | null =
    judgePairs.length > 0
      ? { wtlMatrix: wtlMatrixFrom(judgePairs), judgePairs, briefScores: rubric.scores }
      : null;
  const judgeReversals = judgePairs.filter((p) => p.reversed).length;

  // Human visual — derived from scored annotations (latest per sample wins).
  // Overrides the VIEW only; recorded scores in the store stay untouched.
  const humanVisual = humanVisualByEndpoint(annotations);
  const scoredSamples = latestOverrideBySample(annotations);
  const runModelsView = runModels.map((rm) => {
    const hv = humanVisual.get(rm.endpointId);
    return hv !== undefined ? { ...rm, visualScore: hv } : rm;
  });
  const samplesView = samples.map((s) =>
    scoredSamples.has(sampleKey(s.endpointId, s.sampleIndex))
      ? { ...s, humanReviewed: true, primaryScorer: "human" as const }
      : s,
  );

  // Judge rubric commentary fills the Artifact inspector when the artifact
  // itself carries none.
  const artifacts = enrichArtifacts(runId, samples, rawArtifacts).map((a) => {
    const note = rubric.commentary[a.endpointId];
    return a.judgeCommentary == null && note != null ? { ...a, judgeCommentary: note } : a;
  });

  return {
    source: "store",
    // Reversal count is derived from the persisted pairs (evidence-first).
    run: judgePairs.length > 0 ? { ...run, judgeReversalCount: judgeReversals } : run,
    configuration,
    runModels: runModelsView,
    samples: samplesView,
    artifacts,
    manifest: manifestFor(run, configuration),
    challengePrompt: promptFor(run.pack.slug, run.promptHash),
    packName: pack?.name ?? run.name,
    checksTotal,
    capabilityTotal,
    latencyRanges: latencyRangesFrom(samples),
    checkWarnCounts: warnCountsFrom(events),
    judge,
    annotations,
  };
}

/* ------------------------------------------------------------------------- *
 * Run listing (runs index + Mission Control "Recent runs")
 * ------------------------------------------------------------------------- */

export interface RunListEntry {
  id: string;
  name: string;
  mode: RunMode;
  status: RunStatus;
  modelCount: number;
  samplesPerModel: number;
  costUsd: number;
  /** "now" / "12m ago" / "2h ago" / "yesterday" / "3d ago" */
  when: string;
}

function relativeWhen(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** ISO sort key for the fixture rows' authored relative labels. */
function fixtureSortKey(when: string, index: number): string {
  let offsetMs: number;
  if (when === "now") offsetMs = 0;
  else if (when === "yesterday") offsetMs = 24 * 3_600_000;
  else {
    const m = /^(\d+)\s*([mhd])\s+ago$/.exec(when);
    const unit = m?.[2] === "m" ? 60_000 : m?.[2] === "h" ? 3_600_000 : 86_400_000;
    offsetMs = m?.[1] != null ? Number(m[1]) * unit : (index + 1) * 86_400_000;
  }
  // − index keeps the authored order stable among equal offsets
  return new Date(Date.now() - offsetMs - index).toISOString();
}

/**
 * All runs, newest first: persisted store runs + in-process registry runs
 * (freshly started, store unavailable) + the fixture demo rows. The demo run
 * keeps its fixture presentation ("running · now") — Mission Control's active
 * run panel tells that story.
 */
export async function listAllRuns(): Promise<RunListEntry[]> {
  const byId = new Map<string, { entry: RunListEntry; sortKey: string }>();

  // Fixture rows first (lowest precedence).
  fx.recentRuns.forEach((r, index) => {
    const sortKey =
      r.id === DEMO_RUN_ID ? fx.runCompleted.startedAt : fixtureSortKey(r.when, index);
    byId.set(r.id, {
      entry: {
        id: r.id,
        name: r.name,
        mode: r.mode,
        status: r.status,
        modelCount: r.modelCount,
        samplesPerModel: r.samplesPerModel,
        costUsd: r.costUsd,
        when: r.when,
      },
      sortKey,
    });
  });

  // Store runs (skip the demo — its fixture row is the canonical presentation).
  const store = await getStoreSafe();
  if (store !== null) {
    const runs = await store.listRuns().catch((): Run[] => []);
    for (const run of runs) {
      if (run.id === DEMO_RUN_ID) continue;
      byId.set(run.id, {
        entry: {
          id: run.id,
          name: run.name,
          mode: run.mode,
          status: run.status,
          modelCount: run.modelCount,
          samplesPerModel: run.samplesPerModel,
          costUsd: run.costSpentUsd,
          when: relativeWhen(run.startedAt),
        },
        sortKey: run.startedAt,
      });
    }
  }

  // Registry-only runs (in-flight in this process; store write may have failed).
  for (const record of listRegistryRuns()) {
    if (record.id === DEMO_RUN_ID || byId.has(record.id)) continue;
    const pack = fx.benchmarkPacks.find((p) => p.slug === record.config.packSlug);
    byId.set(record.id, {
      entry: {
        id: record.id,
        name: record.config.name ?? pack?.name ?? record.config.packSlug,
        mode: record.config.mode,
        status: record.status,
        modelCount: record.config.endpointIds.length,
        samplesPerModel: record.config.samplesPerModel,
        costUsd: 0,
        when: relativeWhen(record.createdAt),
      },
      sortKey: record.createdAt,
    });
  }

  return [...byId.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey)).map((x) => x.entry);
}
