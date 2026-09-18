import { createHash } from "node:crypto";
import type { EndpointConfig, RunnerConfig } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonicalize(v)]),
    );
  }
  return value;
}

/**
 * Explicitly project the replayable configuration, never arbitrary runtime
 * properties or provider credentials. Endpoint URLs carry only protocol/host/
 * path; credentials must be supplied separately when replaying. Prompts and
 * expected answers are intentional run inputs, so operators must review those
 * (and generated evidence) before publishing a bundle.
 */
export function replayConfiguration(cfg: RunnerConfig): {
  config: RunnerConfig;
  redactedFields: string[];
} {
  const redactedFields: string[] = [];
  const endpoints = cfg.endpoints.map((ep, i): EndpointConfig => {
    const endpoint: EndpointConfig = {
      id: ep.id,
      providerId: ep.providerId,
      modelId: ep.modelId,
      baseKind: ep.baseKind,
      model: ep.model,
      priceInPerMtokUsd: ep.priceInPerMtokUsd,
      priceOutPerMtokUsd: ep.priceOutPerMtokUsd,
      supportsSeed: ep.supportsSeed,
    };
    if (ep.quantization !== undefined) endpoint.quantization = ep.quantization;
    if (ep.baseUrl !== undefined) {
      const url = new URL(ep.baseUrl);
      if (url.username || url.password || url.search || url.hash) {
        redactedFields.push(`endpoints[${i}].baseUrl credentials/query/fragment`);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        endpoint.baseUrl = url.toString();
      } else {
        endpoint.baseUrl = ep.baseUrl;
      }
    }
    return endpoint;
  });
  const config: RunnerConfig = {
    runId: cfg.runId,
    name: cfg.name,
    mode: cfg.mode,
    pack: {
      slug: cfg.pack.slug,
      version: cfg.pack.version,
      prompt: cfg.pack.prompt,
      browserCheckCount: cfg.pack.browserCheckCount,
      ...(cfg.pack.tasks === undefined
        ? {}
        : {
            tasks: cfg.pack.tasks.map((task) => ({
              id: task.id,
              prompt: task.prompt,
              scorer: task.scorer,
              ...(task.expected === undefined ? {} : { expected: task.expected }),
              ...(task.jsonField === undefined
                ? {}
                : {
                    jsonField: {
                      path: task.jsonField.path,
                      expected: task.jsonField.expected,
                    },
                  }),
            })),
          }),
    },
    endpoints,
    samplesPerModel: cfg.samplesPerModel,
    temperature: cfg.temperature,
    maxOutputTokens: cfg.maxOutputTokens,
    seed: cfg.seed,
    concurrency: cfg.concurrency,
    maxBudgetUsd: cfg.maxBudgetUsd,
    transportRetries: cfg.transportRetries,
  };
  if (cfg.failSample !== undefined) {
    config.failSample = {
      endpointId: cfg.failSample.endpointId,
      sampleIndex: cfg.failSample.sampleIndex,
    };
  }
  if (cfg.judge !== undefined) {
    config.judge = {
      model: cfg.judge.model,
      priceInPerMtokUsd: cfg.judge.priceInPerMtokUsd,
      priceOutPerMtokUsd: cfg.judge.priceOutPerMtokUsd,
    };
  }
  return { config, redactedFields };
}

/** Config identity excludes per-run labels and credentials. */
export function computeFingerprint(cfg: RunnerConfig): string {
  const { runId: _runId, name: _name, ...content } = replayConfiguration(cfg).config;
  return `fp_${sha256Hex(JSON.stringify(canonicalize(content))).slice(0, 12)}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function promptHash(prompt: string): string {
  return sha256Hex(prompt).slice(0, 8);
}
