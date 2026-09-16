/**
 * View-model builders for the Build Arena grid and Artifact Viewer.
 * Phase 3: pure functions over run data supplied by the server loaders
 * (`getRunView`) — fixture demo and store-backed runs flow through the same
 * builders. This module stays CLIENT-SAFE (ArtifactViewer imports it): no
 * store/loader imports, schemas types only.
 */
import type { Artifact, Run, RunConfiguration, RunModel } from "@model-lab/schemas";
import { capabilityForModel } from "@/lib/checks";
import { endpointProviderLabel, modelColor, modelIdOf } from "@/lib/data";
import { seconds, usd } from "@/lib/format";

/** Endpoint ids contain "/" — swap to "~" for URL segments. */
export function encodeEndpointId(id: string): string {
  return id.replace(/\//g, "~");
}

/** Reverse of encodeEndpointId; tolerant of percent-encoded segments. */
export function decodeEndpointId(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    // malformed escape — keep the raw segment
  }
  return s.replace(/~/g, "/");
}

/** Everything the builders need — structurally satisfied by loaders' RunView. */
export interface RunArtifactData {
  run: Run;
  configuration: RunConfiguration;
  runModels: RunModel[];
  artifacts: Artifact[];
  challengePrompt: string;
  packName: string;
}

export interface BuildVM {
  endpointId: string;
  /** modelId, e.g. "claude-sonnet-4-6" */
  name: string;
  /** "anthropic · cloud" / "ollama · local · RTX 4090" */
  provider: string;
  /** fixed identity color (square dots only — never status) */
  color: string;
  renderOk: boolean;
  /** true when a person rated this build; the browser ratio is never shown as "visual" */
  humanRated: boolean;
  /** grid metric — human rating mean: "9.2" | "6.8 (n=2)" | "—" when nobody rated */
  visualLabel: string;
  /** inspector stat — human rating mean: "9.2/10" | "6.8/10 (n=2)" | "—" when nobody rated */
  visualStatLabel: string;
  /** capability ratio, "4/5" — gates and diagnostics are not scored */
  testsLabel: string;
  /** teal all-pass / amber partial / red gate-failed or render-failed */
  testsColor: string;
  /** "canvas.renders" when a gate failed — the headline ratio is 0 because of it */
  testsGate: string | null;
  /** the failed gate with its note, for the inspector line */
  testsGateDetail: string | null;
  costLabel: string;
  latencyLabel: string;
  /** "0" | "1 warn" | "1 error" — counted from consoleLines */
  consoleLabel: string;
  consoleColor: string;
  /** builds-rail meta: "4/5 capability · $0.41" | "gate canvas.renders · $0.00" */
  railMeta: string;
  /** "1/3" */
  sampleIndexLabel: string;
  /** "1/3 (best)" | "2/3 (failed)" | "2/3 (stored)" */
  sampleLabel: string;
  /** "42" | "unseeded" */
  seedLabel: string;
  /** "sandboxed · network blocked" (grid chip, ok state) */
  sandboxChipLabel: string;
  /** "sandboxed · network blocked · 30s limit" (viewer stage badge) */
  sandboxBadgeLabel: string;
  artifact: Artifact;
  sortScore: number;
  sortCost: number;
  sortLatency: number;
  sortTests: number;
}

/** One build per endpoint: the best-of sample, else the first render-ok, else the first (failed) artifact. */
function bestArtifactPerEndpoint(artifacts: Artifact[]): Artifact[] {
  const byEndpoint = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    const list = byEndpoint.get(a.endpointId) ?? [];
    list.push(a);
    byEndpoint.set(a.endpointId, list);
  }
  const picked: Artifact[] = [];
  for (const list of byEndpoint.values()) {
    const best = list.find((a) => a.isBestOfModel) ?? list.find((a) => a.renderOk) ?? list[0];
    if (best) picked.push(best);
  }
  return picked;
}

export function getBuilds(data: RunArtifactData): BuildVM[] {
  const cfg = data.configuration;
  const models = data.runModels;

  return bestArtifactPerEndpoint(data.artifacts).map((a) => {
    const rm = models.find((m) => m.endpointId === a.endpointId);
    /**
     * Only a human rating is a visual score. The runner's visualScore is the
     * browser capability ratio ×10 — the same evidence as the CAPABILITY
     * column — and showing it under a "visual" label was the conflation the
     * roadmap listed as the top open defect.
     */
    const humanRated = rm?.visualSource === "human" && rm.visualScore != null;
    const vs = humanRated ? rm.visualScore : null;
    const reducedN = vs != null && vs.n < cfg.samplesPerModel ? ` (n=${vs.n})` : "";
    /**
     * The headline number is the CAPABILITY ratio of this build's own trace —
     * gates are preconditions (a failed one zeroes it) and diagnostics measure
     * the harness. Read from the trace rather than the RunModel rollup so a
     * legacy 12-check trace is re-read under the same taxonomy.
     */
    const tally = capabilityForModel([a.checks], {
      passed: rm?.testsPassed ?? null,
      total: rm?.testsTotal ?? null,
    });
    const testsLabel = tally.passed != null ? `${tally.passed}/${tally.total}` : "—";
    const allPass = tally.gateName === null && tally.passed != null && tally.passed === tally.total;
    const errors = a.consoleLines.filter((l) => l.level === "error").length;
    const warns = a.consoleLines.filter((l) => l.level === "warn").length;
    const costLabel = usd(rm?.costUsd ?? 0);
    const sandboxParts = [
      a.sandbox.isolatedOrigin ? "sandboxed" : null,
      a.sandbox.networkBlocked ? "network blocked" : null,
    ].filter((p): p is string => p != null);
    const sampleTag = a.isBestOfModel ? "best" : a.renderOk ? "stored" : "failed";

    return {
      endpointId: a.endpointId,
      name: modelIdOf(a.endpointId),
      provider: endpointProviderLabel(a.endpointId),
      color: modelColor(a.endpointId),
      renderOk: a.renderOk,
      humanRated,
      visualLabel: vs ? `${vs.value.toFixed(1)}${reducedN}` : "—",
      visualStatLabel: vs ? `${vs.value.toFixed(1)}/10${reducedN}` : "—",
      testsLabel,
      testsColor:
        tally.gateName != null || !a.renderOk
          ? "var(--color-red)"
          : allPass
            ? "var(--color-teal)"
            : "var(--color-amber)",
      testsGate: tally.gateName,
      testsGateDetail: tally.gateDetail,
      costLabel,
      latencyLabel: rm?.totalLatencyMs != null ? seconds(rm.totalLatencyMs) : "—",
      consoleLabel:
        errors > 0
          ? `${errors} error${errors === 1 ? "" : "s"}`
          : warns > 0
            ? `${warns} warn`
            : "0",
      consoleColor:
        errors > 0 ? "var(--color-red)" : warns > 0 ? "var(--color-amber)" : "var(--color-teal)",
      railMeta:
        tally.gateName != null
          ? `gate ${tally.gateName} · ${costLabel}`
          : a.renderOk
            ? `${testsLabel} capability · ${costLabel}`
            : `render failed · ${costLabel}`,
      sampleIndexLabel: `${a.sampleIndex}/${cfg.samplesPerModel}`,
      sampleLabel: `${a.sampleIndex}/${cfg.samplesPerModel} (${sampleTag})`,
      seedLabel: (rm?.unseeded ?? false) || cfg.seed == null ? "unseeded" : String(cfg.seed),
      sandboxChipLabel: sandboxParts.join(" · "),
      sandboxBadgeLabel: [...sandboxParts, `${a.sandbox.execLimitSec}s limit`].join(" · "),
      artifact: a,
      // "score" sort: human rating when there is one, else the capability ratio.
      sortScore:
        vs?.value ??
        (tally.passed != null && tally.total > 0 ? (tally.passed / tally.total) * 10 : -1),
      sortCost: rm?.costUsd ?? Number.MAX_SAFE_INTEGER,
      sortLatency: rm?.totalLatencyMs ?? Number.MAX_SAFE_INTEGER,
      sortTests: tally.passed ?? -1,
    };
  });
}

export interface ArenaData {
  runId: string;
  /** pack version, e.g. "v1.3" */
  packVersion: string;
  prompt: string;
  /** run-configuration caption under the prompt */
  caption: string;
  builds: BuildVM[];
}

export function getArenaData(data: RunArtifactData): ArenaData {
  const cfg = data.configuration;
  const caption = [
    "Identical prompt",
    `temperature ${cfg.temperature}`,
    `${cfg.maxOutputTokens / 1000}k max tokens`,
    cfg.retryPolicy.generation === "none" ? "first-shot only" : "generation retries enabled",
    `sample shown: best of ${cfg.samplesPerModel} per model`,
  ].join(" · ");
  return {
    runId: data.run.id,
    packVersion: data.run.pack.version,
    prompt: data.challengePrompt,
    caption,
    builds: getBuilds(data),
  };
}

export interface ViewerData {
  runId: string;
  promptHash: string;
  /** "One-Shot Raycaster" */
  packName: string;
  samplesPerModel: number;
  /** "Judge — labeled, order-swapped" (order-swap derived from scorer config) */
  judgeHeading: string;
  builds: BuildVM[];
}

export function getViewerData(data: RunArtifactData): ViewerData {
  const judge = data.configuration.scorers.find((s) => s.type === "llm-judge");
  return {
    runId: data.run.id,
    promptHash: data.run.promptHash,
    packName: data.packName,
    samplesPerModel: data.run.samplesPerModel,
    judgeHeading: `Judge — labeled${judge?.orderSwapped ? ", order-swapped" : ""}`,
    builds: getBuilds(data),
  };
}
