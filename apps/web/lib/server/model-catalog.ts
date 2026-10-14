/**
 * Live model catalog — SERVER-ONLY (network, env, disk).
 *
 * The models a run can use come from each configured provider's own model-list
 * API, so a release appears the day the provider serves it to this key and a
 * retired model disappears. Prices come from OpenRouter's public catalog, taken
 * only from the provider's own host there (a third-party host's rate is not what
 * the provider's API charges); an operator price file can fill the gaps. A model
 * with no price cannot start a paid run. Nothing here names a model.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelCapability, ModelDefinition, ModelEndpoint } from "@model-lab/schemas";
import {
  DEMO_ONLY_ENDPOINT_IDS,
  endpoints as fixtureEndpoints,
  modelDefinitions as fixtureModels,
} from "@model-lab/schemas/fixtures";
import { credentialEnvFor, DEFAULT_OLLAMA_BASE_URL } from "@model-lab/build-arena-runner";
import { repoRoot } from "./packs";

/** Releases older than this are left out of the default list (search still finds them). */
export const RECENT_DAYS = 183;
const CACHE_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const ANTHROPIC_VERSION = "2023-06-01";
const BASELINE_ID = "baseline/blank-html";

/** Providers whose model list Model Lab can read and route requests to. */
export const DISCOVERABLE_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "ollama",
] as const;
type DiscoverableProvider = (typeof DISCOVERABLE_PROVIDERS)[number];

/**
 * Model ids that are not chat models, are dated duplicates of an alias, or need
 * an API surface other than chat completions. Patterns, not a model list.
 */
const NOT_CHAT =
  /(embed|tts|transcri|whisper|audio|realtime|image|imagen|veo|sora|dall-e|lyria|moderation|search|(^|-)live|robotics|computer-use|deep-research|nano-banana|omni|aqa|latest$|codex|instruct|babbage|davinci|-\d{4}-\d{2}-\d{2}$|-\d{8}$)/i;
/** OpenAI "-pro" models answer only on the Responses API. */
const OPENAI_RESPONSES_ONLY = /-pro($|-)/i;

/**
 * OpenRouter's tag for each provider's own host at its standard tier; variants
 * carry a suffix ("openai/flex", "anthropic/fast") and are not what a plain
 * API request is billed at.
 */
const FIRST_PARTY_TAGS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google-ai-studio",
  deepseek: "deepseek",
};
const PRICE_LOOKUPS_IN_PARALLEL = 8;

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#e0a458",
  openai: "#7f9fe8",
  google: "#a98ae8",
  deepseek: "#5aa7d4",
  ollama: "#d9799c",
};

export interface RequestHints {
  /** the model thinks on every request; ask for summarized thinking so it streams */
  alwaysThinks: boolean;
  /** the model rejects sampling parameters */
  omitTemperature: boolean;
}

export interface LiveModel {
  endpoint: ModelEndpoint;
  model: ModelDefinition;
  displayName: string;
  /** ISO date the provider (or OpenRouter) dates the release; null when neither does */
  releasedAt: string | null;
  /** inside the default window; providers that publish no dates count as recent */
  recent: boolean;
  /** openrouter: provider's own host there · operator: model-prices.json · null: unknown */
  priceSource: "openrouter" | "operator" | "local" | null;
  hints: RequestHints;
}

export interface ProviderListing {
  providerId: string;
  status: "listed" | "no-key" | "error" | "offline";
  detail: string | null;
  models: number;
}

export interface ModelCatalog {
  fetchedAt: string;
  /** live: fetched now · snapshot: last live list (forced mock mode) · demo: no list yet */
  source: "live" | "snapshot" | "demo";
  models: LiveModel[];
  providers: ProviderListing[];
}

interface RawModel {
  id: string;
  displayName: string;
  releasedAt: string | null;
  contextTokens: number | null;
  vision: boolean;
  alwaysThinks: boolean;
  apiModel?: string;
  quantization?: string | null;
}

/** What OpenRouter's summary says about a model, apart from price. */
interface ListingRow {
  releasedAt: string | null;
  acceptsTemperature: boolean;
}

interface Price {
  priceIn: number;
  priceOut: number;
  source: "openrouter" | "operator";
}

let cached: { at: number; catalog: ModelCatalog } | null = null;
let inflight: Promise<ModelCatalog> | null = null;

function forcedMock(): boolean {
  return (process.env["MODEL_LAB_MOCK_PROVIDERS"] ?? "").trim() === "1";
}

function snapshotPath(): string {
  const dataDir = process.env["MODEL_LAB_DATA_DIR"] ?? join(repoRoot(), "artifacts-data");
  return join(dataDir, "model-catalog.json");
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isoDate = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
};

async function listProvider(providerId: DiscoverableProvider, key: string): Promise<RawModel[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  switch (providerId) {
    case "anthropic": {
      const json = (await getJson("https://api.anthropic.com/v1/models?limit=1000", {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      })) as any;
      return (json?.data ?? []).map((m: any): RawModel => ({
        id: String(m.id),
        displayName: String(m.display_name ?? m.id),
        releasedAt: isoDate(m.created_at),
        contextTokens: typeof m.max_input_tokens === "number" ? m.max_input_tokens : null,
        vision: m.capabilities?.image_input?.supported === true,
        alwaysThinks:
          m.capabilities?.thinking?.supported === true &&
          m.capabilities?.thinking?.types?.disabled?.supported === false,
      }));
    }
    case "openai": {
      const json = (await getJson("https://api.openai.com/v1/models", {
        authorization: `Bearer ${key}`,
      })) as any;
      return (json?.data ?? [])
        .filter((m: any) => !OPENAI_RESPONSES_ONLY.test(String(m.id)))
        .map((m: any): RawModel => ({
          id: String(m.id),
          displayName: String(m.id),
          releasedAt: isoDate(m.created),
          contextTokens: null,
          vision: false,
          alwaysThinks: false,
        }));
    }
    case "google": {
      const json = (await getJson(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        { "x-goog-api-key": key },
      )) as any;
      return (json?.models ?? [])
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m: any): RawModel => ({
          id: String(m.name).replace(/^models\//, ""),
          displayName: String(m.displayName ?? m.name),
          releasedAt: null,
          contextTokens: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : null,
          vision: false,
          alwaysThinks: false,
        }));
    }
    case "deepseek": {
      const json = (await getJson("https://api.deepseek.com/models", {
        authorization: `Bearer ${key}`,
      })) as any;
      return (json?.data ?? []).map((m: any): RawModel => ({
        id: String(m.id),
        displayName: String(m.id),
        releasedAt: null,
        contextTokens: null,
        vision: false,
        alwaysThinks: false,
      }));
    }
    case "ollama": {
      const base = (process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL)
        .replace(/\/+$/, "")
        .replace(/\/v1$/, "");
      const json = (await getJson(`${base}/api/tags`, {})) as any;
      return (json?.models ?? []).map((m: any): RawModel => ({
        id: String(m.name).replace(/:latest$/, ""),
        apiModel: String(m.name),
        displayName: String(m.name),
        releasedAt: isoDate(m.modified_at),
        contextTokens:
          typeof m.details?.context_length === "number" ? m.details.context_length : null,
        vision: false,
        alwaysThinks: false,
        quantization:
          typeof m.details?.quantization_level === "string" ? m.details.quantization_level : null,
      }));
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** OpenRouter's public summary: release dates and accepted parameters per model id. */
async function listListings(): Promise<Map<string, ListingRow>> {
  const listings = new Map<string, ListingRow>();
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = (await getJson("https://openrouter.ai/api/v1/models", {})) as any;
    for (const m of json?.data ?? []) {
      listings.set(String(m.id), {
        releasedAt: isoDate(m.created),
        acceptsTemperature: (m.supported_parameters ?? []).includes("temperature"),
      });
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch {
    // No summary: models keep their provider dates and stay unpriced.
  }
  return listings;
}

/** Exact OpenRouter id, or the same id with version dashes as dots (claude-opus-5-5 → 5.5). */
function openRouterId(
  listings: Map<string, ListingRow>,
  providerId: string,
  modelId: string,
): string | null {
  for (const candidate of [
    `${providerId}/${modelId}`,
    `${providerId}/${modelId.replace(/(\d)-(\d)/g, "$1.$2")}`,
  ]) {
    if (listings.has(candidate)) return candidate;
  }
  return null;
}

/** The provider's own host on OpenRouter, at its standard tier. */
async function firstPartyPrice(slug: string, providerId: string): Promise<Price | null> {
  const tag = FIRST_PARTY_TAGS[providerId];
  if (tag === undefined) return null;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = (await getJson(
      `https://openrouter.ai/api/v1/models/${slug}/endpoints`,
      {},
    )) as any;
    for (const e of json?.data?.endpoints ?? []) {
      if (String(e?.tag) !== tag) continue;
      const priceIn = Number(e?.pricing?.prompt) * 1e6;
      const priceOut = Number(e?.pricing?.completion) * 1e6;
      if (!Number.isFinite(priceIn) || !Number.isFinite(priceOut) || priceIn < 0 || priceOut < 0)
        continue;
      return {
        priceIn: Math.round(priceIn * 1e4) / 1e4,
        priceOut: Math.round(priceOut * 1e4) / 1e4,
        source: "openrouter",
      };
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return null;
  } catch {
    return null;
  }
}

/**
 * Operator prices for models OpenRouter cannot price: <data dir>/model-prices.json,
 * `{ "deepseek/deepseek-flash": { "in": 0.3, "out": 1.2 } }` in USD per million tokens.
 */
function operatorPrices(): Map<string, Price> {
  const prices = new Map<string, Price>();
  try {
    const file = join(dirname(snapshotPath()), "model-prices.json");
    if (!existsSync(file)) return prices;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [id, value] of Object.entries(parsed)) {
      const row = value as { in?: unknown; out?: unknown };
      const priceIn = Number(row?.in);
      const priceOut = Number(row?.out);
      if (Number.isFinite(priceIn) && Number.isFinite(priceOut) && priceIn >= 0 && priceOut >= 0) {
        prices.set(id, { priceIn, priceOut, source: "operator" });
      }
    }
  } catch {
    // An unreadable price file prices nothing; it never guesses.
  }
  return prices;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

function toLiveModel(
  providerId: DiscoverableProvider,
  raw: RawModel,
  listing: ListingRow | null,
  price: Price | null,
  now: number,
): LiveModel {
  const local = providerId === "ollama";
  // A local model already in the registry keeps its id, so its history stays together.
  const known = local
    ? fixtureEndpoints.find((ep) => ep.providerId === "ollama" && ep.apiModel === raw.apiModel)
    : undefined;
  const modelId = known?.modelId ?? raw.id;
  const releasedAt = raw.releasedAt ?? listing?.releasedAt ?? null;
  const datesPublished = providerId === "anthropic" || providerId === "openai" || local;
  const recent =
    local ||
    (releasedAt !== null
      ? now - Date.parse(releasedAt) <= RECENT_DAYS * 86_400_000
      : !datesPublished);
  const capabilities: ModelCapability[] = ["code"];
  if (raw.vision) capabilities.push("vision");
  if (raw.alwaysThinks) capabilities.push("reasoning");
  if (local) capabilities.push("local");
  return {
    endpoint: {
      id: known?.id ?? `${providerId}/${modelId}`,
      modelId,
      apiModel: raw.apiModel ?? null,
      providerId,
      deployment: local ? "local" : "cloud",
      quantization: raw.quantization ?? null,
      hardware: null,
      priceInPerMtokUsd: local ? null : (price?.priceIn ?? null),
      priceOutPerMtokUsd: local ? null : (price?.priceOut ?? null),
      status: local ? "loaded" : "healthy",
      runsCount: 0,
      reliabilityPct: null,
      avgVisualScore: null,
      lastTestedAt: null,
    },
    model: {
      id: modelId,
      family: raw.displayName,
      shortName: modelId.split("/").pop()!.slice(0, 18),
      identityColor: PROVIDER_COLORS[providerId] ?? "#948da3",
      contextWindowTokens: raw.contextTokens ?? 0,
      capabilities,
      supportsSeed: false,
    },
    displayName: raw.displayName,
    releasedAt,
    recent,
    priceSource: local ? "local" : (price?.source ?? null),
    hints: {
      alwaysThinks: raw.alwaysThinks,
      omitTemperature: listing !== null && !listing.acceptsTemperature,
    },
  };
}

function baselineModel(): LiveModel {
  const endpoint = fixtureEndpoints.find((ep) => ep.id === BASELINE_ID)!;
  const model = fixtureModels.find((m) => m.id === endpoint.modelId)!;
  return {
    endpoint,
    model,
    displayName: "Blank page (null baseline)",
    releasedAt: null,
    recent: true,
    priceSource: "local",
    hints: { alwaysThinks: false, omitTemperature: false },
  };
}

async function fetchLive(): Promise<ModelCatalog> {
  const now = Date.now();
  // Prices matter only for keyed cloud providers; without one, stay off the network.
  const anyCloudKey = DISCOVERABLE_PROVIDERS.some((providerId) => {
    const env = credentialEnvFor(providerId);
    return env !== null && (process.env[env] ?? "").trim() !== "";
  });
  const listingsPromise = anyCloudKey
    ? listListings()
    : Promise.resolve(new Map<string, ListingRow>());
  const providers = await Promise.all(
    DISCOVERABLE_PROVIDERS.map(async (providerId) => {
      const env = credentialEnvFor(providerId);
      const key = env === null ? "" : (process.env[env] ?? "").trim();
      if (env !== null && key === "") {
        return { providerId, status: "no-key" as const, detail: `${env} is not set`, raw: [] };
      }
      try {
        const raw = (await listProvider(providerId, key)).filter(
          (m) => providerId === "ollama" || !NOT_CHAT.test(m.id),
        );
        return { providerId, status: "listed" as const, detail: null, raw };
      } catch (err) {
        const offline = providerId === "ollama";
        return {
          providerId,
          status: offline ? ("offline" as const) : ("error" as const),
          detail: offline
            ? "no Ollama server answering — start it with `ollama serve`"
            : err instanceof Error
              ? err.message.slice(0, 120)
              : "model list unavailable",
          raw: [],
        };
      }
    }),
  );
  const listings = await listingsPromise;
  const operator = operatorPrices();
  const entries = providers.flatMap((p) =>
    p.raw.map((raw) => {
      const providerId = p.providerId as DiscoverableProvider;
      const slug = providerId === "ollama" ? null : openRouterId(listings, providerId, raw.id);
      return { providerId, raw, slug };
    }),
  );
  const hostPrices = await mapLimited(entries, PRICE_LOOKUPS_IN_PARALLEL, (e) =>
    e.slug !== null ? firstPartyPrice(e.slug, e.providerId) : Promise.resolve(null),
  );
  const models = entries.map((e, index) =>
    toLiveModel(
      e.providerId,
      e.raw,
      e.slug !== null ? (listings.get(e.slug) ?? null) : null,
      operator.get(`${e.providerId}/${e.raw.id}`) ?? hostPrices[index] ?? null,
      now,
    ),
  );
  models.sort(
    (a, b) =>
      DISCOVERABLE_PROVIDERS.indexOf(a.endpoint.providerId as DiscoverableProvider) -
        DISCOVERABLE_PROVIDERS.indexOf(b.endpoint.providerId as DiscoverableProvider) ||
      (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") ||
      a.endpoint.id.localeCompare(b.endpoint.id),
  );
  return {
    fetchedAt: new Date(now).toISOString(),
    source: "live",
    models: [...models, baselineModel()],
    providers: providers.map(({ providerId, status, detail, raw }) => ({
      providerId,
      status,
      detail,
      models: raw.length,
    })),
  };
}

function writeSnapshot(catalog: ModelCatalog): void {
  try {
    const file = snapshotPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(catalog));
    renameSync(`${file}.tmp`, file);
  } catch {
    // A missing snapshot only means forced-mock mode shows the demo catalog.
  }
}

function readSnapshot(): ModelCatalog | null {
  try {
    const file = snapshotPath();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ModelCatalog;
    return Array.isArray(parsed.models) ? { ...parsed, source: "snapshot" } : null;
  } catch {
    return null;
  }
}

/** The demo workspace's real endpoints, for forced-mock mode before any live list exists. */
function demoCatalog(): ModelCatalog {
  return {
    fetchedAt: new Date().toISOString(),
    source: "demo",
    models: fixtureEndpoints
      .filter((endpoint) => !DEMO_ONLY_ENDPOINT_IDS.includes(endpoint.id))
      .map((endpoint) => ({
        endpoint,
        model: fixtureModels.find((m) => m.id === endpoint.modelId)!,
        displayName: endpoint.modelId,
        releasedAt: null,
        recent: true,
        priceSource: endpoint.deployment === "local" ? ("local" as const) : null,
        hints: { alwaysThinks: false, omitTemperature: false },
      })),
    providers: [],
  };
}

/**
 * The current catalog. Live lists are cached for ten minutes and saved to disk;
 * forced-mock mode never touches the network and reuses the last saved list.
 */
export async function getModelCatalog(opts: { refresh?: boolean } = {}): Promise<ModelCatalog> {
  if (forcedMock()) return readSnapshot() ?? demoCatalog();
  if (!opts.refresh && cached !== null && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  inflight ??= fetchLive()
    .then((catalog) => {
      cached = { at: Date.now(), catalog };
      if (catalog.models.length > 1) writeSnapshot(catalog);
      return catalog;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** One catalog entry by endpoint id, or null. */
export function findLiveModel(catalog: ModelCatalog, endpointId: string): LiveModel | null {
  return catalog.models.find((m) => m.endpoint.id === endpointId) ?? null;
}
