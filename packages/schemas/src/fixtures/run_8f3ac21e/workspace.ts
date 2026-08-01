import type { BenchmarkPack, ShareExportRecord, WorkspaceSettings, WorkspaceStats } from "../../index";

export const workspaceStats: WorkspaceStats = {
  qualityLeader7d: {
    endpointId: "anthropic/claude-sonnet-4-6",
    score: 9.2, max: 10, dimension: "visual", n: 3,
  },
  cheapestPassingRun: {
    endpointId: "google/gemini-3-flash",
    costUsd: 0.06, tests: "9/12",
  },
  reliability7d: { pct: 92, detail: "1 render failure / 12 samples" },
  spendThisWeek: { usd: 4.87, runs: 6, budgetUsd: 20 },
  sessionSpend: { usd: 1.12, budgetUsd: 5 },
  providersConnected: { connected: 4, total: 5 },
  localRunner: { engine: "ollama", gpu: "4090", online: true },
};

/** Recent-runs list for Mission Control / runs index. Names beyond the two
 *  the prototype specifies are fixture-authored. */
export interface RunListItem {
  id: string;
  name: string;
  mode: "build-arena" | "verified" | "performance" | "head-to-head";
  status: "running" | "completed" | "partial";
  modelCount: number;
  samplesPerModel: number;
  costUsd: number;
  when: string;
}

export const recentRuns: RunListItem[] = [
  { id: "run_8f3ac21e", name: "One-Shot Raycaster Challenge", mode: "build-arena", status: "running", modelCount: 4, samplesPerModel: 3, costUsd: 0.63, when: "now" },
  { id: "run_b91d004a", name: "Structured JSON extraction v2", mode: "verified", status: "completed", modelCount: 3, samplesPerModel: 25, costUsd: 1.84, when: "2h ago" },
  { id: "run_77e2c1f0", name: "Latency & throughput sweep", mode: "performance", status: "completed", modelCount: 5, samplesPerModel: 1, costUsd: 0.92, when: "yesterday" },
  { id: "run_c33a98d2", name: "Raycaster blind pairs", mode: "head-to-head", status: "completed", modelCount: 6, samplesPerModel: 10, costUsd: 1.48, when: "2d ago" },
  { id: "run_e10fa6b7", name: "Synthwave Dashboard one-shot", mode: "build-arena", status: "partial", modelCount: 2, samplesPerModel: 10, costUsd: 0.37, when: "4d ago" },
];

export const notableFinding = {
  body:
    "claude-sonnet-4-6 won on visual quality (9.2/10) but gpt-5.2-mini — which scored 1.1 pts " +
    "below — was the only model to pass all 12 browser interaction tests. The best-looking build " +
    "was not the most correct one.",
  note:
    "Also: the LLM judge reversed its verdict after an order swap in 1 of 6 pairs — flagged and " +
    "excluded from the tally.",
  investigateHref: "/runs/run_8f3ac21e/results",
  reviewHref: "/compare",
  shareHref: "/share/run_8f3ac21e",
};

export const recentExports: ShareExportRecord[] = [
  { filename: "raycaster-scorecard.png", aspect: "16:9", runId: "run_8f3ac21e", exportedAt: "2026-07-31T12:04:00Z" },
  { filename: "cost-vs-quality.png", aspect: "1:1", runId: "run_b91d004a", exportedAt: "2026-07-30T18:40:00Z" },
];

export const benchmarkPacks: BenchmarkPack[] = [
  {
    slug: "raycaster-oneshot", name: "One-Shot Raycaster", version: "v1.3", kind: "build-arena",
    source: "official",
    description: "Playable textured raycaster in one HTML file — WASD, minimap, no network.",
    taskCount: 1, browserCheckCount: 12, evalScorer: null,
    scorersSummary: "browser(12)+human+judge",
    estCostPerModelUsd: 0.2, estOutputTokensPerModel: 20_000,
    category: null, license: "MIT",
    prompt:
      "Build a playable raycaster in ONE self-contained HTML file. Textured walls, WASD movement, " +
      "a minimap, and no external network dependencies. Return only the HTML document.",
    lastRunAt: "today",
  },
  {
    slug: "synthwave-dashboard", name: "Synthwave Dashboard", version: "v2.0", kind: "build-arena",
    source: "official",
    description: "Animated synthwave-styled analytics dashboard, one self-contained HTML file.",
    taskCount: 1, browserCheckCount: 9, evalScorer: null,
    scorersSummary: "browser(9)+human",
    estCostPerModelUsd: 0.15, estOutputTokensPerModel: 16_000,
    category: null, license: "MIT", prompt: null, lastRunAt: "6d ago",
  },
  {
    slug: "voxel-terrain-flyover", name: "Voxel Terrain Flyover", version: "v1.1", kind: "build-arena",
    source: "community",
    description: "Procedural voxel terrain with an automatic camera flyover.",
    taskCount: 1, browserCheckCount: 8, evalScorer: null,
    scorersSummary: "browser(8)+human",
    estCostPerModelUsd: 0.18, estOutputTokensPerModel: 18_000,
    category: null, license: "MIT", prompt: null, lastRunAt: null,
  },
  {
    slug: "structured-json-extraction", name: "Structured JSON extraction", version: "v2.4", kind: "eval",
    source: "official",
    description: "Schema-constrained extraction from messy prose.",
    taskCount: 25, browserCheckCount: null, evalScorer: "OBJECTIVE",
    scorersSummary: "OBJECTIVE",
    estCostPerModelUsd: 0.6, estOutputTokensPerModel: null,
    category: "structured output", license: "MIT", prompt: null, lastRunAt: "2h ago",
  },
  {
    slug: "gsm-hard-subset", name: "GSM-Hard subset", version: "v1.0", kind: "eval",
    source: "imported",
    description: "Hard grade-school math with exact-match answers.",
    taskCount: 50, browserCheckCount: null, evalScorer: "EXACT-MATCH",
    scorersSummary: "EXACT-MATCH",
    estCostPerModelUsd: 0.9, estOutputTokensPerModel: null,
    category: "math reasoning", license: "MIT", prompt: null, lastRunAt: "2w ago",
  },
  {
    slug: "humaneval-mini", name: "HumanEval-Mini", version: "v1.2", kind: "eval",
    source: "imported",
    description: "Code generation scored by unit tests.",
    taskCount: 40, browserCheckCount: null, evalScorer: "CODE-TEST",
    scorersSummary: "CODE-TEST",
    estCostPerModelUsd: 1.1, estOutputTokensPerModel: null,
    category: "code · unit tests", license: "MIT", prompt: null, lastRunAt: "1mo ago",
  },
  {
    slug: "client-ui-tasks", name: "Client UI tasks (private)", version: "v0.3", kind: "eval",
    source: "custom",
    description: "Instruction-following UI tasks from client work.",
    taskCount: 12, browserCheckCount: null, evalScorer: "HYBRID",
    scorersSummary: "HYBRID",
    estCostPerModelUsd: 0.4, estOutputTokensPerModel: null,
    category: "instruction following", license: "private", prompt: null, lastRunAt: null,
  },
];

export const workspaceSettings: WorkspaceSettings = {
  defaultRunBudgetUsd: 2,
  defaultConcurrency: 4,
  dataRetention: "keep forever",
  artifactDirectory: "~/model-lab/artifacts",
  localHardwareProfile: "RTX 4090 · 24GB",
  telemetry: "off",
  artifactNetworkPolicy: "blocked",
  defaultScoringPolicy: "browser → human → judge",
  exportBranding: "repo + fingerprint",
  themeAccessibility: "dark · system motion",
  repoUrl: "github.com/hugom/model-lab",
  workspacePath: "~/dev/model-lab",
};
