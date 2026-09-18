/**
 * GET /api/providers/health — one read-only probe per registry provider.
 *
 * Each probe lists the provider's models with the key from this server's
 * environment: it proves reachability and that the key is accepted, and it
 * costs nothing. Results are cached for a minute; `?refresh=1` forces new
 * probes. Nothing in the response is a secret — only whether a key is set,
 * the host that was probed, latency, a model count and a scrubbed error.
 */
import { NextRequest, NextResponse } from "next/server";
import { providers } from "@model-lab/schemas/fixtures";
import { checkProvidersHealth, type ProviderHealth } from "@model-lab/build-arena-runner";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const CACHE_KEY = Symbol.for("model-lab.provider-health");
interface Cache {
  at: number;
  mockFlag: string;
  providers: ProviderHealth[];
}

export async function GET(req: NextRequest) {
  const g = globalThis as { [CACHE_KEY]?: Cache };
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const mockFlag = (process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim();
  const cached = g[CACHE_KEY];
  if (
    !refresh &&
    cached !== undefined &&
    cached.mockFlag === mockFlag &&
    Date.now() - cached.at < TTL_MS
  ) {
    return NextResponse.json({
      cached: true,
      checkedAt: new Date(cached.at).toISOString(),
      providers: cached.providers,
    });
  }
  const result = await checkProvidersHealth(
    providers.map((p) => p.id),
    { timeoutMs: 4000 },
  );
  g[CACHE_KEY] = { at: Date.now(), mockFlag, providers: result };
  return NextResponse.json({
    cached: false,
    checkedAt: new Date().toISOString(),
    providers: result,
  });
}
