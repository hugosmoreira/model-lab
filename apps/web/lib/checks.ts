/**
 * Browser-check taxonomy for the web surfaces.
 *
 * CLIENT-SAFE: schemas types only. This is a deliberate MIRROR of the runner's
 * `CHECK_CATEGORY` map — the source of truth lives in
 * `runners/build-arena/src/checks/browser-checks.ts`, which is a Node-only
 * package (playwright, node:fs) that a client component cannot import. Keep the
 * two in step when a check is added or re-categorized.
 *
 * Three kinds, answering three different questions — never averaged together:
 *  - gate        correctness precondition. A failed gate means the artifact is
 *                broken: the headline score is 0 whatever else passed.
 *  - capability  did the model build what the brief asked for. THIS is the
 *                headline score.
 *  - diagnostic  measures the harness / rendering environment rather than the
 *                artifact (screenshot.captured says Playwright wrote a PNG;
 *                fps.stable says this machine's compositor kept up). Reported,
 *                never scored — counting them is how an artifact that drew
 *                nothing at all used to land level with a working build.
 */
import type { BrowserTestResult, CheckCategory } from "@model-lab/schemas";

export const CHECK_CATEGORY: Record<string, CheckCategory> = {
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

/** Display order — gates, then the scored capabilities, then diagnostics. */
export const CATEGORY_ORDER: readonly CheckCategory[] = ["gate", "capability", "diagnostic"];

export const CATEGORY_META: Record<
  CheckCategory,
  { heading: string; blurb: string; tag: string }
> = {
  gate: {
    heading: "Gates",
    blurb: "gates must pass for the build to count",
    tag: "gate",
  },
  capability: {
    heading: "Capability",
    blurb: "capability = what the brief asked for",
    tag: "cap",
  },
  diagnostic: {
    heading: "Diagnostics",
    blurb: "diagnostics measure the harness, not the build",
    tag: "diag",
  },
};

/** How many checks run per artifact (the full list). */
export const BROWSER_CHECK_COUNT = Object.keys(CHECK_CATEGORY).length;

/** The headline denominator: how many of them are capability checks. */
export const CAPABILITY_CHECK_COUNT = Object.values(CHECK_CATEGORY).filter(
  (c) => c === "capability",
).length;

/**
 * Category of a stored result. The NAME map wins over the stored field so
 * traces written before the taxonomy existed (every entry defaults to
 * "capability" on read) still classify correctly.
 */
export function categoryOf(check: Pick<BrowserTestResult, "name" | "category">): CheckCategory {
  return CHECK_CATEGORY[check.name] ?? check.category ?? "capability";
}

export function capabilityChecksOf(checks: readonly BrowserTestResult[]): BrowserTestResult[] {
  return checks.filter((c) => categoryOf(c) === "capability");
}

export function failedGatesOf(checks: readonly BrowserTestResult[]): BrowserTestResult[] {
  return checks.filter((c) => categoryOf(c) === "gate" && c.status === "failed");
}

/**
 * Gates with no verdict — the measurement broke, so nothing is known about the
 * artifact. MIRROR of the runner's `unmeasuredGates`. These never read as a
 * pass and never read as a zero: they make the tally no-signal (passed: null).
 */
export function unmeasuredGatesOf(checks: readonly BrowserTestResult[]): BrowserTestResult[] {
  return checks.filter((c) => categoryOf(c) === "gate" && c.status === "warn");
}

/** "canvas.renders — no vertical structure — gradient only (…)" */
export function checkLabel(check: BrowserTestResult): string {
  return check.note ? `${check.name} — ${check.note}` : check.name;
}

/** Checks grouped for display, in category order, original order within a group. */
export function groupByCategory(
  checks: readonly BrowserTestResult[],
): { category: CheckCategory; checks: BrowserTestResult[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    checks: checks.filter((c) => categoryOf(c) === category),
  })).filter((g) => g.checks.length > 0);
}

export interface CapabilityTally {
  /** passed capability checks; null = no capability signal at all (harness degraded) */
  passed: number | null;
  total: number;
  /** first failed gate, "canvas.renders" — set means the headline score is 0 */
  gateName: string | null;
  /** the same gate with its note, for prominent display */
  gateDetail: string | null;
}

/**
 * The headline reading of ONE artifact's trace, computed exactly the way the
 * runner scores it: capability passed / capability total, forced to 0 by any
 * failed gate. `passed: null` is reserved for "the checks never produced a
 * signal" (browser missing / watchdog / a gate that could not be measured) —
 * a gate FAILURE is 0, not unknown, because that is a verdict on the artifact.
 *
 * A gate in "warn" has no verdict at all: the frame could not be measured, so
 * the tally is no-signal. It is still named in gateName/gateDetail so the UI
 * shows WHY there is no number instead of rendering an unexplained blank.
 */
export function tallyCapability(checks: readonly BrowserTestResult[]): CapabilityTally {
  const capability = capabilityChecksOf(checks);
  const gate = failedGatesOf(checks)[0];
  const unmeasured = unmeasuredGatesOf(checks)[0];
  const skipped = capability.filter((c) => c.status === "skipped").length;
  const noSignal =
    capability.length === 0 ||
    unmeasured !== undefined ||
    (gate === undefined && skipped === capability.length);
  const named = gate ?? unmeasured;
  return {
    passed: noSignal
      ? null
      : gate !== undefined
        ? 0
        : capability.filter((c) => c.status === "passed").length,
    total: capability.length,
    gateName: named?.name ?? null,
    gateDetail: named ? checkLabel(named) : null,
  };
}

/**
 * One model's headline reading. Prefers the stored traces (they carry the
 * categories, so legacy 12-entry traces are re-read correctly) and falls back
 * to the RunModel rollup when a run has no artifacts to read.
 *
 * Best-of-model, matching the runner's per-model rollup: the highest capability
 * count wins, and a trace whose gates passed beats one whose gates failed.
 */
export function capabilityForModel(
  traces: ReadonlyArray<readonly BrowserTestResult[]>,
  fallback: { passed: number | null; total: number | null },
): CapabilityTally {
  const tallies = traces.map(tallyCapability).filter((t) => t.total > 0);
  const best = tallies.reduce<CapabilityTally | null>((acc, t) => {
    if (acc === null) return t;
    const gateRank = (x: CapabilityTally) => (x.gateName === null ? 1 : 0);
    if (gateRank(t) !== gateRank(acc)) return gateRank(t) > gateRank(acc) ? t : acc;
    return (t.passed ?? -1) > (acc.passed ?? -1) ? t : acc;
  }, null);
  if (best !== null) return best;
  return {
    passed: fallback.passed,
    total: fallback.total ?? CAPABILITY_CHECK_COUNT,
    gateName: null,
    gateDetail: null,
  };
}
