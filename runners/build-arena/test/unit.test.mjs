/**
 * Unit tests for the pure rules the README makes claims about — no browser,
 * no network, no provider. Runs under node:test with Node's built-in
 * type-stripping and the test/ts-resolve.mjs hook.
 *
 * Run with:  pnpm --filter @model-lab/build-arena-runner test:unit
 */
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

register("./ts-resolve.mjs", import.meta.url);

const { normalizeFinishReason } = await import("../src/providers/util.ts");
const { BROWSER_CHECK_NAMES, CHECK_CATEGORY, categoryOf, capabilityChecks, failedGates } =
  await import("../src/checks/browser-checks.ts");

// ---------------------------------------------------------------------------
// Truncation is a harness limit, not a model result: every provider's way of
// saying "hit the output cap" must collapse to "length".
// ---------------------------------------------------------------------------
test("finish reason: every output-cap spelling normalizes to length", () => {
  for (const raw of ["length", "max_tokens", "model_length", "LENGTH", "Max_Tokens"]) {
    assert.equal(normalizeFinishReason(raw), "length", raw);
  }
});

test("finish reason: natural stops normalize to stop", () => {
  for (const raw of ["stop", "end_turn", "stop_sequence", "STOP"]) {
    assert.equal(normalizeFinishReason(raw), "stop", raw);
  }
});

test("finish reason: refusals and filters are content_filter, unknowns are other", () => {
  assert.equal(normalizeFinishReason("content_filter"), "content_filter");
  assert.equal(normalizeFinishReason("refusal"), "content_filter");
  assert.equal(normalizeFinishReason("tool_calls"), "other");
  assert.equal(normalizeFinishReason("function_call"), "other");
});

test("finish reason: missing or non-string values are null, never a verdict", () => {
  assert.equal(normalizeFinishReason(undefined), null);
  assert.equal(normalizeFinishReason(null), null);
  assert.equal(normalizeFinishReason(""), null);
  assert.equal(normalizeFinishReason(42), null);
});

// ---------------------------------------------------------------------------
// Check taxonomy: gate / capability / diagnostic, and how they score.
// ---------------------------------------------------------------------------
const GATES = ["html.parses", "page.loads", "console.clean", "canvas.renders"];
const CAPABILITIES = [
  "interaction.wasd",
  "interaction.mouse",
  "minimap.present",
  "textures.applied",
  "resize.handled",
];
const DIAGNOSTICS = ["screenshot.captured", "fps.stable", "a11y.contrast"];

function result(name, status, category = CHECK_CATEGORY[name]) {
  return { name, status, category, note: "", durationMs: 0 };
}

/** The headline score exactly as run.ts derives it. */
function headline(checks) {
  const capability = capabilityChecks(checks);
  const gatesOk = failedGates(checks).length === 0;
  return {
    passed: gatesOk ? capability.filter((c) => c.status === "passed").length : 0,
    total: capability.length,
  };
}

test("taxonomy: the twelve checks split 4 gates / 5 capabilities / 3 diagnostics", () => {
  assert.equal(BROWSER_CHECK_NAMES.length, 12);
  for (const name of BROWSER_CHECK_NAMES) {
    assert.ok(CHECK_CATEGORY[name], `${name} carries a category`);
  }
  assert.deepEqual(
    BROWSER_CHECK_NAMES.filter((n) => CHECK_CATEGORY[n] === "gate"),
    GATES,
  );
  assert.deepEqual(
    BROWSER_CHECK_NAMES.filter((n) => CHECK_CATEGORY[n] === "capability"),
    CAPABILITIES,
  );
  assert.deepEqual(
    BROWSER_CHECK_NAMES.filter((n) => CHECK_CATEGORY[n] === "diagnostic"),
    DIAGNOSTICS,
  );
});

test("taxonomy: a stored trace with a stale category is re-classified by name", () => {
  // Traces recorded before categories existed parse with the schema default
  // ("capability"); the name table must win so old runs re-score correctly.
  assert.equal(categoryOf({ name: "fps.stable", category: "capability" }), "diagnostic");
  assert.equal(categoryOf({ name: "canvas.renders", category: "capability" }), "gate");
  // An unknown name keeps whatever category it was stored with.
  assert.equal(categoryOf({ name: "custom.check", category: "diagnostic" }), "diagnostic");
});

test("scoring: all gates and capabilities passing is 5/5", () => {
  const checks = BROWSER_CHECK_NAMES.map((n) => result(n, "passed"));
  assert.deepEqual(headline(checks), { passed: 5, total: 5 });
});

test("scoring: one failed gate zeroes the headline whatever the capabilities say", () => {
  const checks = BROWSER_CHECK_NAMES.map((n) =>
    result(n, n === "canvas.renders" ? "failed" : "passed"),
  );
  assert.deepEqual(headline(checks), { passed: 0, total: 5 });
  assert.deepEqual(
    failedGates(checks).map((c) => c.name),
    ["canvas.renders"],
  );
});

test("scoring: a warn gate does not zero the score (no-signal is decided upstream)", () => {
  // A gate that could not be measured is "warn", not "failed": failedGates
  // must not treat it as a broken artifact — run.ts turns it into score null.
  const checks = BROWSER_CHECK_NAMES.map((n) =>
    result(n, n === "canvas.renders" ? "warn" : "passed"),
  );
  assert.equal(failedGates(checks).length, 0);
  assert.deepEqual(headline(checks), { passed: 5, total: 5 });
});

test("scoring: diagnostics never move the headline in either direction", () => {
  const base = BROWSER_CHECK_NAMES.map((n) =>
    result(n, n === "minimap.present" ? "failed" : "passed"),
  );
  const flip = (status) =>
    base.map((c) => (CHECK_CATEGORY[c.name] === "diagnostic" ? { ...c, status } : c));
  assert.deepEqual(headline(base), { passed: 4, total: 5 });
  assert.deepEqual(headline(flip("failed")), { passed: 4, total: 5 });
  assert.deepEqual(headline(flip("skipped")), { passed: 4, total: 5 });
});

test("scoring: a warn capability counts as not passed, never as half a point", () => {
  const checks = BROWSER_CHECK_NAMES.map((n) =>
    result(n, n === "interaction.wasd" ? "warn" : "passed"),
  );
  assert.deepEqual(headline(checks), { passed: 4, total: 5 });
});
