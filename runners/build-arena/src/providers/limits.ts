import type { GenerateRequest, Provider, ProviderChunk } from "../types";

export const MAX_GENERATION_BYTES = 2 * 1024 * 1024;
export const MAX_JUDGE_BYTES = 64 * 1024;
export const PROVIDER_LIMITS = {
  /** Silence allowed between chunks once answer text has started. */
  idleMs: 30_000,
  /**
   * Silence allowed before the first answer text. Reasoning models think for
   * minutes before they write, and a local model can spend most of a minute on
   * its first token; both are slow, not stalled.
   */
  firstOutputMs: 600_000,
  totalMs: 1_200_000,
  frameBytes: 256 * 1024,
  streamBytes: 16 * 1024 * 1024,
  errorBytes: 16 * 1024,
};

export interface DeadlineLimits {
  idleMs?: number;
  /** Defaults to `idleMs` when that is given explicitly, else `PROVIDER_LIMITS.firstOutputMs`. */
  firstOutputMs?: number;
  totalMs?: number;
}

export class ProviderSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSafetyError";
  }
}

/**
 * Owns both time limits, including time before headers and between chunks.
 * `touch` records activity; `output` records answer text, after which the
 * shorter idle window applies.
 */
export function providerDeadline(
  parent?: AbortSignal,
  limits: DeadlineLimits = {},
): {
  signal: AbortSignal;
  touch: () => void;
  output: () => void;
  wait: <T>(work: Promise<T>) => Promise<T>;
  dispose: () => void;
} {
  const controller = new AbortController();
  const fail = (message: string): void => controller.abort(new ProviderSafetyError(message));
  const onParent = (): void => fail("provider request cancelled");
  const idleMs = limits.idleMs ?? PROVIDER_LIMITS.idleMs;
  const firstOutputMs = Math.max(
    idleMs,
    limits.firstOutputMs ?? (limits.idleMs !== undefined ? idleMs : PROVIDER_LIMITS.firstOutputMs),
  );
  let producing = false;
  let idle: ReturnType<typeof setTimeout>;
  const touch = (): void => {
    clearTimeout(idle);
    idle = setTimeout(
      () => fail("provider idle deadline exceeded"),
      producing ? idleMs : firstOutputMs,
    );
  };
  const output = (): void => {
    producing = true;
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
    output,
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
  limits: DeadlineLimits = {},
): AsyncGenerator<ProviderChunk, void, void> {
  const deadline = providerDeadline(request.signal, limits);
  const iterator = provider.generate({ ...request, signal: deadline.signal });
  let bytes = 0;
  try {
    for (;;) {
      const next = await deadline.wait(iterator.next());
      if (next.done) break;
      const chunk = next.value;
      // Reasoning keeps the request alive but is not answer text, so it renews
      // the first-output window instead of ending it.
      if (chunk.type === "delta") deadline.output();
      else deadline.touch();
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
