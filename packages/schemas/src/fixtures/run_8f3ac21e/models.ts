import type { ModelDefinition, ModelEndpoint, Provider } from "../../index";
import { MODEL_COLORS } from "../../core";

export const providers: Provider[] = [
  {
    id: "anthropic", name: "Anthropic", kind: "cloud", status: "connected", isLocal: false,
    healthLatencyMs: 182, modelsAvailable: 4, modelsLoaded: null,
    lastTestedAt: "2026-07-31T14:30:00Z", credentialMasked: "sk-ant-…4f2a",
    credentialStore: "keychain", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "openai", name: "OpenAI", kind: "cloud", status: "connected", isLocal: false,
    healthLatencyMs: 210, modelsAvailable: 6, modelsLoaded: null,
    lastTestedAt: "2026-07-31T14:30:00Z", credentialMasked: "sk-…9b11",
    credentialStore: "keychain", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "google", name: "Google", kind: "cloud", status: "connected", isLocal: false,
    healthLatencyMs: 164, modelsAvailable: 3, modelsLoaded: null,
    lastTestedAt: "2026-07-31T14:28:00Z", credentialMasked: "AIza…22c8",
    credentialStore: "keychain", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "xai", name: "xAI", kind: "cloud", status: "disconnected", isLocal: false,
    healthLatencyMs: null, modelsAvailable: null, modelsLoaded: null,
    lastTestedAt: null, credentialMasked: "not configured",
    credentialStore: "unset", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "openrouter", name: "OpenRouter", kind: "aggregator", status: "rate-limited", isLocal: false,
    healthLatencyMs: null, modelsAvailable: 212, modelsLoaded: null,
    lastTestedAt: "2026-07-31T14:14:00Z", credentialMasked: "sk-or-…7d40",
    credentialStore: "keychain",
    warning: { message: "429s on qwen3 route for the last 20 min — retry with backoff active." },
    localEndpoint: null, localHardware: null,
  },
  {
    id: "litellm", name: "LiteLLM", kind: "aggregator", status: "disconnected", isLocal: false,
    healthLatencyMs: null, modelsAvailable: null, modelsLoaded: null,
    lastTestedAt: null, credentialMasked: "not configured",
    credentialStore: "unset", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "ollama", name: "Ollama", kind: "local", status: "connected", isLocal: true,
    healthLatencyMs: null, modelsAvailable: null, modelsLoaded: 2,
    lastTestedAt: "2026-07-31T14:31:00Z", credentialMasked: "no key required",
    credentialStore: "none", warning: null,
    localEndpoint: "localhost:11434", localHardware: "RTX 4090",
  },
  {
    id: "vllm", name: "vLLM", kind: "local", status: "disconnected", isLocal: true,
    healthLatencyMs: null, modelsAvailable: null, modelsLoaded: null,
    lastTestedAt: null, credentialMasked: "endpoint not set",
    credentialStore: "unset", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "custom", name: "Custom OpenAI-compatible", kind: "custom", status: "disconnected", isLocal: false,
    healthLatencyMs: null, modelsAvailable: null, modelsLoaded: null,
    lastTestedAt: null, credentialMasked: "endpoint not set",
    credentialStore: "unset", warning: null, localEndpoint: null, localHardware: null,
  },
  {
    id: "deepseek", name: "DeepSeek", kind: "cloud", status: "connected", isLocal: false,
    healthLatencyMs: null, modelsAvailable: 2, modelsLoaded: null,
    lastTestedAt: null, credentialMasked: "configured · DEEPSEEK_API_KEY",
    credentialStore: "env", warning: null, localEndpoint: null, localHardware: null,
  },
];

export const modelDefinitions: ModelDefinition[] = [
  {
    id: "claude-sonnet-4-6", family: "Claude 4.6", shortName: "sonnet-4-6",
    identityColor: MODEL_COLORS["claude-sonnet-4-6"], contextWindowTokens: 400_000,
    capabilities: ["code", "vision", "tools", "seed"], supportsSeed: true,
  },
  {
    id: "claude-haiku-4-5", family: "Claude 4.5", shortName: "haiku-4-5",
    identityColor: MODEL_COLORS["claude-sonnet-4-6"], contextWindowTokens: 200_000,
    capabilities: ["code", "fast"], supportsSeed: true,
  },
  {
    id: "gpt-5.2-mini", family: "GPT-5.2", shortName: "gpt-5.2-mini",
    identityColor: MODEL_COLORS["gpt-5.2-mini"], contextWindowTokens: 272_000,
    capabilities: ["code", "json-mode", "seed"], supportsSeed: true,
  },
  {
    id: "gpt-5.2", family: "GPT-5.2", shortName: "gpt-5.2",
    identityColor: MODEL_COLORS["gpt-5.2-mini"], contextWindowTokens: 272_000,
    capabilities: ["code", "vision", "tools"], supportsSeed: true,
  },
  {
    id: "gemini-3-flash", family: "Gemini 3", shortName: "gemini-3-fl",
    identityColor: MODEL_COLORS["gemini-3-flash"], contextWindowTokens: 1_000_000,
    capabilities: ["code", "fast", "cheap"], supportsSeed: false,
  },
  {
    id: "qwen3-coder-32b", family: "Qwen 3", shortName: "qwen3-32b",
    identityColor: MODEL_COLORS["qwen3-coder-32b"], contextWindowTokens: 128_000,
    capabilities: ["code", "local"], supportsSeed: false,
  },
  {
    id: "llama-4-scout-17b", family: "Llama 4", shortName: "llama4-scout",
    identityColor: MODEL_COLORS.neutral, contextWindowTokens: 10_000_000,
    capabilities: ["general", "local"], supportsSeed: false,
  },
  // --- real (live-capable) models -----------------------------------------
  {
    id: "gpt-5-mini", family: "GPT-5", shortName: "gpt-5-mini",
    identityColor: MODEL_COLORS["gpt-5.2-mini"], contextWindowTokens: 400_000,
    capabilities: ["code", "fast", "cheap"], supportsSeed: true,
  },
  {
    id: "deepseek-v4-flash", family: "DeepSeek V4", shortName: "ds-v4-flash",
    identityColor: "#5aa7d4", contextWindowTokens: 128_000,
    capabilities: ["code", "cheap", "fast"], supportsSeed: false,
  },
  {
    id: "deepseek-v4-pro", family: "DeepSeek V4", shortName: "ds-v4-pro",
    identityColor: "#5aa7d4", contextWindowTokens: 128_000,
    capabilities: ["code"], supportsSeed: false,
  },
  {
    id: "gemini-3.5-flash", family: "Gemini 3.5", shortName: "gemini-3.5-fl",
    identityColor: "#a98ae8", contextWindowTokens: 1_000_000,
    capabilities: ["code", "fast", "cheap"], supportsSeed: false,
  },
  {
    id: "qwen3.5-abliterated", family: "Qwen 3.5", shortName: "qwen3.5-abl",
    identityColor: MODEL_COLORS["qwen3-coder-32b"], contextWindowTokens: 128_000,
    capabilities: ["general", "local"], supportsSeed: false,
  },
  {
    id: "qwen3-coder-next", family: "Qwen 3 Coder", shortName: "qwen3-coder-next",
    identityColor: MODEL_COLORS["qwen3-coder-32b"], contextWindowTokens: 256_000,
    capabilities: ["code", "local"], supportsSeed: false,
  },
];

export const endpoints: ModelEndpoint[] = [
  {
    id: "anthropic/claude-sonnet-4-6", modelId: "claude-sonnet-4-6", apiModel: null, providerId: "anthropic",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 3, priceOutPerMtokUsd: 15, status: "healthy",
    runsCount: 14, reliabilityPct: 100, avgVisualScore: 9.0, lastTestedAt: "2026-07-31",
  },
  {
    id: "anthropic/claude-haiku-4-5", modelId: "claude-haiku-4-5", apiModel: null, providerId: "anthropic",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.8, priceOutPerMtokUsd: 4, status: "healthy",
    runsCount: 6, reliabilityPct: 100, avgVisualScore: 7.8, lastTestedAt: "2026-07-26",
  },
  {
    id: "openai/gpt-5.2-mini", modelId: "gpt-5.2-mini", apiModel: null, providerId: "openai",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.6, priceOutPerMtokUsd: 2.4, status: "healthy",
    runsCount: 11, reliabilityPct: 100, avgVisualScore: 8.0, lastTestedAt: "2026-07-31",
  },
  {
    id: "openai/gpt-5.2", modelId: "gpt-5.2", apiModel: null, providerId: "openai",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 5, priceOutPerMtokUsd: 20, status: "healthy",
    runsCount: 4, reliabilityPct: 95, avgVisualScore: 8.9, lastTestedAt: "2026-07-24",
  },
  {
    id: "google/gemini-3-flash", modelId: "gemini-3-flash", apiModel: null, providerId: "google",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.15, priceOutPerMtokUsd: 0.9, status: "healthy",
    runsCount: 9, reliabilityPct: 100, avgVisualScore: 7.3, lastTestedAt: "2026-07-31",
  },
  {
    id: "ollama/qwen3-coder-32b@q4_K_M", modelId: "qwen3-coder-32b", apiModel: null, providerId: "ollama",
    deployment: "local", quantization: "q4_K_M", hardware: "RTX 4090",
    priceInPerMtokUsd: null, priceOutPerMtokUsd: null, status: "loaded",
    runsCount: 7, reliabilityPct: 84, avgVisualScore: 6.9, lastTestedAt: "2026-07-31",
  },
  {
    id: "openrouter/qwen3-coder-32b@fp16", modelId: "qwen3-coder-32b", apiModel: null, providerId: "openrouter",
    deployment: "aggregator", quantization: "fp16", hardware: null,
    priceInPerMtokUsd: 0.4, priceOutPerMtokUsd: 1.2, status: "rate-limited",
    runsCount: 2, reliabilityPct: 95, avgVisualScore: 7.2, lastTestedAt: "2026-07-17",
  },
  {
    id: "ollama/llama-4-scout-17b", modelId: "llama-4-scout-17b", apiModel: null, providerId: "ollama",
    deployment: "local", quantization: null, hardware: "RTX 4090",
    priceInPerMtokUsd: null, priceOutPerMtokUsd: null, status: "not-loaded",
    runsCount: 1, reliabilityPct: null, avgVisualScore: null, lastTestedAt: "2026-06-30",
  },
  // --- real (live-capable) endpoints --------------------------------------
  {
    id: "openai/gpt-5-mini", modelId: "gpt-5-mini", apiModel: null, providerId: "openai",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.25, priceOutPerMtokUsd: 2.0, status: "healthy",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
  {
    id: "ollama/qwen3.5-abliterated", modelId: "qwen3.5-abliterated",
    apiModel: "huihui_ai/qwen3.5-abliterated:latest", providerId: "ollama",
    deployment: "local", quantization: null, hardware: "RTX 4090",
    priceInPerMtokUsd: null, priceOutPerMtokUsd: null, status: "loaded",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
  {
    id: "ollama/qwen3-coder-next", modelId: "qwen3-coder-next",
    apiModel: "hf.co/bartowski/huihui-ai_Qwen3-Coder-Next-abliterated-GGUF:Q4_K_M", providerId: "ollama",
    deployment: "local", quantization: null, hardware: "RTX 4090",
    priceInPerMtokUsd: null, priceOutPerMtokUsd: null, status: "loaded",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
  {
    id: "deepseek/deepseek-v4-flash", modelId: "deepseek-v4-flash", apiModel: null, providerId: "deepseek",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.27, priceOutPerMtokUsd: 1.1, status: "healthy",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
  {
    id: "deepseek/deepseek-v4-pro", modelId: "deepseek-v4-pro", apiModel: null, providerId: "deepseek",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.55, priceOutPerMtokUsd: 2.19, status: "healthy",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
  {
    // Real Gemini endpoint (AI Studio key, OpenAI-compatible surface). The
    // demo's google/gemini-3-flash stays fixture-only — no such live model id.
    id: "google/gemini-3.5-flash", modelId: "gemini-3.5-flash", apiModel: null, providerId: "google",
    deployment: "cloud", quantization: null, hardware: null,
    priceInPerMtokUsd: 0.3, priceOutPerMtokUsd: 2.5, status: "healthy",
    runsCount: 0, reliabilityPct: null, avgVisualScore: null, lastTestedAt: null,
  },
];

/** The four endpoints participating in run_8f3ac21e, in canonical order. */
export const RUN_ENDPOINT_IDS = [
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.2-mini",
  "google/gemini-3-flash",
  "ollama/qwen3-coder-32b@q4_K_M",
] as const;
