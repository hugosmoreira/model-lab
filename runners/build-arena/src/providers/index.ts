/**
 * Provider registry: one adapter per baseKind (audit §13.2 provider boundary).
 */
import type { EndpointConfig, Provider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { providerDeadlinesFor, type ProviderLimits } from "./limits";
import { MockProvider } from "./mock";
import { OllamaProvider } from "./ollama";
import { OpenAiCompatibleProvider, resolveOpenAiCompatible } from "./openai-compatible";

export function createProvider(
  endpoint: EndpointConfig,
  limits: ProviderLimits = providerDeadlinesFor(endpoint),
): Provider {
  switch (endpoint.baseKind) {
    case "anthropic":
      return new AnthropicProvider({ limits });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        ...resolveOpenAiCompatible(endpoint.providerId, endpoint.baseUrl),
        limits,
      });
    case "ollama":
      return new OllamaProvider(endpoint.baseUrl, limits);
    case "mock":
      return new MockProvider();
  }
}

export { AnthropicProvider } from "./anthropic";
export type { AnthropicOptions } from "./anthropic";
export {
  MockProvider,
  buildMockRaycasterHtml,
  buildMockVerifiedAnswer,
  mockWrongValue,
} from "./mock";
export type { MockProviderOptions } from "./mock";
export { OllamaProvider, DEFAULT_OLLAMA_BASE_URL } from "./ollama";
export {
  checkProviderHealth,
  checkProvidersHealth,
  credentialEnvFor,
  statusForHttp,
} from "./health";
export type { HealthOptions, ProviderHealth, ProviderHealthStatus } from "./health";
export { OpenAiCompatibleProvider, resolveOpenAiCompatible } from "./openai-compatible";
export type { OpenAiCompatibleOptions } from "./openai-compatible";
export { approxTokens, errorMessage, readSse, scrubSecrets, sleep } from "./util";
