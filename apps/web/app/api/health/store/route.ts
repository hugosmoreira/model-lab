import { getStore } from "@model-lab/store";
import { scrubSecrets } from "@model-lab/build-arena-runner";
import { isReadOnly } from "@/lib/server/read-only";

export const dynamic = "force-dynamic";

/**
 * Store connectivity probe: GET /api/health/store
 * Reports which backend is active and whether it answers. Never includes
 * secrets — error messages are reduced to their first line and scrubbed of
 * anything resembling a key.
 */
function scrub(message: string): string {
  return scrubSecrets(message).split("\n")[0]!.slice(0, 200);
}

export async function GET() {
  const backend = (process.env.MODEL_LAB_STORE ?? "memory").toLowerCase().trim();
  try {
    const store = await getStore();
    const runs = await store.listRuns();
    return Response.json({
      ok: true,
      backend,
      readOnly: isReadOnly(),
      runsVisible: runs.length,
      supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
      serviceKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        backend,
        error: scrub(err instanceof Error ? err.message : String(err)),
        supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
        serviceKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      { status: 503 },
    );
  }
}
