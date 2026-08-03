/**
 * REGRESSION FIXTURE — the defect this whole taxonomy exists to prevent.
 *
 * Two REAL artifacts from run_0cf7aa08 (see test/fixtures/README.md):
 *
 *   renders-nothing.html  ollama/qwen3.5-abliterated — a sky gradient, a floor
 *                         gradient and an all-black minimap canvas. No walls.
 *   renders-walls.html    anthropic/claude-sonnet-4-6 — textured brick/stone
 *                         walls, a drawn minimap, working WASD.
 *
 * Under the OLD checks these two landed 9/12 and 11/12 — two points apart, with
 * the empty build collecting passes for canvas.renders, minimap.present,
 * screenshot.captured, fps.stable and a11y.contrast. This script fails the
 * build if they ever converge again.
 *
 * Run with:  pnpm --filter @model-lab/build-arena-runner test:checks
 *   (node's built-in type-stripping + test/ts-resolve.mjs — no install needed)
 * Also runs under the selftest's runtime:  pnpm dlx tsx test/check-taxonomy.test.mjs
 */
import { register } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Extensionless relative imports inside src/ need a resolve hook under plain
// node. Registering here (rather than via --import) keeps the run one command.
register("./ts-resolve.mjs", import.meta.url);

const {
  runBrowserChecks,
  closeBrowserChecks,
  BROWSER_CHECK_NAMES,
  BROWSER_NOT_INSTALLED_NOTE,
  CHECK_CATEGORY,
  categoryOf,
  capabilityChecks,
  failedGates,
} = await import("../src/checks/browser-checks.ts");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

/** The fixture pair. `expectRenders: false` is the artifact that drew nothing. */
const FIXTURES_UNDER_TEST = [
  {
    key: "renders-nothing",
    file: "renders-nothing.html",
    label: "run_0cf7aa08 · ollama/qwen3.5-abliterated (gradient only, no walls)",
    expectRenders: false,
  },
  {
    key: "renders-walls",
    file: "renders-walls.html",
    label: "run_0cf7aa08 · anthropic/claude-sonnet-4-6 (textured walls + minimap)",
    expectRenders: true,
  },
];

/** Capability score, computed exactly as run.ts computes the headline score. */
function scoreOf(checks) {
  const capability = capabilityChecks(checks);
  const gates = failedGates(checks);
  const gatesOk = gates.length === 0;
  return {
    passed: gatesOk ? capability.filter((c) => c.status === "passed").length : 0,
    total: capability.length,
    gatesOk,
    gatesFailed: gates.map((c) => c.name),
    firstGate: gates[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------
const failures = [];
let assertions = 0;

function check(ok, description, detail) {
  assertions += 1;
  if (ok) {
    console.log(`  PASS  ${description}`);
  } else {
    console.log(`  FAIL  ${description}${detail === undefined ? "" : `\n          ${detail}`}`);
    failures.push(description);
  }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------
const STATUS_MARK = { passed: "PASS", failed: "FAIL", warn: "WARN", skipped: "skip" };

function printTable(fx, outcome) {
  const s = scoreOf(outcome.checks);
  console.log("");
  console.log(`── ${fx.file} ${"─".repeat(Math.max(0, 60 - fx.file.length))}`);
  console.log(`   ${fx.label}`);
  console.log("");
  console.log(
    `   ${"check".padEnd(20)}${"category".padEnd(12)}${"status".padEnd(8)}${"ms".padStart(6)}  note`,
  );
  console.log(`   ${"-".repeat(46)}  ${"-".repeat(52)}`);
  for (const c of outcome.checks) {
    const cat = categoryOf(c);
    console.log(
      `   ${c.name.padEnd(20)}${cat.padEnd(12)}${(STATUS_MARK[c.status] ?? c.status).padEnd(8)}` +
        `${String(c.durationMs ?? "-").padStart(6)}  ${(c.note ?? "").slice(0, 90)}`,
    );
  }
  const diag = outcome.checks.filter((c) => categoryOf(c) === "diagnostic");
  console.log("");
  console.log(
    `   CAPABILITY SCORE  ${s.passed}/${s.total}` +
      (s.gatesOk
        ? "  · gates ok"
        : `  · ZEROED — gate failed: ${s.firstGate?.name} — ${s.firstGate?.note ?? ""}`),
  );
  console.log(
    `   diagnostics (not scored): ${diag.map((c) => `${c.name}=${c.status}`).join(", ") || "none"}`,
  );
  return s;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const shotDir = mkdtempSync(path.join(tmpdir(), "model-lab-taxonomy-"));
const measured = new Map();

console.log("");
console.log("CHECK TAXONOMY REGRESSION — real artifacts from run_0cf7aa08");
console.log(`screenshots → ${shotDir}`);

try {
  for (const fx of FIXTURES_UNDER_TEST) {
    const html = await readFile(path.join(FIXTURES, fx.file), "utf8");
    const outcome = await runBrowserChecks(html, {
      screenshotPath: path.join(shotDir, `${fx.key}.png`),
      watchdogMs: 30_000,
    });
    if (outcome.degraded) {
      console.error("");
      console.error(`CANNOT VALIDATE — ${BROWSER_NOT_INSTALLED_NOTE}`);
      process.exitCode = 1;
      break;
    }
    measured.set(fx.key, { fx, outcome, score: printTable(fx, outcome) });
  }
} finally {
  await closeBrowserChecks();
}

if (measured.size !== FIXTURES_UNDER_TEST.length) {
  console.error("fixtures did not all run — aborting");
  process.exit(process.exitCode === 0 ? 1 : process.exitCode);
}

const empty = measured.get("renders-nothing");
const walls = measured.get("renders-walls");

console.log("");
console.log("ASSERTIONS");
console.log("");

// -- 0. the taxonomy itself is well-formed ----------------------------------
console.log(" taxonomy");
{
  const cats = BROWSER_CHECK_NAMES.map((n) => CHECK_CATEGORY[n]);
  check(
    cats.every((c) => c === "gate" || c === "capability" || c === "diagnostic"),
    "every named check carries a category",
  );
  const gateNames = BROWSER_CHECK_NAMES.filter((n) => CHECK_CATEGORY[n] === "gate");
  const capNames = BROWSER_CHECK_NAMES.filter((n) => CHECK_CATEGORY[n] === "capability");
  check(
    gateNames.includes("canvas.renders"),
    "canvas.renders is a gate",
    `gates: ${gateNames.join(", ")}`,
  );
  check(
    !capNames.includes("screenshot.captured") &&
      !capNames.includes("fps.stable") &&
      !capNames.includes("a11y.contrast"),
    "screenshot.captured / fps.stable / a11y.contrast are not capabilities",
    `capabilities: ${capNames.join(", ")}`,
  );
}

// -- 1. the build that drew nothing -----------------------------------------
console.log("");
console.log(" renders-nothing.html (drew a gradient and nothing else)");
{
  const canvas = empty.outcome.checks.find((c) => c.name === "canvas.renders");
  check(categoryOf(canvas) === "gate", "canvas.renders is categorised as a gate");
  check(
    canvas.status === "failed",
    "canvas.renders FAILS",
    `status=${canvas.status} note=${JSON.stringify(canvas.note)}`,
  );
  // The whole point of the rewrite: the note has to name the *missing
  // structure*, not merely "blank" — this frame is not blank, it is a gradient.
  check(
    /no vertical structure|gradient only/i.test(canvas.note ?? ""),
    "the failure note names the missing structure",
    `note=${JSON.stringify(canvas.note)}`,
  );
  check(
    empty.score.passed === 0,
    "capability score is 0 (a failed gate zeroes the headline)",
    `score=${empty.score.passed}/${empty.score.total}`,
  );
  // This artifact ALSO throws once, so console.clean fails too and the zero is
  // over-determined. Re-score with the console error forgiven: canvas.renders
  // on its own must still zero it, or this fixture would not be testing the
  // pixel evidence at all.
  {
    const forgiven = scoreOf(
      empty.outcome.checks.map((c) =>
        c.name === "console.clean" ? { ...c, status: "passed" } : c,
      ),
    );
    check(
      forgiven.passed === 0 && forgiven.gatesFailed.includes("canvas.renders"),
      "canvas.renders alone zeroes it — independent of the console error",
      `with console.clean forgiven: score=${forgiven.passed}/${forgiven.total} gatesFailed=[${forgiven.gatesFailed.join(", ")}]`,
    );
  }
  // A gate failure must SKIP the remaining capability questions, never quietly
  // pass them — a silent pass is what produced the original 9/12.
  const capStatuses = capabilityChecks(empty.outcome.checks).map((c) => c.status);
  check(
    capStatuses.every((s) => s !== "passed"),
    "no capability check is recorded as passed behind a failed gate",
    `capability statuses: ${capStatuses.join(", ")}`,
  );
}

// -- 2. the build that renders ----------------------------------------------
console.log("");
console.log(" renders-walls.html (textured walls, drawn minimap)");
{
  const gates = walls.outcome.checks.filter((c) => categoryOf(c) === "gate");
  const badGates = gates.filter((c) => c.status !== "passed");
  check(
    badGates.length === 0,
    "all gates pass",
    badGates.map((c) => `${c.name}=${c.status} (${c.note})`).join("; "),
  );
  check(
    walls.score.passed >= 3,
    "capability score is a clear majority (>= 3 of 5)",
    `score=${walls.score.passed}/${walls.score.total}`,
  );
}

// -- 3. THE defect: the two must not be level --------------------------------
console.log("");
console.log(" separation");
{
  const gap = walls.score.passed - empty.score.passed;
  check(
    gap >= 3,
    "the two builds' capability scores differ by at least 3",
    `walls=${walls.score.passed}/${walls.score.total}  nothing=${empty.score.passed}/${empty.score.total}  gap=${gap}`,
  );
}

// -- 4. diagnostics are inert -------------------------------------------------
console.log("");
console.log(" diagnostics never move the score");
for (const { fx, outcome, score } of measured.values()) {
  // Re-score with every diagnostic forced to passed, and again forced to
  // failed. If diagnostics leaked into the headline, one of these would move.
  const forced = (status) =>
    scoreOf(outcome.checks.map((c) => (categoryOf(c) === "diagnostic" ? { ...c, status } : c)));
  const allPass = forced("passed");
  const allFail = forced("failed");
  check(
    allPass.passed === score.passed &&
      allFail.passed === score.passed &&
      allPass.total === score.total &&
      allFail.total === score.total,
    `${fx.key}: score unchanged whether diagnostics all pass or all fail`,
    `baseline=${score.passed}/${score.total} allPass=${allPass.passed}/${allPass.total} allFail=${allFail.passed}/${allFail.total}`,
  );
  const diagInCapability = capabilityChecks(outcome.checks).filter(
    (c) => CHECK_CATEGORY[c.name] === "diagnostic",
  );
  check(
    diagInCapability.length === 0,
    `${fx.key}: no diagnostic is counted as a capability`,
    diagInCapability.map((c) => c.name).join(", "),
  );
}

// ---------------------------------------------------------------------------
console.log("");
console.log(
  `SUMMARY  renders-walls ${walls.score.passed}/${walls.score.total} capability` +
    `  vs  renders-nothing ${empty.score.passed}/${empty.score.total} capability` +
    `  (gap ${walls.score.passed - empty.score.passed})`,
);
if (failures.length === 0) {
  console.log(`CHECK TAXONOMY PASS — ${assertions} assertions`);
  process.exit(0);
}
console.log(`CHECK TAXONOMY FAIL — ${failures.length}/${assertions} assertions failed:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
