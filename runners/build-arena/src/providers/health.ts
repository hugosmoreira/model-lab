/**
 * Provider health probes — SERVER-ONLY (network, env).
 *
 * One cheap, read-only request per provider: its model list. It proves the
 * key is accepted and the endpoint is reachable, costs nothing, and says how
 * many models the account (or the local server) can see. Keys never leave
 * the process; error text is scrubbed before it is returned.
 */
import { DEFAULT_OLLAMA_BASE_URL } from "./ollama";
import { scrubSecrets } from "./util";

export type ProviderHealthStatus =
  "connected" | "disconnected" | "rate-limited" | "no-key" | "unsupported";

export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  /** round trip of the probe; null when no request was made */
  latencyMs: number | null;
  /** models the account can see (cloud) or has pulled (Ollama) */
  modelsAvailable: number | null;
  /** the env var the probe needs, so the UI can name a missing key; null for keyless Ollama */
  credentialEnv: string | null;
  /** host the probe went to */
  endpoint: string | null;
  checkedAt: string;
  /** scrubbed, short */
  detail: string | null;
}

interface Probe {
  url: string;
  env: string | null;
  headers: (key: string | null) => Record<string, string>;
  count: (json: unknown) => number | null;
}

const ANTHROPIC_VERSION = "2023-06-01";

/** The env var that must hold a provider's key; null for keyless Ollama. */
export function credentialEnvFor(providerId: string): string | null {
  switch (providerId) {
    case "ollama":
      return null;
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    default:
      return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  }
}

/** HTTP status of the probe → health status. */
export function statusForHttp(code: number): ProviderHealthStatus {
  if (code >= 200 && code < 300) return "connected";
  if (code === 429) return "rate-limited";
  return "disconnected";
}

function countData(json: unknown): number | null {
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.length : null;
}

function bearer(key: string | null): Record<string, string> {
  return key !== null && key !== "" ? { authorization: `Bearer ${key}` } : {};
}

function probeFor(providerId: string): Probe | null {
  switch (providerId) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        env: "ANTHROPIC_API_KEY",
        headers: (key) => ({ "x-api-key": key ?? "", "anthropic-version": ANTHROPIC_VERSION }),
        count: countData,
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        env: "OPENAI_API_KEY",
        headers: bearer,
        count: countData,
      };
    case "deepseek":
      return {
        url: "https://api.deepseek.com/models",
        env: "DEEPSEEK_API_KEY",
        headers: bearer,
        count: countData,
      };
    case "google":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
        env: "GOOGLE_API_KEY",
        headers: bearer,
        count: countData,
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/models",
        env: "OPENROUTER_API_KEY",
        headers: bearer,
        count: countData,
      };
    case "ollama": {
      const base = (process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL)
        .replace(/\/+$/, "")
        .replace(/\/v1$/, "");
      return {
        url: `${base}/api/tags`,
        env: null,
        headers: () => ({}),
        count: (json) => {
          const models = (json as { models?: unknown } | null)?.models;
          return Array.isArray(models) ? models.length : null;
        },
      };
    }
    default:
      return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface HealthOptions {
  /** per-probe deadline; default 4000 ms */
  timeoutMs?: number;
}

export async function checkProviderHealth(
  providerId: string,
  opts: HealthOptions = {},
): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = opts.timeoutMs ?? 4000;
  const probe = probeFor(providerId);
  if (probe === null) {
    return {
      providerId,
      status: "unsupported",
      latencyMs: null,
      modelsAvailable: null,
      credentialEnv: credentialEnvFor(providerId),
      endpoint: null,
      checkedAt,
      detail: "no health probe for this provider yet",
    };
  }
  const key = probe.env === null ? null : (process.env[probe.env] ?? "");
  if (probe.env !== null && (key === null || key === "")) {
    return {
      providerId,
      status: "no-key",
      latencyMs: null,
      modelsAvailable: null,
      credentialEnv: probe.env,
      endpoint: hostOf(probe.url),
      checkedAt,
      detail: `${probe.env} is not set`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(probe.url, { headers: probe.headers(key), signal: controller.signal });
    const latencyMs = Date.now() - started;
    const status = statusForHttp(res.status);
    let modelsAvailable: number | null = null;
    let detail: string | null = null;
    if (status === "connected") {
      try {
        modelsAvailable = probe.count(await res.json());
      } catch {
        modelsAvailable = null;
      }
    } else {
      const text = await res.text().catch(() => "");
      detail = scrubSecrets(`HTTP ${res.status}${text !== "" ? `: ${text.slice(0, 120)}` : ""}`);
    }
    return {
      providerId,
      status,
      latencyMs,
      modelsAvailable,
      credentialEnv: probe.env,
      endpoint: hostOf(probe.url),
      checkedAt,
      detail,
    };
  } catch (err) {
    return {
      providerId,
      status: "disconnected",
      latencyMs: Date.now() - started,
      modelsAvailable: null,
      credentialEnv: probe.env,
      endpoint: hostOf(probe.url),
      checkedAt,
      detail: controller.signal.aborted
        ? `no answer within ${timeoutMs} ms`
        : providerId === "ollama"
          ? `no Ollama server answering at ${hostOf(probe.url)} — start it with \`ollama serve\``
          : scrubSecrets(err instanceof Error ? err.message : String(err)).slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** All providers in parallel; one slow provider never delays the others' answers. */
export function checkProvidersHealth(
  providerIds: readonly string[],
  opts: HealthOptions = {},
): Promise<ProviderHealth[]> {
  return Promise.all(providerIds.map((id) => checkProviderHealth(id, opts)));
}
