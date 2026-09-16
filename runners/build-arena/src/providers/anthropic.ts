/**
 * Anthropic Messages API adapter (raw fetch + SSE, no SDK dependency).
 * Key from env ANTHROPIC_API_KEY; never logged (scrubbed error paths only).
 */
import type { FinishReason, GenerateRequest, Provider, ProviderChunk } from "../types";
import { errorMessage, normalizeFinishReason, readSse, scrubSecrets } from "./util";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements Provider {
  readonly kind = "anthropic" as const;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? null;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async *generate(req: GenerateRequest): AsyncGenerator<ProviderChunk, void, void> {
    if (this.apiKey === null || this.apiKey === "") {
      throw new Error("ANTHROPIC_API_KEY is not set (anthropic provider)");
    }
    /**
     * Images first, then the text — the order Anthropic recommends, and the
     * order that makes a labeled capture read as context for the question
     * rather than an afterthought.
     */
    const content: Array<Record<string, unknown>> = [];
    for (const image of req.images ?? []) {
      content.push({ type: "text", text: image.label });
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.dataBase64 },
      });
    }
    content.push({ type: "text", text: req.prompt });

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      messages: [{ role: "user", content }],
    };
    if (req.system !== undefined) body["system"] = req.system;
    // The Messages API has no seed parameter; endpoints must set supportsSeed=false.

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: req.signal ?? null,
      });
    } catch (err) {
      throw new Error(`anthropic transport error: ${errorMessage(err)}`);
    }
    if (!res.ok || res.body === null) {
      const detail = res.body === null ? "empty body" : await res.text().catch(() => "");
      throw new Error(scrubSecrets(`anthropic HTTP ${res.status}: ${detail.slice(0, 300)}`));
    }

    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason: FinishReason | null = null;
    let servedModel: string | null = null;
    for await (const sse of readSse(res.body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(sse.data);
      } catch {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = parsed as any;
      const type: string | undefined = msg?.type;
      if (type === "message_start") {
        tokensIn = Number(msg?.message?.usage?.input_tokens ?? 0);
        // The message names the model that is answering — the resolved id
        // behind an alias — which is provenance the request cannot know.
        if (typeof msg?.message?.model === "string" && msg.message.model !== "") {
          servedModel = msg.message.model as string;
        }
      } else if (type === "content_block_delta") {
        if (msg?.delta?.type === "text_delta" && typeof msg?.delta?.text === "string") {
          yield { type: "delta", text: msg.delta.text as string };
        }
      } else if (type === "message_delta") {
        tokensOut = Number(msg?.usage?.output_tokens ?? tokensOut);
        // stop_reason "max_tokens" → our "length": the cap cut the answer off.
        const stop = normalizeFinishReason(msg?.delta?.stop_reason);
        if (stop !== null) finishReason = stop;
      } else if (type === "error") {
        throw new Error(
          scrubSecrets(
            `anthropic stream error: ${JSON.stringify(msg?.error ?? msg).slice(0, 300)}`,
          ),
        );
      } else if (type === "message_stop") {
        break;
      }
    }
    yield { type: "usage", tokensIn, tokensOut, finishReason, reasoningTokens: 0, servedModel };
  }
}
