import type { BrowserTestResult, CheckCategory } from "../../index";
import type { SampleResult } from "../../index";

/**
 * Fixture mirror of the runner's CHECK_CATEGORY map (the source of truth lives
 * in runners/build-arena/src/checks/browser-checks.ts — schemas must not
 * depend on the runner). Keep the two in step when a check is added.
 */
export const FIXTURE_CHECK_CATEGORY: Record<string, CheckCategory> = {
  "html.parses": "gate",
  "page.loads": "gate",
  "console.clean": "gate",
  "canvas.renders": "gate",
  "interaction.wasd": "capability",
  "interaction.mouse": "capability",
  "minimap.present": "capability",
  "textures.applied": "capability",
  "resize.handled": "capability",
  "screenshot.captured": "diagnostic",
  "fps.stable": "diagnostic",
  "a11y.contrast": "diagnostic",
};
const categoryFor = (name: string): CheckCategory => FIXTURE_CHECK_CATEGORY[name] ?? "capability";

const ok = (name: string, note = ""): BrowserTestResult => ({
  name,
  status: "passed",
  note,
  durationMs: null,
  category: categoryFor(name),
});
const fail = (name: string, note: string): BrowserTestResult => ({
  name,
  status: "failed",
  note,
  durationMs: null,
  category: categoryFor(name),
});
const skip = (name: string): BrowserTestResult => ({
  name,
  status: "skipped",
  note: "skipped (render failed)",
  durationMs: null,
  category: categoryFor(name),
});

export const CHECK_NAMES = [
  "html.parses",
  "page.loads",
  "console.clean",
  "canvas.renders",
  "interaction.wasd",
  "interaction.mouse",
  "minimap.present",
  "screenshot.captured",
  "textures.applied",
  "fps.stable",
  "resize.handled",
  "a11y.contrast",
] as const;

export const okTrace: BrowserTestResult[] = [
  ok("html.parses", "valid document"),
  ok("page.loads", "1.4s < 5s limit"),
  ok("console.clean", "no errors"),
  ok("canvas.renders", "frame delta confirmed"),
  ok("interaction.wasd", "movement responds"),
];

export const failTrace: BrowserTestResult[] = [
  ok("html.parses", "valid document"),
  ok("page.loads", "1.6s < 5s"),
  fail("console.clean", "Uncaught TypeError: ctx is null (raycast.js:41)"),
  fail("canvas.renders", "blank frame"),
  skip("interaction.wasd"),
];

const rawOk = `<!DOCTYPE html>
<html><head><style>body{margin:0}canvas{display:block}</style></head>
<body><canvas id="screen"></canvas><script>
const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
// ... raycasting loop, texture sampling, minimap ...
</script></body></html>`;

const rawFail = `<!DOCTYPE html>
<html><body><canvas id="view"></canvas><script>
// BUG: element id is "view" but the code looks up "screen"
const cv = document.getElementById('screen');
const ctx = cv.getContext('2d'); // ctx is null
function start(){ ctx.fillRect(0,0,320,200); }
start();
</script></body></html>`;

/**
 * 12 samples. Per-sample costs sum exactly to the model totals
 * (audit §9 defect 1 fixed: sonnet = 0.14 + 0.14 + 0.13 = 0.41).
 */
export const samples: SampleResult[] = [
  // claude-sonnet-4-6 — 9.4 / 9.1 / 9.1 → mean 9.2
  s("anthropic/claude-sonnet-4-6", 1, 1, 9.4, 0.14, 34_600, 920, 42, false),
  s("anthropic/claude-sonnet-4-6", 2, 2, 9.1, 0.14, 39_400, 920, 42, false),
  s("anthropic/claude-sonnet-4-6", 3, 3, 9.1, 0.13, 41_200, 920, 42, false),
  // gpt-5.2-mini — 8.2 / 8.0 / 8.1 → 8.1
  s("openai/gpt-5.2-mini", 1, 4, 8.2, 0.06, 22_900, 610, 42, false),
  s("openai/gpt-5.2-mini", 2, 5, 8.0, 0.06, 24_100, 610, 42, true),
  s("openai/gpt-5.2-mini", 3, 6, 8.1, 0.06, 27_100, 610, 42, false),
  // gemini-3-flash — 7.6 / 7.2 / 7.4 → 7.4
  s("google/gemini-3-flash", 1, 7, 7.6, 0.02, 17_800, 480, 42, true),
  s("google/gemini-3-flash", 2, 8, 7.2, 0.02, 19_100, 480, 42, false),
  s("google/gemini-3-flash", 3, 9, 7.4, 0.02, 21_000, 480, 42, false),
  // qwen3-coder-32b — 7.0 / FAIL / 6.6 → 6.8 (n=2); unseeded
  s("ollama/qwen3-coder-32b@q4_K_M", 1, 10, 7.0, 0, 88_000, 2_400, null, false),
  {
    runId: "run_8f3ac21e",
    endpointId: "ollama/qwen3-coder-32b@q4_K_M",
    sampleIndex: 2,
    globalIndex: 11,
    status: "failed",
    score: { failed: true },
    primaryScorer: "browser",
    costUsd: 0,
    latencyMs: 96_000,
    ttftMs: 2_400,
    seed: null,
    hasArtifact: true,
    tokensOut: 19_800,
    rawExcerpt: rawFail,
    scorerTrace: failTrace,
    judgeReversed: false,
    humanReviewed: true,
    humanNote:
      "Render failed: canvas element id mismatch (#view vs #screen lookup). " +
      "Geometry code below the bug looks plausible. Failure preserved as evidence.",
  },
  s("ollama/qwen3-coder-32b@q4_K_M", 3, 12, 6.6, 0, 104_000, 2_400, null, false),
];

function s(
  endpointId: string,
  sampleIndex: number,
  globalIndex: number,
  value: number,
  costUsd: number,
  latencyMs: number,
  ttftMs: number,
  seed: number | null,
  judgeReversed: boolean,
): SampleResult {
  return {
    runId: "run_8f3ac21e",
    endpointId,
    sampleIndex,
    globalIndex,
    status: "scored",
    score: { value },
    primaryScorer: "human",
    costUsd,
    latencyMs,
    ttftMs,
    seed,
    hasArtifact: true,
    tokensOut: null,
    rawExcerpt: rawOk,
    scorerTrace: okTrace,
    judgeReversed,
    humanReviewed: false,
    humanNote: null,
  };
}
