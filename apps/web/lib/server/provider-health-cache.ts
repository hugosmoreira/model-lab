import type { ProviderHealth } from "@model-lab/build-arena-runner";

export const HEALTH_TTL_MS = 60_000;
export const HEALTH_REFRESH_MS = 10_000;

export interface HealthResponse {
  cached: boolean;
  checkedAt: string;
  retryAfterMs: number;
  providers: ProviderHealth[];
}

export class HealthUnavailableError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("Provider health is temporarily unavailable. Try again after the refresh interval.");
    this.retryAfterMs = retryAfterMs;
  }
}

interface Entry {
  attemptedAt: number;
  result?: { at: number; checkedAt: string; providers: ProviderHealth[] };
  pending?: Promise<void>;
  failed: boolean;
}

/** One cache per forced-mock state. Switching modes never joins another mode's
 * probe or resets the real mode's cooldown. Clocks are injectable for tests.
 */
export function createProviderHealthCache(
  probe: () => Promise<ProviderHealth[]>,
  now = () => performance.now(),
  wallTime = Date.now,
) {
  const entries = new Map<boolean, Entry>();
  return async (mocked: boolean, refresh: boolean): Promise<HealthResponse> => {
    let entry = entries.get(mocked);
    let cached = true;
    const age = entry?.result === undefined ? Infinity : now() - entry.result.at;
    if (
      entry === undefined ||
      (entry.pending === undefined &&
        (refresh || entry.failed || age >= HEALTH_TTL_MS) &&
        now() - entry.attemptedAt >= HEALTH_REFRESH_MS)
    ) {
      entry ??= { attemptedAt: -Infinity, failed: false };
      entries.set(mocked, entry);
      entry.attemptedAt = now();
      const current = entry;
      cached = false;
      // Install before dispatch, and invoke the probe synchronously so its
      // environment snapshot corresponds to the requesting mode.
      let finish!: () => void;
      current.pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      void (async () => {
        try {
          const providers = await probe();
          current.result = { at: now(), checkedAt: new Date(wallTime()).toISOString(), providers };
          current.failed = false;
        } catch {
          current.failed = true;
        } finally {
          delete current.pending;
          finish();
        }
      })();
    }
    await entry.pending;
    const retryAfterMs = Math.max(0, Math.ceil(HEALTH_REFRESH_MS - (now() - entry.attemptedAt)));
    // Do not label an older result as a successful fresh probe after a failure.
    if (entry.failed || entry.result === undefined) throw new HealthUnavailableError(retryAfterMs);
    return {
      cached,
      checkedAt: entry.result.checkedAt,
      retryAfterMs,
      providers: entry.result.providers,
    };
  };
}
