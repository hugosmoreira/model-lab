/**
 * @model-lab/build-arena-runner — native Build Arena execution engine.
 * Node-only; no Next/React imports anywhere in this package.
 */
export * from "./types";
export { EventBus } from "./event-bus";
export { BuildArenaAdapter, createBuildArenaAdapter, EST_OUTPUT_TOKENS_PER_MODEL } from "./adapter";
export { startRun, extractArtifactHtml, MAX_ARTIFACT_BYTES } from "./run";
export type { StartRunOptions, ArtifactExtraction } from "./run";
export {
  createProvider,
  AnthropicProvider,
  OpenAiCompatibleProvider,
  OllamaProvider,
  MockProvider,
  buildMockRaycasterHtml,
  resolveOpenAiCompatible,
  DEFAULT_OLLAMA_BASE_URL,
  scrubSecrets,
} from "./providers";
export type { AnthropicOptions, MockProviderOptions, OpenAiCompatibleOptions } from "./providers";
export {
  runBrowserChecks,
  closeBrowserChecks,
  injectCsp,
  BROWSER_CHECK_NAMES,
  BROWSER_NOT_INSTALLED_NOTE,
} from "./checks/browser-checks";
export type {
  BrowserCheckName,
  BrowserChecksOptions,
  BrowserChecksOutcome,
} from "./checks/browser-checks";
export {
  FsRunStore,
  sanitizeSegment,
  shortModelName,
  runPrefix,
  DATA_DIR_ENV,
} from "./store-fs";
export type { WrittenArtifact } from "./store-fs";
export { exportBundle, computeFingerprint, promptHash, sha256Hex } from "./bundle";
