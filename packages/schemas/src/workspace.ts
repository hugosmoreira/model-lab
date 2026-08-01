import { z } from "zod";

export const WorkspaceSettings = z.object({
  defaultRunBudgetUsd: z.number(),
  defaultConcurrency: z.number(),
  dataRetention: z.string(),
  artifactDirectory: z.string(),
  localHardwareProfile: z.string().nullable(),
  telemetry: z.enum(["off", "on"]),
  artifactNetworkPolicy: z.enum(["blocked"]),
  defaultScoringPolicy: z.string(), // "browser → human → judge"
  exportBranding: z.string(),
  themeAccessibility: z.string(),
  repoUrl: z.string().nullable(),
  workspacePath: z.string().nullable(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** Aggregates that feed Mission Control + TopBar. Derived server-side later. */
export const WorkspaceStats = z.object({
  qualityLeader7d: z.object({
    endpointId: z.string(),
    score: z.number(),
    max: z.number(),
    dimension: z.string(),
    n: z.number(),
  }),
  cheapestPassingRun: z.object({
    endpointId: z.string(),
    costUsd: z.number(),
    tests: z.string(), // "9/12"
  }),
  reliability7d: z.object({ pct: z.number(), detail: z.string() }),
  spendThisWeek: z.object({ usd: z.number(), runs: z.number(), budgetUsd: z.number() }),
  sessionSpend: z.object({ usd: z.number(), budgetUsd: z.number() }),
  providersConnected: z.object({ connected: z.number(), total: z.number() }),
  localRunner: z.object({ engine: z.string(), gpu: z.string(), online: z.boolean() }),
});
export type WorkspaceStats = z.infer<typeof WorkspaceStats>;
