import { z } from "zod";

/**
 * Live-run event contract (audit §13.3): research §15 ∪ prototype vocabulary.
 * A failed SAMPLE emits sample.failed — never model.failed.
 */
export const RunEventType = z.enum([
  "run.created",
  "run.started",
  "run.partial",
  "run.completed",
  "run.cancelled",
  "model.queued",
  "model.started",
  "model.rate_limited",
  "model.failed",
  "model.completed",
  "sample.started",
  "sample.failed",
  "sample.scored",
  "artifact.created",
  "check.passed",
  "check.failed",
  "check.warn",
  "browser.checks",
  "judge.vote",
  "token.usage",
  "budget.status",
  "sandbox.loaded",
  "export.created",
]);
export type RunEventType = z.infer<typeof RunEventType>;

export const RunEventLevel = z.enum(["info", "success", "warn", "error"]);
export type RunEventLevel = z.infer<typeof RunEventLevel>;

export const RunEvent = z.object({
  t: z.string(), // ISO timestamp
  type: RunEventType,
  runId: z.string(),
  endpointId: z.string().nullable().default(null),
  sampleIndex: z.number().nullable().default(null),
  level: RunEventLevel.default("info"),
  message: z.string(), // human-readable detail line
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type RunEvent = z.infer<typeof RunEvent>;
