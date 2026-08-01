/**
 * OpenAI-compatible /chat/completions streaming adapter.
 * Covers OpenAI, OpenRouter, and any explicit base URL; Ollama subclasses it.
 */
import type { BaseKind, GenerateRequest, Provider, ProviderChunk } from "../types";
import { approxTokens, errorMessage, readSse, scrubSecrets } from "./util";

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string | null; // null => no Authorization header (local servers)
  headers?: Record<string, string>;
}

/**
 * Resolve base URL + key from env per provider id:
 *  - explicit baseUrl → key from `<PROVIDERID>_API_KEY` (may be absent)
 *  - "openrouter"     → https://openrouter.ai/api/v1 + OPENROUTER_API_KEY
 *  - anything else    → https://api.openai.com/v1 + OPENAI_API_KEY
 */
export function resolveOpenAiCompatible(
  providerId: string,
  explicitBaseUrl?: string,
): OpenAiCompatibleOptions {
  if (explicitBaseUrl !== undefined && explicitBaseUrl !== "") {
    const envKey = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
    return { baseUrl: explicitBaseUrl, apiKey: process.env[envKey] ?? null };
  }
  if (providerId === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env["OPENROUTER_API_KEY"] ?? null,
    };
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env["OPENAI_API_KEY"] ?? null,
  };
}

export class OpenAiCompatibleProvider implements Provider {
  readonly kind: BaseKind;
  private readonly opts: OpenAiCompatibleOptions;

  constructor(opts: OpenAiCompatibleOptions, kind: BaseKind = "openai-compatible") {
    this.opts = opts;
    this.kind = kind;
  }

  async *generate(req: GenerateRequest): AsyncGenerator<ProviderChunk, void, void> {
    const baseUrl = this.opts.baseUrl.replace(/\/+$/, "");
    if (
      (this.opts.apiKey === null || this.opts.apiKey === "") &&
      baseUrl.startsWith("https://")
    ) {
      throw new Error(`API key is not set for ${baseUrl} (set the provider *_API_KEY env var)`);
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (req.system !== undefined) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = {
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    };
    if (req.seed !== undefined) body["seed"] = req.seed;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.opts.headers ?? {}),
    };
    if (this.opts.apiKey !== null && this.opts.apiKey !== "") {
      headers["authorization"] = `Bearer ${this.opts.apiKey}`;
    }

    const post = async (): Promise<Response> => {
      try {
        return await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: req.signal ?? null,
        });
      } catch (err) {
        throw new Error(`${this.kind} transport error: ${errorMessage(err)}`);
      }
    };

    let res = await post();
    /**
     * Param-shape adaptation: newer OpenAI model families reject legacy
     * chat-completions params with explicit 400s. Adapt to what the server
     * tells us (works for any OpenAI-compatible backend) and retry, at most
     * once per distinct complaint:
     *  - "Use 'max_completion_tokens'" → swap max_tokens for it
     *  - unsupported temperature value  → drop temperature (server default)
     *  - unsupported seed               → drop seed
     */
    for (let adapt = 0; adapt < 3 && res.status === 400; adapt++) {
      const detail = await res.text().catch(() => "");
      if (detail.includes("max_completion_tokens") && "max_tokens" in body) {
        body["max_completion_tokens"] = body["max_tokens"];
        delete body["max_tokens"];
      } else if (/temperature/i.test(detail) && /unsupported|does not support/i.test(detail) && "temperature" in body) {
        delete body["temperature"];
      } else if (/seed/i.test(detail) && /unsupported|does not support/i.test(detail) && "seed" in body) {
        delete body["seed"];
      } else {
        throw new Error(scrubSecrets(`${this.kind} HTTP 400: ${detail.slice(0, 300)}`));
      }
      res = await post();
    }
    if (!res.ok || res.body === null) {
      const detail = res.body === null ? "empty body" : await res.text().catch(() => "");
      throw new Error(scrubSecrets(`${this.kind} HTTP ${res.status}: ${detail.slice(0, 300)}`));
    }

    let tokensIn = 0;
    let tokensOut = 0;
    let sawUsage = false;
    let textLength = 0;
    for await (const sse of readSse(res.body)) {
      if (sse.data === "[DONE]") break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(sse.data);
      } catch {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunk = parsed as any;
      if (chunk?.error !== undefined) {
        throw new Error(
          scrubSecrets(`${this.kind} stream error: ${JSON.stringify(chunk.error).slice(0, 300)}`),
        );
      }
      const delta: unknown = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        textLength += delta.length;
        yield { type: "delta", text: delta };
      }
      if (chunk?.usage !== undefined && chunk.usage !== null) {
        tokensIn = Number(chunk.usage.prompt_tokens ?? 0);
        tokensOut = Number(chunk.usage.completion_tokens ?? 0);
        sawUsage = true;
      }
    }
    if (!sawUsage) {
      tokensIn = approxTokens(req.prompt);
      tokensOut = textLength > 0 ? Math.ceil(textLength / 4) : 0;
    }
    yield { type: "usage", tokensIn, tokensOut };
  }
}
