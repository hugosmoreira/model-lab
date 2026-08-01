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
  /** Browser-check count for "n/12" displays. */
  checksTotal: number;
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
        ? sorted[mid] ?? min
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
    const currentValue =
      currentScore != null && "value" in currentScore ? currentScore.value : -1;
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
    const annotations =
      store !== null ? await store.listAnnotations(runId).catch(() => []) : [];
    return fixtureView(annotations);
  }

  const stored = await store.getRun(runId).catch(() => null);
  if (stored === null) {
    // Unknown id (fixture-only deep link) — preserve the Phase 0 behavior.
    return fixtureView([]);
  }

  const { run, configuration } = stored;
  const [runModels, samples, rawArtifacts, events, annotations] = await Promise.all([
    store.listRunModels(runId).catch(() => []),
    store.listSamples(runId).catch(() => []),
    store.listArtifacts(runId).catch(() => []),
    store.listEvents(runId).catch(() => []),
    store.listAnnotations(runId).catch(() => []),
  ]);

  const hasJudge = configuration.scorers.some((s) => s.type === "llm-judge" && s.enabled);
  const pack = fx.benchmarkPacks.find((p) => p.slug === run.pack.slug);
  const checksTotal =
    runModels.reduce((max, rm) => Math.max(max, rm.testsTotal ?? 0), 0) ||
    pack?.browserCheckCount ||
    12;

  return {
    source: "store",
    run,
    configuration,
    runModels,
    samples,
    artifacts: enrichArtifacts(runId, samples, rawArtifacts),
    manifest: manifestFor(run, configuration),
    challengePrompt: promptFor(run.pack.slug, run.promptHash),
    packName: pack?.name ?? run.name,
    checksTotal,
    latencyRanges: latencyRangesFrom(samples),
    checkWarnCounts: warnCountsFrom(events),
    judge: hasJudge ? { wtlMatrix: {}, judgePairs: [], briefScores: {} } : null,
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

  return [...byId.values()]
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map((x) => x.entry);
}
