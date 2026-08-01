/**
 * View-model builders for the Build Arena grid and Artifact Viewer.
 * Every display string is derived from fixtures here; components only render.
 */
import type { Artifact } from "@model-lab/schemas";
import { endpointProviderLabel, fixtures, modelColor, modelIdOf } from "@/lib/data";
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

export interface BuildVM {
  endpointId: string;
  /** modelId, e.g. "claude-sonnet-4-6" */
  name: string;
  /** "anthropic · cloud" / "ollama · local · RTX 4090" */
  provider: string;
  /** fixed identity color (square dots only — never status) */
  color: string;
  renderOk: boolean;
  /** grid metric: "9.2" | "6.8 (n=2)" | "—" */
  visualLabel: string;
  /** inspector stat: "9.2/10" | "6.8/10 (n=2)" | "—" */
  visualStatLabel: string;
  /** "10/12" */
  testsLabel: string;
  /** teal all-pass / amber partial / red render-failed */
  testsColor: string;
  costLabel: string;
  latencyLabel: string;
  /** "0" | "1 warn" | "1 error" — counted from consoleLines */
  consoleLabel: string;
  consoleColor: string;
  /** builds-rail meta: "10/12 tests · $0.41" | "render failed · $0.00" */
  railMeta: string;
  /** "1/3" */
  sampleIndexLabel: string;
  /** "1/3 (best)" | "2/3 (failed)" */
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

export function getBuilds(): BuildVM[] {
  const cfg = fixtures.runConfiguration;
  const models = fixtures.getRunModels("completed");

  return fixtures.artifacts.map((a) => {
    const rm = models.find((m) => m.endpointId === a.endpointId);
    const vs = rm?.visualScore ?? null;
    const reducedN = vs != null && vs.n < cfg.samplesPerModel ? ` (n=${vs.n})` : "";
    const testsPassed = rm?.testsPassed ?? null;
    const testsTotal = rm?.testsTotal ?? null;
    const testsLabel =
      testsPassed != null && testsTotal != null ? `${testsPassed}/${testsTotal}` : "—";
    const allPass = testsPassed != null && testsTotal != null && testsPassed === testsTotal;
    const errors = a.consoleLines.filter((l) => l.level === "error").length;
    const warns = a.consoleLines.filter((l) => l.level === "warn").length;
    const costLabel = usd(rm?.costUsd ?? 0);
    const sandboxParts = [
      a.sandbox.isolatedOrigin ? "sandboxed" : null,
      a.sandbox.networkBlocked ? "network blocked" : null,
    ].filter((p): p is string => p != null);

    return {
      endpointId: a.endpointId,
      name: modelIdOf(a.endpointId),
      provider: endpointProviderLabel(a.endpointId),
      color: modelColor(a.endpointId),
      renderOk: a.renderOk,
      visualLabel: vs ? `${vs.value.toFixed(1)}${reducedN}` : "—",
      visualStatLabel: vs ? `${vs.value.toFixed(1)}/10${reducedN}` : "—",
      testsLabel,
      testsColor: allPass
        ? "var(--color-teal)"
        : a.renderOk
          ? "var(--color-amber)"
          : "var(--color-red)",
      costLabel,
      latencyLabel: rm?.totalLatencyMs != null ? seconds(rm.totalLatencyMs) : "—",
      consoleLabel:
        errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : warns > 0 ? `${warns} warn` : "0",
      consoleColor:
        errors > 0
          ? "var(--color-red)"
          : warns > 0
            ? "var(--color-amber)"
            : "var(--color-teal)",
      railMeta: a.renderOk ? `${testsLabel} tests · ${costLabel}` : `render failed · ${costLabel}`,
      sampleIndexLabel: `${a.sampleIndex}/${cfg.samplesPerModel}`,
      sampleLabel: `${a.sampleIndex}/${cfg.samplesPerModel} (${a.isBestOfModel ? "best" : "failed"})`,
      seedLabel: (rm?.unseeded ?? false) || cfg.seed == null ? "unseeded" : String(cfg.seed),
      sandboxChipLabel: sandboxParts.join(" · "),
      sandboxBadgeLabel: [...sandboxParts, `${a.sandbox.execLimitSec}s limit`].join(" · "),
      artifact: a,
      sortScore: vs?.value ?? -1,
      sortCost: rm?.costUsd ?? Number.MAX_SAFE_INTEGER,
      sortLatency: rm?.totalLatencyMs ?? Number.MAX_SAFE_INTEGER,
      sortTests: testsPassed ?? -1,
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

export function getArenaData(): ArenaData {
  const run = fixtures.runCompleted;
  const cfg = fixtures.runConfiguration;
  const caption = [
    "Identical prompt",
    `temperature ${cfg.temperature}`,
    `${cfg.maxOutputTokens / 1000}k max tokens`,
    cfg.retryPolicy.generation === "none" ? "first-shot only" : "generation retries enabled",
    `sample shown: best of ${cfg.samplesPerModel} per model`,
  ].join(" · ");
  return {
    runId: run.id,
    packVersion: run.pack.version,
    prompt: fixtures.challengePrompt,
    caption,
    builds: getBuilds(),
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

export function getViewerData(): ViewerData {
  const run = fixtures.runCompleted;
  const pack = fixtures.benchmarkPacks.find((p) => p.slug === run.pack.slug);
  const judge = fixtures.runConfiguration.scorers.find((s) => s.type === "llm-judge");
  return {
    runId: run.id,
    promptHash: run.promptHash,
    packName: pack?.name ?? run.name,
    samplesPerModel: run.samplesPerModel,
    judgeHeading: `Judge — labeled${judge?.orderSwapped ? ", order-swapped" : ""}`,
    builds: getBuilds(),
  };
}
