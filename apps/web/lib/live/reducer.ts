/**
 * Pure live-run event reducer. No React, no IO — (state, RunEvent) => state.
 *
 * Semantics (task contract):
 * - model.started      → status "generating", in-flight credit on sample 1
 * - sample.started     → currentTask update + progress step (starting sample N
 *                        implies N−1 samples settled; in-flight sample earns
 *                        half a sample of credit)
 * - sample.failed      → failedSampleCount++ — the model KEEPS running
 * - sample.scored      → settles the sample (samplesDone recomputed) + scores
 *                        parsed tolerantly from the message ("visual 8.1",
 *                        "9/12 tests")
 * - browser.checks     → testsPassed/testsTotal from payload {passed, total}
 * - model.completed    → status "completed", progress 100, cost parsed from
 *                        the message when present ("… · $0.18")
 * - run.completed      → runStatus "completed"
 * - budget.status      → costSpentUsd from payload.spentUsd
 * - token.usage        → tokensOut from payload.tokensOut
 *
 * `samplesDone` is derived as Σ per-model settled samples rather than a raw
 * sample.scored counter: the fixture replay script is a condensed excerpt
 * (model.completed can settle samples whose sample.scored line was elided),
 * and deriving keeps the strip consistent at 12/12 when the run completes.
 *
 * Unknown endpointIds appearing mid-stream are added on the fly: the Phase 1
 * SSE endpoint replays the same fixture script for ANY runId, so the streamed
 * endpoints may not match the registered selection.
 */
import type { RunEvent, RunModelStatus, RunStatus } from "@model-lab/schemas";

export type LiveModelState = {
  endpointId: string;
  status: RunModelStatus;
  progressPct: number;
  currentTask: string | null;
  tokensOut: number;
  ttftMs: number | null;
  costUsd: number;
  failedSampleCount: number;
  testsPassed: number | null;
  testsTotal: number | null;
  visualScore: { value: number; n: number } | null;
  /** samples fully finished (scored or failed) — progress bookkeeping */
  settledSamples: number;
  /** 1-based index of the sample currently in flight, if any */
  currentSampleIndex: number | null;
};

export type LiveFailureRef = { endpointId: string; sampleIndex: number };

export type LiveRunState = {
  runId: string;
  samplesPerModel: number;
  runStatus: RunStatus;
  costSpentUsd: number;
  /** Σ per-model settled samples, clamped to samplesPerModel each */
  samplesDone: number;
  /** seconds spanned by the event timestamps seen so far */
  elapsedSec: number;
  /** insertion-ordered: initial endpointIds first, stream additions after */
  models: Record<string, LiveModelState>;
  /** most recent sample.failed — drives the partial-failure banner */
  lastFailure: LiveFailureRef | null;
  /** full ordered event log (cards filter by endpointId) */
  events: RunEvent[];
  /** console tail feed (same events; kept separate per the screen contract) */
  consoleLines: RunEvent[];
  firstEventAtMs: number | null;
};

function freshModel(endpointId: string): LiveModelState {
  return {
    endpointId,
    status: "queued",
    progressPct: 0,
    currentTask: null,
    tokensOut: 0,
    ttftMs: null,
    costUsd: 0,
    failedSampleCount: 0,
    testsPassed: null,
    testsTotal: null,
    visualScore: null,
    settledSamples: 0,
    currentSampleIndex: null,
  };
}

export function initialStateFor(
  runId: string,
  endpointIds: readonly string[],
  samplesPerModel: number,
): LiveRunState {
  const models: Record<string, LiveModelState> = {};
  for (const id of endpointIds) models[id] = freshModel(id);
  return {
    runId,
    samplesPerModel: Math.max(1, samplesPerModel),
    runStatus: "queued",
    costSpentUsd: 0,
    samplesDone: 0,
    elapsedSec: 0,
    models,
    lastFailure: null,
    events: [],
    consoleLines: [],
    firstEventAtMs: null,
  };
}

/* ---------------------------------------------------------------- helpers */

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/** completedSamples/samplesPerModel × 100 with half-sample in-flight credit. */
function progressOf(m: LiveModelState, samplesPerModel: number): number {
  const inFlight =
    m.currentSampleIndex != null &&
    m.status !== "completed" &&
    m.status !== "failed" &&
    m.currentSampleIndex > m.settledSamples;
  return clampPct(((m.settledSamples + (inFlight ? 0.5 : 0)) / samplesPerModel) * 100);
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Tolerant "$0.18" extraction (model.completed messages). */
function usdIn(message: string): number | null {
  const m = /\$([0-9]+(?:\.[0-9]+)?)/.exec(message);
  return m?.[1] != null ? Number(m[1]) : null;
}

/** Tolerant "visual 8.1" extraction (sample.scored messages). */
function visualIn(message: string): number | null {
  const m = /visual\s+([0-9]+(?:\.[0-9]+)?)/i.exec(message);
  return m?.[1] != null ? Number(m[1]) : null;
}

/** Tolerant "10/12 tests" / "12/12 browser tests" extraction. */
function testsIn(message: string): { passed: number; total: number } | null {
  const m = /([0-9]+)\/([0-9]+)\s*(?:browser\s+)?tests?/i.exec(message);
  return m?.[1] != null && m[2] != null
    ? { passed: Number(m[1]), total: Number(m[2]) }
    : null;
}

function sumSettled(models: Record<string, LiveModelState>, samplesPerModel: number): number {
  let done = 0;
  for (const m of Object.values(models)) done += Math.min(m.settledSamples, samplesPerModel);
  return done;
}

/* ---------------------------------------------------------------- reducer */

export function reduceRunEvent(state: LiveRunState, event: RunEvent): LiveRunState {
  const spm = state.samplesPerModel;

  /* Clock: elapsed = span of event timestamps seen so far. */
  const tMs = Date.parse(event.t);
  const firstEventAtMs =
    state.firstEventAtMs ?? (Number.isFinite(tMs) ? tMs : null);
  const elapsedSec =
    firstEventAtMs != null && Number.isFinite(tMs)
      ? Math.max(state.elapsedSec, Math.round((tMs - firstEventAtMs) / 1000))
      : state.elapsedSec;

  let runStatus = state.runStatus;
  let costSpentUsd = state.costSpentUsd;
  let lastFailure = state.lastFailure;
  const models = { ...state.models };

  /** Copy-on-write per-model update (adds unknown endpoints on the fly). */
  const patch = (endpointId: string, fn: (m: LiveModelState) => LiveModelState) => {
    const prev = models[endpointId] ?? freshModel(endpointId);
    const next = fn({ ...prev });
    next.progressPct = progressOf(next, spm);
    models[endpointId] = next;
  };

  const eid = event.endpointId;

  switch (event.type) {
    case "run.created":
      runStatus = "queued";
      break;
    case "run.started":
      runStatus = "running";
      break;
    case "run.partial":
      runStatus = "partial";
      break;
    case "run.completed":
      runStatus = "completed";
      break;
    case "run.cancelled":
      runStatus = "cancelled";
      break;

    case "model.queued":
      if (eid) patch(eid, (m) => ({ ...m, status: "queued" }));
      break;

    case "model.started":
      if (eid)
        patch(eid, (m) => ({
          ...m,
          status: "generating",
          currentSampleIndex: event.sampleIndex ?? 1,
          currentTask: `sample ${event.sampleIndex ?? 1}/${spm} · generating`,
        }));
      break;

    case "model.rate_limited":
      if (eid) patch(eid, (m) => ({ ...m, currentTask: event.message }));
      break;

    case "sample.started":
      if (eid)
        patch(eid, (m) => ({
          ...m,
          status: m.status === "queued" ? "generating" : m.status,
          currentSampleIndex: event.sampleIndex ?? m.currentSampleIndex,
          settledSamples:
            event.sampleIndex != null
              ? Math.max(m.settledSamples, event.sampleIndex - 1)
              : m.settledSamples,
          currentTask: event.message,
        }));
      break;

    case "sample.failed":
      if (eid) {
        patch(eid, (m) => ({
          ...m,
          // The model KEEPS running — only the counter and bookkeeping move.
          failedSampleCount: m.failedSampleCount + 1,
          settledSamples: Math.max(
            m.settledSamples,
            event.sampleIndex ?? m.settledSamples + 1,
          ),
        }));
        lastFailure = { endpointId: eid, sampleIndex: event.sampleIndex ?? 0 };
      }
      break;

    case "sample.scored":
      if (eid)
        patch(eid, (m) => {
          const visual = visualIn(event.message);
          const tests = testsIn(event.message);
          return {
            ...m,
            settledSamples: Math.max(
              m.settledSamples,
              event.sampleIndex ?? m.settledSamples + 1,
            ),
            visualScore:
              visual != null
                ? { value: visual, n: (m.visualScore?.n ?? 0) + 1 }
                : m.visualScore,
            testsPassed: tests?.passed ?? m.testsPassed,
            testsTotal: tests?.total ?? m.testsTotal,
          };
        });
      break;

    case "browser.checks":
      if (eid)
        patch(eid, (m) => ({
          ...m,
          testsPassed: asNumber(event.payload["passed"]) ?? m.testsPassed,
          testsTotal: asNumber(event.payload["total"]) ?? m.testsTotal,
          status: m.status === "generating" ? "testing" : m.status,
        }));
      break;

    case "model.completed":
      if (eid)
        patch(eid, (m) => ({
          ...m,
          status: "completed",
          settledSamples: spm,
          currentSampleIndex: null,
          currentTask: event.message,
          costUsd: usdIn(event.message) ?? m.costUsd,
        }));
      break;

    case "model.failed":
      if (eid) patch(eid, (m) => ({ ...m, status: "failed", currentTask: event.message }));
      break;

    case "token.usage":
      if (eid)
        patch(eid, (m) => ({
          ...m,
          tokensOut: asNumber(event.payload["tokensOut"]) ?? m.tokensOut,
        }));
      break;

    case "budget.status":
      costSpentUsd = asNumber(event.payload["spentUsd"]) ?? costSpentUsd;
      break;

    /* Log-only events: artifact.created, sandbox.loaded, check.*, judge.vote,
       export.created — they land in events/consoleLines below. */
    default:
      break;
  }

  return {
    ...state,
    runStatus,
    costSpentUsd,
    samplesDone: sumSettled(models, spm),
    elapsedSec,
    models,
    lastFailure,
    events: [...state.events, event],
    consoleLines: [...state.consoleLines, event],
    firstEventAtMs,
  };
}
