import { z } from "zod";

/** Fixed model identity colors. Squares in the UI; never encode status. */
export const MODEL_COLORS = {
  "claude-sonnet-4-6": "#e0a458",
  "gpt-5.2-mini": "#7f9fe8",
  "gemini-3-flash": "#a98ae8",
  "qwen3-coder-32b": "#d9799c",
  neutral: "#948da3",
  blind: "#6b6478",
} as const;

export const ProviderKind = z.enum(["cloud", "aggregator", "local", "custom"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ProviderStatus = z.enum(["connected", "disconnected", "rate-limited"]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const Provider = z.object({
  id: z.string(), // slug: "anthropic", "ollama", ...
  name: z.string(), // display: "Anthropic"
  kind: ProviderKind,
  status: ProviderStatus,
  isLocal: z.boolean().default(false),
  healthLatencyMs: z.number().nullable().default(null),
  modelsAvailable: z.number().nullable().default(null),
  /** local providers report loaded models instead of an available count */
  modelsLoaded: z.number().nullable().default(null),
  lastTestedAt: z.string().nullable().default(null), // ISO
  /** ONLY ever a pre-masked preview; real keys never reach the client. */
  credentialMasked: z.string(),
  credentialStore: z.enum(["keychain", "env", "none", "unset"]).default("unset"),
  warning: z.object({ message: z.string() }).nullable().default(null),
  localEndpoint: z.string().nullable().default(null), // "localhost:11434"
  localHardware: z.string().nullable().default(null), // "RTX 4090"
});
export type Provider = z.infer<typeof Provider>;

export const ModelCapability = z.enum([
  "code",
  "vision",
  "tools",
  "seed",
  "json-mode",
  "fast",
  "cheap",
  "local",
  "hosted",
  "general",
]);
export type ModelCapability = z.infer<typeof ModelCapability>;

export const ModelDefinition = z.object({
  id: z.string(), // "claude-sonnet-4-6" — NOT unique alone; endpoints key runs
  family: z.string(), // "Claude 4.6"
  shortName: z.string(), // canonical truncation, e.g. "sonnet-4-6"
  identityColor: z.string(), // fixed hex
  contextWindowTokens: z.number(),
  capabilities: z.array(ModelCapability),
  supportsSeed: z.boolean(),
});
export type ModelDefinition = z.infer<typeof ModelDefinition>;

export const EndpointStatus = z.enum(["healthy", "loaded", "not-loaded", "rate-limited"]);
export type EndpointStatus = z.infer<typeof EndpointStatus>;

/** A model *as served by one provider deployment* — the primary key for runs. */
export const ModelEndpoint = z.object({
  id: z.string(), // "anthropic/claude-sonnet-4-6", "ollama/qwen3-coder-32b@q4_K_M"
  modelId: z.string(),
  /** provider-side model identifier when it differs from modelId (e.g. ollama tags); null → use modelId */
  apiModel: z.string().nullable().default(null),
  providerId: z.string(),
  deployment: z.enum(["cloud", "local", "aggregator"]),
  quantization: z.string().nullable().default(null), // "q4_K_M", "fp16"
  hardware: z.string().nullable().default(null), // "RTX 4090" for local
  priceInPerMtokUsd: z.number().nullable(), // null => free/local
  priceOutPerMtokUsd: z.number().nullable(),
  status: EndpointStatus,
  runsCount: z.number().default(0),
  reliabilityPct: z.number().nullable().default(null),
  avgVisualScore: z.number().nullable().default(null), // null renders "— n/a"
  lastTestedAt: z.string().nullable().default(null),
});
export type ModelEndpoint = z.infer<typeof ModelEndpoint>;

export const PackKind = z.enum(["build-arena", "eval"]);
export const PackSource = z.enum(["official", "community", "imported", "custom"]);
export const EvalScorerKind = z.enum(["OBJECTIVE", "EXACT-MATCH", "CODE-TEST", "HYBRID"]);

export const BenchmarkPack = z.object({
  slug: z.string(), // "raycaster-oneshot"
  name: z.string(), // "One-Shot Raycaster"
  version: z.string(), // "v1.3"
  kind: PackKind,
  source: PackSource,
  description: z.string(),
  taskCount: z.number(),
  browserCheckCount: z.number().nullable().default(null), // arena packs
  evalScorer: EvalScorerKind.nullable().default(null), // eval packs
  scorersSummary: z.string(), // "browser(12)+human+judge"
  estCostPerModelUsd: z.number().nullable().default(null),
  estOutputTokensPerModel: z.number().nullable().default(null),
  category: z.string().nullable().default(null), // eval packs
  license: z.string(),
  prompt: z.string().nullable().default(null), // arena challenge text
  lastRunAt: z.string().nullable().default(null),
});
export type BenchmarkPack = z.infer<typeof BenchmarkPack>;
