"use client";

/**
 * Streaming shell around the pure-render LiveRunScreen.
 *
 * Subscribes to the run's SSE feed via useRunStream and renders the LIVE
 * reduced state. The server-provided recorded snapshot is used ONLY when the
 * stream errors before delivering a single event (e.g. endpoint unreachable);
 * once any event has arrived the reduced state is authoritative.
 */
import type { Run, RunEvent, RunModel } from "@model-lab/schemas";
import {
  LiveRunScreen,
  type ConsoleLineVM,
  type LiveFailure,
  type LiveModelMeta,
} from "./LiveRunScreen";
import { useRunStream, type StreamConnection } from "@/lib/live/useRunStream";
import type { LiveModelState } from "@/lib/live/reducer";

/** Full static prop set for the recorded snapshot fallback. */
export type LiveRunSnapshot = {
  run: Run;
  models: RunModel[];
  events: RunEvent[];
  consoleLines: ConsoleLineVM[];
  overallPct: number;
  samplesDone: number;
  samplesTotal: number;
  liveSampleIndex: number;
  failure: LiveFailure | null;
};

export type LiveRunClientProps = {
  runId: string;
  endpointIds: string[];
  samplesPerModel: number;
  /** Static shell for id/name/mode/pack/budget — live fields are overridden. */
  baseRun: Run;
  modelMeta: Record<string, LiveModelMeta>;
  fallback: LiveRunSnapshot;
};

const FALLBACK_META: LiveModelMeta = {
  modelId: "unknown",
  providerLabel: "",
  color: "var(--color-model-neutral)",
  excerpt: "",
};

/** The demo run streams a simulated fixture replay; real runs stream live. */
const DEMO_RUN_ID = "run_8f3ac21e";

function chipLabels(runId: string): Record<StreamConnection, string> {
  const demo = runId === DEMO_RUN_ID;
  return {
    connecting: "connecting…",
    streaming: demo ? "streaming · simulated replay" : "streaming · live",
    done: demo ? "replay complete" : "run complete",
    error: "stream interrupted",
  };
}

function toRunModel(runId: string, m: LiveModelState): RunModel {
  return {
    runId,
    endpointId: m.endpointId,
    status: m.status,
    failedSampleCount: m.failedSampleCount,
    progressPct: m.progressPct,
    currentTask: m.currentTask,
    tokensOut: m.tokensOut,
    ttftMs: m.ttftMs,
    totalLatencyMs: null,
    costUsd: m.costUsd,
    visualScore: m.visualScore,
    // Live rows carry the runner's number, which is a browser result.
    visualSource: m.visualScore != null ? "browser" : null,
    testsPassed: m.testsPassed,
    testsTotal: m.testsTotal,
    retries: 0,
    unseeded: false,
    flag: null,
  };
}

export function LiveRunClient({
  runId,
  endpointIds,
  samplesPerModel,
  baseRun,
  modelMeta,
  fallback,
}: LiveRunClientProps) {
  const { state, connection } = useRunStream(runId, endpointIds, samplesPerModel);

  /* Never substitute another run when the stream cannot connect. */
  if ((connection === "error" || connection === "connecting") && state.events.length === 0) {
    return (
      <LiveRunScreen
        runId={runId}
        {...fallback}
        modelMeta={modelMeta}
        streamChip={
          connection === "error"
            ? "stream unavailable · recorded snapshot"
            : "connecting · recorded snapshot"
        }
      />
    );
  }

  const liveModels = Object.values(state.models);
  const models = liveModels.map((m) => toRunModel(runId, m));

  const overallPct =
    models.length > 0
      ? Math.round(models.reduce((acc, m) => acc + m.progressPct, 0) / models.length)
      : 0;

  const samplesTotal = models.length * samplesPerModel;

  const liveSampleIndex = Math.max(1, ...liveModels.map((m) => m.currentSampleIndex ?? 0));

  const modelIdFor = (endpointId: string): string => modelMeta[endpointId]?.modelId ?? endpointId;

  const failure: LiveFailure | null = state.lastFailure
    ? {
        endpointId: state.lastFailure.endpointId,
        modelId: modelIdFor(state.lastFailure.endpointId),
        sampleIndex: state.lastFailure.sampleIndex,
        samplesPerModel,
      }
    : null;

  /* Console tail: same composition rule as the Phase 0 server page —
     "type.padEnd(16) scope · detail" unless the message already leads with
     the model scope. */
  const consoleLines: ConsoleLineVM[] = state.consoleLines.map((e) => {
    const scope = e.endpointId ? modelIdFor(e.endpointId) : null;
    const detail = scope && !e.message.startsWith(scope) ? `${scope} · ${e.message}` : e.message;
    return { t: e.t, level: e.level, text: `${e.type.padEnd(16)} ${detail}` };
  });

  const run: Run = {
    ...baseRun,
    status: state.runStatus === "queued" ? baseRun.status : state.runStatus,
    costSpentUsd: state.costSpentUsd,
    elapsedSec: state.elapsedSec,
    completedAt: state.runStatus === "completed" ? baseRun.completedAt : null,
  };

  /* Meta for endpoints the replay introduced that the server didn't know. */
  const meta: Record<string, LiveModelMeta> = { ...modelMeta };
  for (const m of liveModels) {
    meta[m.endpointId] ??= { ...FALLBACK_META, modelId: m.endpointId };
  }

  return (
    <LiveRunScreen
      runId={runId}
      run={run}
      models={models}
      modelMeta={meta}
      events={state.events}
      consoleLines={consoleLines}
      overallPct={overallPct}
      samplesDone={state.samplesDone}
      samplesTotal={samplesTotal}
      liveSampleIndex={liveSampleIndex}
      failure={failure}
      streamChip={chipLabels(runId)[connection]}
    />
  );
}
