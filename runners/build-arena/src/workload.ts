import type { RunnerConfig, ValidationIssue } from "./types";

/** Local resource policy, independent of each run's monetary budget. */
export const WORKLOAD_LIMITS = {
  endpoints: 8,
  samplesPerModel: 10,
  totalSamples: 80,
  concurrency: 4,
  transportRetries: 3,
  nameLength: 200,
  activeRuns: 2,
} as const;

export class WorkloadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkloadLimitError";
  }
}

interface Selection {
  name: string | null;
  endpointIds: string[];
  samplesPerModel: number;
  maxBudgetUsd?: number;
}

function integerWithin(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function selectionIssues(input: Selection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    input.name !== null &&
    (input.name.trim().length === 0 || input.name.length > WORKLOAD_LIMITS.nameLength)
  )
    issues.push({
      field: "name",
      message: `must contain 1–${WORKLOAD_LIMITS.nameLength} characters`,
    });
  if (!integerWithin(input.endpointIds.length, 1, WORKLOAD_LIMITS.endpoints))
    issues.push({ field: "endpoints", message: `select 1–${WORKLOAD_LIMITS.endpoints} endpoints` });
  if (new Set(input.endpointIds).size !== input.endpointIds.length)
    issues.push({ field: "endpoints", message: "duplicate endpoint IDs are not allowed" });
  if (!integerWithin(input.samplesPerModel, 1, WORKLOAD_LIMITS.samplesPerModel))
    issues.push({
      field: "samplesPerModel",
      message: `must be an integer from 1 to ${WORKLOAD_LIMITS.samplesPerModel}`,
    });
  if (
    input.maxBudgetUsd !== undefined &&
    (!Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0)
  )
    issues.push({ field: "maxBudgetUsd", message: "must be finite and greater than zero" });
  return issues;
}

function rejectIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0)
    throw new WorkloadLimitError(
      issues.map(({ field, message }) => `${field}: ${message}`).join("; "),
    );
}

/** Before endpoint lookup or verified-mode normalization in web and CLI. */
export function validateRunSelection(input: Selection): void {
  rejectIssues(selectionIssues(input));
}

export function workloadIssues(cfg: RunnerConfig): ValidationIssue[] {
  const issues = selectionIssues({ ...cfg, endpointIds: cfg.endpoints.map((ep) => ep.id) });
  for (const [field, min, max] of [
    ["concurrency", 1, WORKLOAD_LIMITS.concurrency],
    ["transportRetries", 0, WORKLOAD_LIMITS.transportRetries],
  ] as const) {
    if (!integerWithin(cfg[field], min, max))
      issues.push({ field, message: `must be an integer from ${min} to ${max}` });
  }
  const samples = cfg.mode === "verified" ? (cfg.pack.tasks?.length ?? 0) : cfg.samplesPerModel;
  if (!integerWithin(samples * cfg.endpoints.length, 1, WORKLOAD_LIMITS.totalSamples))
    issues.push({
      field: "pack",
      message: `run must generate 1–${WORKLOAD_LIMITS.totalSamples} samples in total (verified tasks count as samples)`,
    });
  return issues;
}

export function validateWorkload(cfg: RunnerConfig): void {
  rejectIssues(workloadIssues(cfg));
}
