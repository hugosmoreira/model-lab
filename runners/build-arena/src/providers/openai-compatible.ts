/**
 * OpenAI-compatible /chat/completions streaming adapter.
 * Covers OpenAI, OpenRouter, and any explicit base URL; Ollama subclasses it.
 */
import type { BaseKind, FinishReason, GenerateRequest, Provider, ProviderChunk } from "../types";
import {
  approxTokens,
  errorMessage,
  normalizeFinishReason,
  readBoundedText,
  readSse,
  scrubSecrets,
} from "./util";
import { providerDeadline, ProviderSafetyError } from "./limits";

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string | null; // null => no Authorization header (local servers)
  headers?: Record<string, string>;
  limits?: { idleMs?: number; totalMs?: number };
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
    if ((this.opts.apiKey === null || this.opts.apiKey === "") && baseUrl.startsWith("https://")) {
      throw new Error(`API key is not set for ${baseUrl} (set the provider *_API_KEY env var)`);
    }

    const messages: Array<{ role: string; content: unknown }> = [];
    if (req.system !== undefined) messages.push({ role: "system", content: req.system });
    if ((req.images ?? []).length > 0) {
      // Multimodal shape: content becomes a parts array. A server that does not
      // support it answers 400, which surfaces as an error rather than a silent
      // text-only grade — the caller decides whether to retry without images.
      const parts: Array<Record<string, unknown>> = [];
      for (const image of req.images ?? []) {
        parts.push({ type: "text", text: image.label });
        parts.push({
          type: "image_url",
          image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
        });
      }
      parts.push({ type: "text", text: req.prompt });
      messages.push({ role: "user", content: parts });
    } else {
      messages.push({ role: "user", content: req.prompt });
    }

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

    const deadline = providerDeadline(req.signal, this.opts.limits);
    try {
      const post = async (): Promise<Response> => {
        try {
          const response = await deadline.wait(
            fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: deadline.signal,
            }),
          );
          deadline.touch();
          return response;
        } catch (err) {
          if (err instanceof ProviderSafetyError) throw err;
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
        const detail = await readBoundedText(res.body, { signal: deadline.signal });
        if (detail.includes("max_completion_tokens") && "max_tokens" in body) {
          body["max_completion_tokens"] = body["max_tokens"];
          delete body["max_tokens"];
        } else if (
          /temperature/i.test(detail) &&
          /unsupported|does not support/i.test(detail) &&
          "temperature" in body
        ) {
          delete body["temperature"];
        } else if (
          /seed/i.test(detail) &&
          /unsupported|does not support/i.test(detail) &&
          "seed" in body
        ) {
          delete body["seed"];
        } else {
          throw new Error(`${this.kind} HTTP 400: ${scrubSecrets(detail).slice(0, 300)}`);
        }
        req.beforeRetry?.();
        res = await post();
      }
      if (!res.ok || res.body === null) {
        const detail =
          res.body === null
            ? "empty body"
            : await readBoundedText(res.body, { signal: deadline.signal });
        throw new Error(`${this.kind} HTTP ${res.status}: ${scrubSecrets(detail).slice(0, 300)}`);
      }

      let tokensIn = 0;
      let tokensOut = 0;
      let sawUsage = false;
      let sawFinalUsage = false;
      let usageAfterFinish = false;
      let sawDone = false;
      let textLength = 0;
      let reasoningLength = 0;
      let reasoningTokens = 0;
      let finishReason: FinishReason | null = null;
      let servedModel: string | null = null;
      for await (const sse of readSse(res.body, { signal: deadline.signal })) {
        deadline.touch();
        if (sse.data === "[DONE]") {
          sawDone = true;
          break;
        }
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
            `${this.kind} stream error: ${scrubSecrets(JSON.stringify(chunk.error)).slice(0, 300)}`,
          );
        }
        // Every chunk names the model that produced it — a dated snapshot behind
        // an alias like "gpt-5-mini" — which is provenance the request cannot know.
        if (servedModel === null && typeof chunk?.model === "string" && chunk.model !== "") {
          servedModel = chunk.model as string;
        }
        const delta: unknown = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          sawFinalUsage = false;
          finishReason = null;
          textLength += delta.length;
          yield { type: "delta", text: delta };
        }
        /**
         * Reasoning deltas are NOT answer text — DeepSeek streams them as
         * `reasoning_content`, OpenRouter as `reasoning`. They are billed inside
         * completion_tokens and consume the same max_tokens budget, so a model
         * can spend the entire cap thinking and emit no answer at all. Measure
         * them so that case is diagnosable instead of looking like an empty reply.
         */
        const reasoningDelta: unknown =
          chunk?.choices?.[0]?.delta?.reasoning_content ?? chunk?.choices?.[0]?.delta?.reasoning;
        if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
          sawFinalUsage = false;
          finishReason = null;
          reasoningLength += reasoningDelta.length;
        }
        const rawFinish = normalizeFinishReason(chunk?.choices?.[0]?.finish_reason);
        if (rawFinish !== null) finishReason = rawFinish;
        if (chunk?.usage !== undefined && chunk.usage !== null) {
          tokensIn = Number(chunk.usage.prompt_tokens ?? 0);
          // Caveat: Google's OpenAI-compatible surface reports VISIBLE completion
          // tokens only and no reasoning breakdown, so tokensOut (and the cost
          // derived from it) under-counts thinking on Gemini. finishReason is the
          // reliable truncation signal there, not the token count.
          tokensOut = Number(chunk.usage.completion_tokens ?? 0);
          reasoningTokens = Number(chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0);
          sawUsage =
            typeof chunk.usage.prompt_tokens === "number" &&
            typeof chunk.usage.completion_tokens === "number" &&
            Number.isFinite(tokensIn) &&
            tokensIn >= 0 &&
            Number.isFinite(tokensOut) &&
            tokensOut >= 0;
          sawFinalUsage = sawUsage;
          usageAfterFinish = finishReason !== null;
          yield {
            type: "usage",
            tokensIn,
            tokensOut,
            reasoningTokens,
            usageSource: sawUsage ? "reported" : "estimated",
            usageComplete: false,
          };
        }
      }
      if (!sawDone && finishReason === null) {
        throw new ProviderSafetyError(`${this.kind} stream ended without a terminal marker`);
      }
      const completeUsage = sawFinalUsage && (sawDone || usageAfterFinish);
      if (!completeUsage) {
        tokensIn = Math.max(tokensIn, approxTokens(req.prompt));
        tokensOut = Math.max(tokensOut, Math.ceil((textLength + reasoningLength) / 4));
      }
      // Providers that stream reasoning but omit the usage breakdown (DeepSeek).
      if (reasoningTokens === 0 && reasoningLength > 0) {
        reasoningTokens = Math.min(tokensOut, Math.ceil(reasoningLength / 4));
      }
      yield {
        type: "usage",
        tokensIn,
        tokensOut,
        finishReason,
        reasoningTokens,
        servedModel,
        usageSource: completeUsage ? "reported" : "estimated",
        usageComplete: completeUsage,
      };
    } finally {
      deadline.dispose();
    }
  }
}
