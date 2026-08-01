import type { Artifact, BrowserTestResult, ConsoleLine } from "../../index";
import { CHECK_NAMES } from "./samples";

const SANDBOX = { isolatedOrigin: true, networkBlocked: true, execLimitSec: 30, sizeLimitMb: 2 };

/** Full 12-check list with the given failures (by name → note). */
function checks(failures: Record<string, string>, skipped: string[] = []): BrowserTestResult[] {
  return CHECK_NAMES.map((name) => {
    if (name in failures) return { name, status: "failed" as const, note: failures[name]!, durationMs: null };
    if (skipped.includes(name)) return { name, status: "skipped" as const, note: "skipped (render failed)", durationMs: null };
    const notes: Record<string, string> = {
      "html.parses": "valid document",
      "page.loads": "1.4s < 5s limit",
      "screenshot.captured": "1280×720",
    };
    return { name, status: "passed" as const, note: notes[name] ?? "", durationMs: null };
  });
}

const sonnetConsole: ConsoleLine[] = [
  { t: "0.212s", level: "info", msg: "raycaster booted · 8×5 map" },
  { t: "0.480s", level: "info", msg: "textures generated procedurally · 4 wall types" },
  { t: "1.120s", level: "info", msg: "render loop stable at 60fps" },
];

const geminiConsole: ConsoleLine[] = [
  { t: "0.190s", level: "info", msg: "raycaster booted · 8×5 map" },
  { t: "0.410s", level: "warn", msg: "texture atlas missing — falling back to flat shade" },
  { t: "0.950s", level: "info", msg: "render loop running" },
];

const qwenConsole: ConsoleLine[] = [
  { t: "0.201s", level: "error", msg: "Uncaught TypeError: ctx is null (raycast.js:41)" },
  { t: "0.201s", level: "muted", msg: "    at start (raycast.js:41)" },
  { t: "0.202s", level: "muted", msg: "    at raycast.js:88" },
];

const singleFileSource = (id: string, bug = false) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}canvas{display:block}</style></head>
<body>
<canvas id="${bug ? "view" : "screen"}" width="960" height="600"></canvas>
<script>
"use strict";
// ${id} — one-shot raycaster (single-file contract: inline CSS/JS, no network)
const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');${bug ? " // BUG: canvas id is \"view\" — ctx is null" : ""}
const MAP = [[1,1,1,1,1,1,1,1],[1,0,0,0,0,0,0,1],[1,0,1,0,0,1,0,1],[1,0,0,0,0,0,0,1],[1,1,1,1,1,1,1,1]];
let px = 2.5, py = 2.5, pa = 0;
const keys = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
function castColumn(x) { /* DDA ray march, returns distance + wall face */ }
function drawMinimap() { /* top-right overview with player dot */ }
function frame() {
  if (keys.w) { px += Math.cos(pa) * 0.05; py += Math.sin(pa) * 0.05; }
  // ... texture-mapped column rendering ...
  drawMinimap();
  requestAnimationFrame(frame);
}
frame();
</script>
</body>
</html>`;

export const artifacts: Artifact[] = [
  {
    runId: "run_8f3ac21e", endpointId: "anthropic/claude-sonnet-4-6", sampleIndex: 1,
    path: "artifacts/8f3a/sonnet-4-6/raycaster.html", filename: "raycaster.html", sizeKb: 48,
    renderOk: true, isBestOfModel: true, source: singleFileSource("claude-sonnet-4-6"),
    screenshotRef: null, consoleLines: sonnetConsole,
    checks: checks({
      "resize.handled": "canvas fixed at 960×600",
      "a11y.contrast": "HUD contrast 2.9:1",
    }),
    judgeCommentary:
      "Strongest spatial readability of the four; texture variation and lighting falloff sell depth. " +
      "Minor: HUD text is low-contrast against bright walls.",
    sandbox: SANDBOX,
  },
  {
    runId: "run_8f3ac21e", endpointId: "openai/gpt-5.2-mini", sampleIndex: 2,
    path: "artifacts/8f3a/gpt-5.2-mini/raycaster.html", filename: "raycaster.html", sizeKb: 41,
    renderOk: true, isBestOfModel: true, source: singleFileSource("gpt-5.2-mini"),
    screenshotRef: null,
    consoleLines: [{ t: "0.188s", level: "info", msg: "raycaster booted · 8×5 map" }],
    checks: checks({}),
    judgeCommentary:
      "Every interaction behaves exactly as briefed; visuals are competent but flatter than A. " +
      "The only build with zero console output beyond boot.",
    sandbox: SANDBOX,
  },
  {
    runId: "run_8f3ac21e", endpointId: "google/gemini-3-flash", sampleIndex: 1,
    path: "artifacts/8f3a/gemini-3-fl/raycaster.html", filename: "raycaster.html", sizeKb: 36,
    renderOk: true, isBestOfModel: true, source: singleFileSource("gemini-3-flash"),
    screenshotRef: null, consoleLines: geminiConsole,
    checks: checks({
      "textures.applied": "flat-shade fallback used",
      "fps.stable": "drops to 41fps on turn",
      "a11y.contrast": "minimap border 2.4:1",
    }),
    judgeCommentary:
      "Remarkable output for the cost. Verdict on this pair reversed on order swap (⟲) — " +
      "flagged and excluded from the tally.",
    sandbox: SANDBOX,
  },
  {
    runId: "run_8f3ac21e", endpointId: "ollama/qwen3-coder-32b@q4_K_M", sampleIndex: 2,
    path: "artifacts/8f3a/qwen3-32b/raycaster.html", filename: "raycaster.html", sizeKb: 52,
    renderOk: false, isBestOfModel: false, source: singleFileSource("qwen3-coder-32b", true),
    screenshotRef: null, consoleLines: qwenConsole,
    checks: checks(
      {
        "console.clean": "TypeError: ctx is null (raycast.js:41)",
        "canvas.renders": "blank frame",
      },
      ["interaction.wasd", "interaction.mouse", "minimap.present", "textures.applied", "fps.stable", "resize.handled", "a11y.contrast"],
    ),
    judgeCommentary:
      "The artifact loaded but rendered nothing. Failure preserved as evidence — see Browser Tests. " +
      "Root cause: canvas element id mismatch (#view vs #screen).",
    sandbox: SANDBOX,
  },
];
