/**
 * Objective scorers for verified-benchmark mode (Phase 5 native slice).
 * No engines, no browser — deterministic assertions over raw model output:
 *  - exact-match: normalized (trim/case/whitespace) string equality
 *  - contains:    normalized output contains the normalized expected answer
 *  - json-field:  parse the output as JSON (fences stripped first) and compare
 *                 the value at a dot-path against the expected string
 *
 * Score is binary: 10 (passed) or 0 (failed). Output that cannot be evaluated
 * at all (invalid JSON, missing task expectation) is a CONTRACT failure — the
 * caller records sample.failed(reason "contract"), never a zero score.
 */
import type { BrowserTestResult } from "@model-lab/schemas";
import type { Task, TaskScorer } from "../types";

/** Scorer-trace notes are truncated to this many characters. */
export const MAX_TRACE_NOTE_CHARS = 80;

export type ObjectiveOutcome =
  | { ok: true; passed: boolean; score: number; trace: BrowserTestResult }
  | { ok: false; violation: string; trace: BrowserTestResult };

/** Strip markdown code fences; returns the first fenced block, else the trim. */
export function stripAnswerFences(raw: string): string {
  const text = raw.trim();
  const fences = [...text.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)];
  if (fences.length === 0) return text;
  return (fences[0]?.[1] ?? text).trim();
}

/** Normalized comparison form: trimmed, lowercased, whitespace collapsed. */
export function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve a dot-path ("invoice.total") in parsed JSON; undefined = missing. */
export function valueAtPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of path.split(".")) {
    if (segment === "") return undefined;
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function clipNote(note: string): string {
  return note.length > MAX_TRACE_NOTE_CHARS
    ? `${note.slice(0, MAX_TRACE_NOTE_CHARS - 1)}…`
    : note;
}

function makeTrace(
  scorer: TaskScorer,
  passed: boolean,
  note: string,
  durationMs: number,
): BrowserTestResult {
  return {
    name: `objective.${scorer}`,
    status: passed ? "passed" : "failed",
    note: clipNote(note),
    durationMs,
    // verified mode scores the answer itself — the task IS the capability
    category: "capability",
  };
}

/** Render a JSON.parse product for the trace note ("412.5", "EUR", "null"). */
function jsonValueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Score one task's raw model output. `ok: false` means the output could not be
 * evaluated (contract failure); `ok: true` carries the binary 10/0 score plus
 * a one-entry scorer trace showing expected vs got.
 */
export function scoreObjective(task: Task, raw: string): ObjectiveOutcome {
  const started = Date.now();
  const answer = stripAnswerFences(raw);
  const elapsed = (): number => Date.now() - started;

  if (task.scorer === "json-field") {
    const field = task.jsonField;
    if (field === undefined) {
      return {
        ok: false,
        violation: "json-field task defines no jsonField expectation",
        trace: makeTrace(task.scorer, false, "task config missing jsonField", elapsed()),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer) as unknown;
    } catch {
      return {
        ok: false,
        violation: "model output is not valid JSON",
        trace: makeTrace(
          task.scorer,
          false,
          `expected JSON with ${field.path}="${field.expected}" · got unparseable output`,
          elapsed(),
        ),
      };
    }
    const got = valueAtPath(parsed, field.path);
    const gotText = got === undefined ? `missing field "${field.path}"` : jsonValueText(got);
    const passed =
      got !== undefined && normalizeAnswer(jsonValueText(got)) === normalizeAnswer(field.expected);
    return {
      ok: true,
      passed,
      score: passed ? 10 : 0,
      trace: makeTrace(
        task.scorer,
        passed,
        `expected "${field.expected}" · got "${gotText}"`,
        elapsed(),
      ),
    };
  }

  const expected = task.expected;
  if (expected === undefined || expected.trim() === "") {
    return {
      ok: false,
      violation: `${task.scorer} task defines no expected answer`,
      trace: makeTrace(task.scorer, false, "task config missing expected answer", elapsed()),
    };
  }
  const gotNorm = normalizeAnswer(answer);
  const expNorm = normalizeAnswer(expected);
  const passed = task.scorer === "contains" ? gotNorm.includes(expNorm) : gotNorm === expNorm;
  return {
    ok: true,
    passed,
    score: passed ? 10 : 0,
    trace: makeTrace(task.scorer, passed, `expected "${expected}" · got "${answer}"`, elapsed()),
  };
}
