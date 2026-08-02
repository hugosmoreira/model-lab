/**
 * Shared provider utilities: SSE parsing, secret scrubbing, token estimates.
 * SECURITY (audit §11 M-3): keys must never appear in logs or error messages —
 * every provider routes error text through scrubSecrets/errorMessage.
 */
import type { FinishReason } from "../types";

/** Redact anything that looks like a credential from arbitrary text. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    .replace(/((?:x-api-key|api[-_]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1***");
}

/** Stringify an unknown error with secrets scrubbed. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return scrubSecrets(raw).slice(0, 300);
}

/**
 * Normalize a provider's stop reason to our FinishReason union. Everything
 * that means "we hit the output cap" collapses to "length" — that distinction
 * is what separates a truncated answer from a bad one.
 */
export function normalizeFinishReason(raw: unknown): FinishReason | null {
  if (typeof raw !== "string" || raw === "") return null;
  const value = raw.toLowerCase();
  if (value === "length" || value === "max_tokens" || value === "model_length") return "length";
  if (value === "stop" || value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "content_filter" || value === "refusal") return "content_filter";
  return "other";
}

/** Rough token estimate (~4 chars/token) for providers that omit usage. */
export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Abortable delay. Rejects with "aborted" if the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/** Incremental server-sent-events parser over a fetch response body. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let eventName: string | null = null;
  let dataLines: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          if (dataLines.length > 0) {
            yield { event: eventName, data: dataLines.join("\n") };
          }
          eventName = null;
          dataLines = [];
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
        nl = buf.indexOf("\n");
      }
    }
    if (dataLines.length > 0) {
      yield { event: eventName, data: dataLines.join("\n") };
    }
  } finally {
    reader.releaseLock();
  }
}
