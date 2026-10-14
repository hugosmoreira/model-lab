/**
 * Data access seam. Phase 0: everything resolves from typed fixtures.
 * Phase 2+: these loaders swap to the repository layer (local SQLite or
 * Supabase) without touching page components.
 */
import {
  MODEL_COLORS,
  type ModelDefinition,
  type ModelEndpoint,
  type Provider,
} from "@model-lab/schemas";
import * as fx from "@model-lab/schemas/fixtures";

export const fixtures = fx;

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#e0a458",
  openai: "#7f9fe8",
  google: "#a98ae8",
  deepseek: "#5aa7d4",
  ollama: "#d9799c",
};

/**
 * Models come from live provider lists, so a recorded run can name an endpoint
 * the demo registry has never seen; its id ("provider/model") is enough to show it.
 */
function endpointFromId(endpointId: string): ModelEndpoint {
  const slash = endpointId.indexOf("/");
  const providerId = slash > 0 ? endpointId.slice(0, slash) : "custom";
  const modelId = slash > 0 ? endpointId.slice(slash + 1) : endpointId;
  return {
    id: endpointId,
    modelId,
    apiModel: null,
    providerId,
    deployment: providerId === "ollama" || providerId === "baseline" ? "local" : "cloud",
    quantization: null,
    hardware: null,
    priceInPerMtokUsd: null,
    priceOutPerMtokUsd: null,
    status: "healthy",
    runsCount: 0,
    reliabilityPct: null,
    avgVisualScore: null,
    lastTestedAt: null,
  };
}

export function getEndpoint(endpointId: string): ModelEndpoint {
  return fx.endpoints.find((e) => e.id === endpointId) ?? endpointFromId(endpointId);
}

export function getModelForEndpoint(endpointId: string): ModelDefinition {
  const ep = getEndpoint(endpointId);
  return (
    fx.modelDefinitions.find((m) => m.id === ep.modelId) ?? {
      id: ep.modelId,
      family: ep.modelId,
      shortName: ep.modelId.split("/").pop()!.slice(0, 18),
      identityColor: PROVIDER_COLORS[ep.providerId] ?? MODEL_COLORS.neutral,
      contextWindowTokens: 0,
      capabilities: ep.deployment === "local" ? ["local"] : [],
      supportsSeed: false,
    }
  );
}

export function getProviderForEndpoint(endpointId: string): Provider {
  const ep = getEndpoint(endpointId);
  const provider = fx.providers.find((p) => p.id === ep.providerId);
  if (!provider) throw new Error(`Unknown provider: ${ep.providerId}`);
  return provider;
}

/** "anthropic · cloud" / "ollama · local · RTX 4090" display string. */
export function endpointProviderLabel(endpointId: string): string {
  const ep = getEndpoint(endpointId);
  const parts: string[] = [
    ep.providerId,
    ep.deployment === "aggregator" ? "hosted" : ep.deployment,
  ];
  // Hardware belongs to a recorded run environment, not the static endpoint catalog.
  return parts.join(" · ");
}

export function modelColor(endpointId: string): string {
  return getModelForEndpoint(endpointId).identityColor;
}

export function modelIdOf(endpointId: string): string {
  return getEndpoint(endpointId).modelId;
}

export function shortNameOf(endpointId: string): string {
  return getModelForEndpoint(endpointId).shortName;
}
