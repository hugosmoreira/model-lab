/**
 * In-memory run registry — Phase 1 seam.
 *
 * Module-scope Map, stashed on globalThis so next-dev module reloads don't
 * drop registered runs between the POST /api/runs handler and the live page's
 * server render. The Phase 2 integrator replaces these internals with the
 * real store (@model-lab/store); the exported surface stays:
 * registerRun / getRun / listRuns over RunRecord.
 */
import type { RunMode, RunStatus } from "@model-lab/schemas";

export type RunRecordConfig = {
  name: string | null;
  mode: RunMode;
  packSlug: string;
  endpointIds: string[];
  samplesPerModel: number;
};

export type RunRecord = {
  id: string; // "run_" + 8 hex chars
  config: RunRecordConfig;
  createdAt: string; // ISO
  status: RunStatus;
};

const globalStash = globalThis as typeof globalThis & {
  __modelLabRunRegistry?: Map<string, RunRecord>;
};

const registry: Map<string, RunRecord> =
  (globalStash.__modelLabRunRegistry ??= new Map<string, RunRecord>());

export function registerRun(record: RunRecord): RunRecord {
  registry.set(record.id, record);
  return record;
}

export function getRun(id: string): RunRecord | undefined {
  return registry.get(id);
}

/** Newest first. */
export function listRuns(): RunRecord[] {
  return [...registry.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
