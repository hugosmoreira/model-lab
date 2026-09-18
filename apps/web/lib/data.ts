/**
 * Data access seam. Phase 0: everything resolves from typed fixtures.
 * Phase 2+: these loaders swap to the repository layer (local SQLite or
 * Supabase) without touching page components.
 */
import * as fx from "@model-lab/schemas/fixtures";

export const fixtures = fx;

export function getEndpoint(endpointId: string) {
  const ep = fx.endpoints.find((e) => e.id === endpointId);
  if (!ep) throw new Error(`Unknown endpoint: ${endpointId}`);
  return ep;
}

export function getModelForEndpoint(endpointId: string) {
  const ep = getEndpoint(endpointId);
  const model = fx.modelDefinitions.find((m) => m.id === ep.modelId);
  if (!model) throw new Error(`Unknown model: ${ep.modelId}`);
  return model;
}

export function getProviderForEndpoint(endpointId: string) {
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
