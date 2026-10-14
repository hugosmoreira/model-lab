import type { EndpointConfig, GenerateRequest, Provider, ProviderChunk } from "../types";

export const MAX_GENERATION_BYTES = 2 * 1024 * 1024;
export const MAX_JUDGE_BYTES = 64 * 1024;
export const PROVIDER_LIMITS = {
  idleMs: 30_000,
  totalMs: 180_000,
  /**
   * Silence a local endpoint may keep before its first token: loading weights
   * and prefill run on the operator's hardware and can outlast idleMs.
   * MODEL_LAB_LOCAL_FIRST_TOKEN_MS overrides it; totalMs still bounds it.
   */
  localFirstTokenMs: 120_000,
  frameBytes: 256 * 1024,
  streamBytes: 16 * 1024 * 1024,
  errorBytes: 16 * 1024,
};

export interface ProviderLimits {
  /**
   * Longest silence before the first answer or reasoning token. When set, the
   * deadline starts in this window and leaves it at token(); when unset, the
   * idle window applies from the start (readers that cannot see tokens).
   */
  firstTokenMs?: number;
  /** Longest silence between activity. */
  idleMs?: number;
  /** Bound on the whole request, whatever its activity. */
  totalMs?: number;
}

export type ProviderDeadlines = Required<ProviderLimits>;

/**
 * The time limits a run applies to one endpoint. Only Ollama endpoints are
 * local, matching how the runner labels and prices them.
 */
export function providerDeadlinesFor(
  endpoint: Pick<EndpointConfig, "baseKind">,
  env: Record<string, string | undefined> = process.env,
): ProviderDeadlines {
  const { idleMs, totalMs } = PROVIDER_LIMITS;
  if (endpoint.baseKind !== "ollama") return { firstTokenMs: idleMs, idleMs, totalMs };
  const raw = (env["MODEL_LAB_LOCAL_FIRST_TOKEN_MS"] ?? "").trim();
  const override = /^\d+$/.test(raw) ? Number(raw) : 0;
  return {
    firstTokenMs: override > 0 ? Math.min(override, totalMs) : PROVIDER_LIMITS.localFirstTokenMs,
    idleMs,
    totalMs,
  };
}

/**
 * Silence a byte reader under these limits must tolerate. It cannot tell a
 * reasoning event from a role-only one, so it backstops with the widest
 * window and leaves the first-token phase to the adapter's own deadline.
 */
export function transportIdleMs(limits: ProviderLimits = {}): number {
  return Math.max(limits.firstTokenMs ?? 0, limits.idleMs ?? PROVIDER_LIMITS.idleMs);
}

export class ProviderSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSafetyError";
  }
}

/**
 * Owns the time limits, including time before headers and between chunks.
 * touch() records activity; token() records model output and ends the
 * first-token window, after which idleMs bounds every gap.
 */
export function providerDeadline(
  parent?: AbortSignal,
  limits: ProviderLimits = {},
): {
  signal: AbortSignal;
  touch: () => void;
  token: () => void;
  wait: <T>(work: Promise<T>) => Promise<T>;
  dispose: () => void;
} {
  const controller = new AbortController();
  const fail = (message: string): void => controller.abort(new ProviderSafetyError(message));
  const onParent = (): void => fail("provider request cancelled");
  const idleMs = limits.idleMs ?? PROVIDER_LIMITS.idleMs;
  let awaitingToken = limits.firstTokenMs !== undefined;
  let idle: ReturnType<typeof setTimeout>;
  const touch = (): void => {
    clearTimeout(idle);
    idle = awaitingToken
      ? setTimeout(() => fail("provider first-token deadline exceeded"), limits.firstTokenMs)
      : setTimeout(() => fail("provider idle deadline exceeded"), idleMs);
  };
  const token = (): void => {
    awaitingToken = false;
    touch();
  };
  const total = setTimeout(
    () => fail("provider total deadline exceeded"),
    limits.totalMs ?? PROVIDER_LIMITS.totalMs,
  );
  parent?.addEventListener("abort", onParent, { once: true });
  if (parent?.aborted) onParent();
  touch();
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) {
      void work.catch(() => undefined);
      throw controller.signal.reason;
    }
    let onAbort: () => void = () => undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
    }
  };
  return {
    signal: controller.signal,
    touch,
    token,
    wait,
    dispose: () => {
      clearTimeout(total);
      clearTimeout(idle);
      parent?.removeEventListener("abort", onParent);
      if (!controller.signal.aborted)
        controller.abort(new ProviderSafetyError("provider request closed"));
    },
  };
}

/** Enforces the output cap before callers append text or persist raw output. */
export async function* boundedGenerate(
  provider: Provider,
  request: GenerateRequest,
  maxBytes: number,
  limits: ProviderLimits = {},
): AsyncGenerator<ProviderChunk, void, void> {
  const deadline = providerDeadline(request.signal, limits);
  const iterator = provider.generate({ ...request, signal: deadline.signal });
  let bytes = 0;
  try {
    for (;;) {
      const next = await deadline.wait(iterator.next());
      if (next.done) break;
      const chunk = next.value;
      // Reasoning is model output too: a model thinking before it answers is live.
      if (chunk.type === "usage") deadline.touch();
      else deadline.token();
      if (chunk.type === "delta") {
        bytes += Buffer.byteLength(chunk.text, "utf8");
        if (bytes > maxBytes)
          throw new ProviderSafetyError(`provider output exceeds ${maxBytes} byte limit`);
      } else if (
        chunk.type === "usage" &&
        (!Number.isFinite(chunk.tokensIn) ||
          chunk.tokensIn < 0 ||
          !Number.isFinite(chunk.tokensOut) ||
          chunk.tokensOut < 0 ||
          (chunk.reasoningTokens !== undefined &&
            chunk.reasoningTokens !== null &&
            (!Number.isFinite(chunk.reasoningTokens) || chunk.reasoningTokens < 0)))
      ) {
        throw new ProviderSafetyError("provider reported invalid token usage");
      }
      yield chunk;
    }
  } finally {
    deadline.dispose();
    // A broken custom iterator must not hold cleanup open indefinitely.
    void iterator.return().catch(() => undefined);
  }
}
