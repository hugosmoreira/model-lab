/**
 * POST /api/runs — create AND START a run; GET /api/runs — list them.
 *
 * Phase 2: creation goes through the run orchestration service
 * (lib/server/run-service), which starts the native Build Arena runner,
 * registers the run in the Phase 1 in-memory registry (the live page's server
 * render reads it), and pipes the runner's event stream to the SSE ring
 * buffer + the persistence store. Keyless environments transparently run the
 * deterministic mock providers (see run-service for the substitution rules).
 *
 * GET merges the persistence store's runs (includes the seeded demo run) with
 * the in-process registry records, newest first, in the Phase 1 RunRecord
 * shape.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RunMode } from "@model-lab/schemas";
import {
  WORKLOAD_LIMITS,
  WorkloadLimitError,
  RunCapacityError,
} from "@model-lab/build-arena-runner";
import { getStore } from "@model-lab/store";
import { listRuns as listRegistryRuns, type RunRecord } from "@/lib/live/run-registry";
import { isReadOnly, readOnlyResponse } from "@/lib/server/read-only";
import { guardMutationRequest } from "@/lib/server/mutation-guard";
import { RunServiceError, startRun } from "@/lib/server/run-service";
import { reconcileInterruptedRuns } from "@/lib/server/run-recovery";

export const dynamic = "force-dynamic";

const CreateRunRequest = z.object({
  name: z.string().min(1).max(WORKLOAD_LIMITS.nameLength).optional(),
  mode: RunMode,
  packSlug: z.string().min(1),
  endpointIds: z.array(z.string().min(1)).min(1).max(WORKLOAD_LIMITS.endpoints),
  samplesPerModel: z.number().int().min(1).max(WORKLOAD_LIMITS.samplesPerModel),
  /** Estimated admission budget in USD; the workspace default when omitted. */
  maxBudgetUsd: z.number().positive().max(1000).optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export async function POST(req: NextRequest) {
  if (isReadOnly()) return readOnlyResponse();
  const rejected = guardMutationRequest(req);
  if (rejected !== null) return rejected;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = CreateRunRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid run configuration.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { runId } = await startRun({
      name: parsed.data.name ?? null,
      mode: parsed.data.mode,
      packSlug: parsed.data.packSlug,
      endpointIds: parsed.data.endpointIds,
      samplesPerModel: parsed.data.samplesPerModel,
      ...(parsed.data.maxBudgetUsd !== undefined ? { maxBudgetUsd: parsed.data.maxBudgetUsd } : {}),
    });
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err) {
    if (err instanceof RunCapacityError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": "5" } },
      );
    }
    if (err instanceof RunServiceError || err instanceof WorkloadLimitError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Run creation failed unexpectedly." }, { status: 500 });
  }
}

export async function GET() {
  /* Store runs (persisted, incl. the demo seed) mapped into RunRecord shape. */
  let storeRecords: RunRecord[] = [];
  try {
    const store = await getStore();
    await reconcileInterruptedRuns(store);
    const runs = await store.listRuns();
    storeRecords = await Promise.all(
      runs.map(async (run): Promise<RunRecord> => {
        const models = await store.listRunModels(run.id).catch(() => []);
        return {
          id: run.id,
          config: {
            name: run.name,
            mode: run.mode,
            packSlug: run.pack.slug,
            endpointIds: models.map((m) => m.endpointId),
            samplesPerModel: run.samplesPerModel,
          },
          createdAt: run.startedAt,
          status: run.status,
        };
      }),
    );
  } catch {
    return NextResponse.json({ error: "Run storage is temporarily unavailable." }, { status: 503 });
  }

  const byId = new Map<string, RunRecord>();
  for (const record of storeRecords) byId.set(record.id, record);
  /* In-process registry wins for runs this process started (freshest status). */
  for (const record of listRegistryRuns()) byId.set(record.id, record);

  const runs = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ runs });
}
