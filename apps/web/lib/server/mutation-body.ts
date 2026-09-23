/** Small mutation payloads only. Guards must run before this reader. */
export const MUTATION_BODY_LIMITS = { bytes: 65_536, timeoutMs: 10_000 } as const;
type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

class BodyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bound actual bytes and total time, including missing/dishonest length headers. */
export async function readMutationJson(
  request: Pick<Request, "headers" | "body" | "signal">,
  timeoutMs: number = MUTATION_BODY_LIMITS.timeoutMs,
): Promise<BodyResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const encoding = request.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
      throw new BodyError(415, "Compressed request bodies are not supported.");
    }
    const length = request.headers.get("content-length");
    let declared: number | null = null;
    if (length !== null) {
      if (!/^\d+$/.test(length)) throw new BodyError(400, "Invalid Content-Length.");
      declared = Number(length);
      if (declared > MUTATION_BODY_LIMITS.bytes)
        throw new BodyError(413, "Request body exceeds 64 KiB.");
    }
    if (request.signal.aborted) throw new BodyError(400, "Request was aborted.");
    if (request.body === null) throw new BodyError(400, "Request body must be JSON.");
    reader = request.body.getReader();
    const deadline = performance.now() + timeoutMs;
    const interrupted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BodyError(408, "Request body timed out.")), timeoutMs);
      abort = () => reject(new BodyError(400, "Request was aborted."));
      request.signal.addEventListener("abort", abort, { once: true });
    });
    const bytes = new Uint8Array(MUTATION_BODY_LIMITS.bytes);
    let size = 0;
    const source = reader;
    const consume = async (): Promise<void> => {
      while (true) {
        // Also covers streams producing synchronous empty chunks indefinitely.
        if (performance.now() >= deadline) throw new BodyError(408, "Request body timed out.");
        const part = await source.read();
        if (part.done) break;
        if (part.value.byteLength > bytes.length - size)
          throw new BodyError(413, "Request body exceeds 64 KiB.");
        bytes.set(part.value, size);
        size += part.value.byteLength;
      }
    };
    // Race once for the complete read, so tiny/empty chunks do not accumulate
    // one reaction per chunk on the pending interruption promise.
    await Promise.race([consume(), interrupted]);
    if (declared !== null && declared !== size)
      throw new BodyError(400, "Content-Length does not match the request body.");
    // Match Request.json(): UTF-8 decoding strips BOM and replaces bad bytes.
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))) as unknown,
    };
  } catch (error) {
    // A hostile/failed underlying source can leave cancel() pending. Cancellation
    // is best effort and must never delay this bounded reader's response.
    if (reader) void reader.cancel().catch(() => {});
    else if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    const failure =
      error instanceof BodyError ? error : new BodyError(400, "Request body must be JSON.");
    return {
      ok: false,
      response: Response.json({ error: failure.message }, { status: failure.status }),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    reader?.releaseLock();
  }
}
