/**
 * GET /api/providers/health — one read-only probe per registry provider.
 *
 * Each probe lists the provider's models with the key from this server's
 * environment: it proves reachability and that the key is accepted, and it
 * does not generate tokens. Results are cached for a minute; `?refresh=1`
 * requests new probes at most once per ten seconds. Only whether a key is set,
 * the host that was probed, latency, a model count and a scrubbed error.
 */
import { NextRequest, NextResponse } from "next/server";
import { providers } from "@model-lab/schemas/fixtures";
import { checkProvidersHealth } from "@model-lab/build-arena-runner";
import {
  createProviderHealthCache,
  HealthUnavailableError,
} from "@/lib/server/provider-health-cache";

export const dynamic = "force-dynamic";

const CACHE_KEY = Symbol.for("model-lab.provider-health.bounded");

export async function GET(req: NextRequest) {
  const g = globalThis as { [CACHE_KEY]?: ReturnType<typeof createProviderHealthCache> };
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const mocked = (process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim() === "1";
  const readHealth = (g[CACHE_KEY] ??= createProviderHealthCache(() =>
    checkProvidersHealth(
      providers.map((p) => p.id),
      { timeoutMs: 4000 },
    ),
  ));
  try {
    return NextResponse.json(await readHealth(mocked, refresh));
  } catch (error) {
    if (!(error instanceof HealthUnavailableError)) throw error;
    return NextResponse.json(
      { error: error.message, retryAfterMs: error.retryAfterMs },
      {
        status: 503,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))) },
      },
    );
  }
}
