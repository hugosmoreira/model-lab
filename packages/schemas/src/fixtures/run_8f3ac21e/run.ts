import type { Run, RunConfiguration, RunManifest, RunModel } from "../../index";

/**
 * The demo scenario exists at two moments of one timeline (audit §9 defect 3,
 * made explicit): "live" (mid-run, 9/12 samples, $0.63) and "completed".
 */
export type Timeline = "live" | "completed";

export const runConfiguration: RunConfiguration = {
  temperature: 0.7,
  maxOutputTokens: 16_000,
  seed: 42,
  samplesPerModel: 3,
  concurrency: 4,
  retryPolicy: { generation: "none", transportRetries: 1 },
  maxBudgetUsd: 2.0,
  toolAccess: false,
  artifactNetworkPolicy: "blocked",
  saveReasoningMetadata: true,
  scorers: [
    {
      type: "browser",
      name: "Browser checks — 12 assertions",
      rubricVersion: null,
      orderSwapped: false,
      enabled: true,
    },
    {
      type: "human",
      name: "Human visual rubric v2",
      rubricVersion: "v2",
      orderSwapped: false,
      enabled: true,
    },
    {
      type: "llm-judge",
      name: "LLM judge — rubric v2, order-swapped",
      rubricVersion: "v2",
      orderSwapped: true,
      enabled: true,
    },
  ],
  configDifferences: ["qwen3-coder-32b (ollama) runs unseeded — provider lacks seed support"],
};

const base = {
  id: "run_8f3ac21e",
  fingerprint: "fp_c41d9e72a08b", // content-addressed config hash — distinct from id
  name: "One-Shot Raycaster Challenge",
  mode: "build-arena" as const,
  pack: { slug: "raycaster-oneshot", version: "v1.3" },
  promptHash: "9d2e44a1",
  samplesPerModel: 3,
  modelCount: 4,
  budgetCeilingUsd: 2.0,
  estCostRangeUsd: [0.58, 0.86] as [number, number],
  startedAt: "2026-07-31T14:21:00Z",
  runnerVersion: "model-lab v0.4.1",
  gitCommit: "41c7f2a",
  compositeWeighting: { browser: 50, visual: 35, efficiency: 15 },
  judgeReversalCount: 1,
};

export const runLive: Run = {
  ...base,
  status: "running",
  costSpentUsd: 0.63,
  completedAt: null,
  elapsedSec: 252, // 04:12
  verdict: null,
};

export const runCompleted: Run = {
  ...base,
  status: "completed",
  costSpentUsd: 0.65,
  completedAt: "2026-07-31T14:27:41Z",
  elapsedSec: 401, // 06:41
  verdict: {
    label: "NO CLEAR WINNER",
    narrative:
      "claude-sonnet-4-6 produced the strongest visuals (9.2/10) but missed two browser checks. " +
      "gpt-5.2-mini was the only model to pass all 12 interaction tests. gemini-3-flash delivered " +
      "85% of the quality at a third of the cost. qwen3-coder-32b (local) failed one render — " +
      "the failure is preserved as evidence.",
  },
};

export function getRun(timeline: Timeline): Run {
  return timeline === "live" ? runLive : runCompleted;
}

export const runModelsLive: RunModel[] = [
  {
    runId: "run_8f3ac21e",
    endpointId: "anthropic/claude-sonnet-4-6",
    status: "scoring",
    failedSampleCount: 0,
    progressPct: 100,
    currentTask: "sample 3/3 · judge pass (order B/A)",
    tokensOut: 21_400,
    ttftMs: 920,
    totalLatencyMs: 38_400,
    costUsd: 0.41,
    visualScore: null,
    testsPassed: 10,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: null,
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "openai/gpt-5.2-mini",
    status: "completed",
    failedSampleCount: 0,
    progressPct: 100,
    currentTask: "3/3 samples · 12/12 browser tests",
    tokensOut: 18_200,
    ttftMs: 610,
    totalLatencyMs: 24_700,
    costUsd: 0.18,
    visualScore: { value: 8.1, n: 3 },
    testsPassed: 12,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: "all tests pass",
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "google/gemini-3-flash",
    status: "testing",
    failedSampleCount: 0,
    progressPct: 72,
    currentTask: "sample 3/3 · running browser checks (7/12)",
    tokensOut: 15_900,
    ttftMs: 480,
    totalLatencyMs: 19_300,
    costUsd: 0.04,
    visualScore: null,
    testsPassed: null,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: null,
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "ollama/qwen3-coder-32b@q4_K_M",
    status: "generating",
    failedSampleCount: 1,
    progressPct: 41,
    currentTask: "sample 3/3 generating · 41% (local, unseeded)",
    tokensOut: 19_800,
    ttftMs: 2_400,
    totalLatencyMs: 96_000,
    costUsd: 0,
    visualScore: null,
    testsPassed: null,
    testsTotal: 12,
    retries: 0,
    unseeded: true,
    flag: "1 render fail",
  },
];

export const runModelsCompleted: RunModel[] = [
  {
    runId: "run_8f3ac21e",
    endpointId: "anthropic/claude-sonnet-4-6",
    status: "completed",
    failedSampleCount: 0,
    progressPct: 100,
    currentTask: null,
    tokensOut: 21_400,
    ttftMs: 920,
    totalLatencyMs: 38_400,
    costUsd: 0.41,
    visualScore: { value: 9.2, n: 3 },
    testsPassed: 10,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: "best visual",
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "openai/gpt-5.2-mini",
    status: "completed",
    failedSampleCount: 0,
    progressPct: 100,
    currentTask: null,
    tokensOut: 18_200,
    ttftMs: 610,
    totalLatencyMs: 24_700,
    costUsd: 0.18,
    visualScore: { value: 8.1, n: 3 },
    testsPassed: 12,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: "all tests pass",
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "google/gemini-3-flash",
    status: "completed",
    failedSampleCount: 0,
    progressPct: 100,
    currentTask: null,
    tokensOut: 15_900,
    ttftMs: 480,
    totalLatencyMs: 19_300,
    costUsd: 0.06,
    visualScore: { value: 7.4, n: 3 },
    testsPassed: 9,
    testsTotal: 12,
    retries: 0,
    unseeded: false,
    flag: "best value",
  },
  {
    runId: "run_8f3ac21e",
    endpointId: "ollama/qwen3-coder-32b@q4_K_M",
    status: "completed",
    failedSampleCount: 1,
    progressPct: 100,
    currentTask: null,
    tokensOut: 19_800,
    ttftMs: 2_400,
    totalLatencyMs: 96_000,
    costUsd: 0,
    visualScore: { value: 6.8, n: 2 },
    testsPassed: 6,
    testsTotal: 12,
    retries: 0,
    unseeded: true,
    flag: "1 render fail",
  },
];

export function getRunModels(timeline: Timeline): RunModel[] {
  return timeline === "live" ? runModelsLive : runModelsCompleted;
}

export const runManifest: RunManifest = {
  runId: "run_8f3ac21e",
  fingerprint: "fp_c41d9e72a08b",
  benchmark: "raycaster-oneshot v1.3",
  promptHash: "9d2e44a1",
  runnerVersion: "model-lab v0.4.1",
  date: "2026-07-31",
  samplesPerModel: 3,
  modelCount: 4,
  scorers: ["browser", "human", "llm-judge"],
  gitCommit: "41c7f2a",
};

export const challengePrompt =
  "Build a playable raycaster in ONE self-contained HTML file. Textured walls, WASD movement, " +
  "a minimap, and no external network dependencies. Return only the HTML document.";

/** Latency ranges (ms) per endpoint for the Results bands, fastest-first. */
export const latencyRanges: Record<string, { min: number; median: number; max: number }> = {
  "google/gemini-3-flash": { min: 17_800, median: 19_300, max: 21_000 },
  "openai/gpt-5.2-mini": { min: 22_900, median: 24_700, max: 27_100 },
  "anthropic/claude-sonnet-4-6": { min: 34_600, median: 38_400, max: 41_200 },
  "ollama/qwen3-coder-32b@q4_K_M": { min: 88_000, median: 96_000, max: 104_000 },
};
