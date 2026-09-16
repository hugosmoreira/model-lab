/**
 * Budget ceiling — the README's "a hard budget ceiling stops runaway spend".
 *
 * A mock 2-endpoint × 3-sample run with a ceiling smaller than one sample's
 * cost must stop after the first scored sample: a `budget.status` hard-stop
 * event, a `run.partial` terminal event, an outcome of "partial", and the
 * samples that did complete preserved — never billed on, never discarded.
 *
 * Mock providers only: no network, no keys, no spend. Chromium runs the
 * browser checks on the one sample that completes.
 *
 * Run with:  pnpm --filter @model-lab/build-arena-runner test:budget
 */
import { register } from "node:module";
import assert from "node:assert/strict";

register("./ts-resolve.mjs", import.meta.url);

const { BuildArenaAdapter } = await import("../src/adapter.ts");
const { BROWSER_NOT_INSTALLED_NOTE } = await import("../src/checks/browser-checks.ts");

const adapter = new BuildArenaAdapter();
const runId = `run_bg${Date.now().toString(16).slice(-6)}`;
const priced = {
  baseKind: "mock",
  priceInPerMtokUsd: 3,
  priceOutPerMtokUsd: 15,
  supportsSeed: true,
};
const cfg = {
  runId,
  name: "Budget ceiling test — mock 2×3, ceiling below one sample",
  mode: "build-arena",
  pack: {
    slug: "raycaster-oneshot",
    version: "v1.3",
    prompt:
      "Build a playable raycaster in ONE self-contained HTML file. Textured walls, WASD movement, " +
      "a minimap, and no external network dependencies. Return only the HTML document.",
    browserCheckCount: 12,
  },
  endpoints: [
    { id: "mock/alpha", providerId: "mock", modelId: "mock-alpha", model: "mock-alpha", ...priced },
    { id: "mock/beta", providerId: "mock", modelId: "mock-beta", model: "mock-beta", ...priced },
  ],
  samplesPerModel: 3,
  temperature: 0.7,
  maxOutputTokens: 8_000,
  seed: 42,
  concurrency: 1,
  // A mock sample costs about a cent at these prices; half a cent cannot
  // cover a second one, so the projection trips the ceiling immediately.
  maxBudgetUsd: 0.005,
  transportRetries: 0,
};

const totalPlanned = cfg.endpoints.length * cfg.samplesPerModel;
const handle = adapter.startRun(cfg);
const events = [];
for await (const event of handle.events) events.push(event);
const outcome = await handle.done;

const degraded = events.some((e) => e.message.includes(BROWSER_NOT_INSTALLED_NOTE));
if (degraded) {
  console.error(`CANNOT VALIDATE — ${BROWSER_NOT_INSTALLED_NOTE}`);
  process.exit(1);
}

const types = events.map((e) => e.type);
const hardStop = events.find(
  (e) => e.type === "budget.status" && e.level === "warn" && /hard stop/.test(e.message),
);
const partial = events.find((e) => e.type === "run.partial");

console.log("");
console.log("BUDGET CEILING");
console.log(
  `  outcome: ${outcome.status} · scored=${outcome.samplesScored} failed=${outcome.samplesFailed} · $${outcome.spentUsd.toFixed(4)} of $${cfg.maxBudgetUsd}`,
);
console.log(`  hard stop: ${hardStop ? hardStop.message : "none"}`);
console.log(
  `  terminal : ${partial ? partial.message : types.filter((t) => t.startsWith("run.")).join(",")}`,
);

assert.equal(outcome.status, "partial", "the run ends as partial, not completed");
assert.ok(hardStop, "a budget.status hard-stop event is emitted");
assert.ok(partial, "run.partial is the terminal event");
assert.ok(!types.includes("run.completed"), "run.completed is never emitted after a budget stop");
assert.ok(outcome.samplesScored >= 1, "the sample that finished before the stop is preserved");
assert.ok(
  outcome.samplesScored + outcome.samplesFailed < totalPlanned,
  `fewer than the ${totalPlanned} planned samples ran`,
);
assert.ok(outcome.spentUsd > 0, "spend is reported, not zeroed");
assert.ok(
  hardStop.payload && hardStop.payload.ceilingUsd === cfg.maxBudgetUsd,
  "the stop event names the ceiling",
);
console.log("BUDGET CEILING PASS");
