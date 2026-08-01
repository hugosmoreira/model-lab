/**
 * Canonical demo seed bundle: the COMPLETED timeline of run_8f3ac21e, pulled
 * straight from `@model-lab/schemas/fixtures`, so Results / Samples /
 * Artifacts screens read real store data in Phase 3.
 *
 * The event log is the full history of the completed run: the live-phase
 * events followed by the completion tail, in replay order (ids are assigned
 * in insertion order; `listEvents` orders by id, not timestamp).
 */
import {
  artifacts,
  benchmarkPacks,
  completionEvents,
  endpoints,
  liveEvents,
  modelDefinitions,
  pairwiseSession,
  providers,
  runCompleted,
  runConfiguration,
  runModelsCompleted,
  samples,
} from "@model-lab/schemas/fixtures";
import type { SeedFixtures } from "./types";

/** Builds a fresh (deep-copied) demo seed bundle. */
export function demoFixtures(): SeedFixtures {
  return structuredClone({
    providers,
    modelDefinitions,
    endpoints,
    packs: benchmarkPacks,
    run: runCompleted,
    configuration: runConfiguration,
    runModels: runModelsCompleted,
    samples,
    artifacts,
    events: [...liveEvents, ...completionEvents],
    votes: pairwiseSession.votes,
  });
}
