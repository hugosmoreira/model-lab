/**
 * @model-lab/build-arena-runner — native Build Arena execution engine.
 * Node-only; no Next/React imports anywhere in this package.
 */
export * from "./types";
export { EventBus } from "./event-bus";
export {
  BuildArenaAdapter,
  createBuildArenaAdapter,
  EST_OUTPUT_TOKENS_PER_MODEL,
  EST_OUTPUT_TOKENS_PER_TASK_VERIFIED,
} from "./adapter";
export { startRun, extractArtifactHtml, MAX_ARTIFACT_BYTES } from "./run";
export type { StartRunOptions, ArtifactExtraction } from "./run";
export {
  runJudgePhase,
  extractJsonObject,
  parseRubricVerdict,
  parsePairVerdict,
  normalizeSwappedVerdict,
  JUDGE_MAX_TOKENS,
  JUDGE_TEMPERATURE,
  JUDGE_MAX_HTML_CHARS,
  RENDER_FAILED_SCORE_CAP,
} from "./judge";
export type {
  JudgeEmit,
  JudgePhaseOptions,
  JudgePhaseResult,
  PairVerdict,
  PairWinner,
  RubricVerdict,
} from "./judge";
export {
  scoreObjective,
  stripAnswerFences,
  normalizeAnswer,
  valueAtPath,
  MAX_TRACE_NOTE_CHARS,
} from "./checks/objective";
export type { ObjectiveOutcome } from "./checks/objective";
export {
  createProvider,
  AnthropicProvider,
  OpenAiCompatibleProvider,
  OllamaProvider,
  MockProvider,
  buildMockRaycasterHtml,
  buildMockVerifiedAnswer,
  mockWrongValue,
  resolveOpenAiCompatible,
  DEFAULT_OLLAMA_BASE_URL,
  scrubSecrets,
  checkProviderHealth,
  checkProvidersHealth,
  credentialEnvFor,
  statusForHttp,
} from "./providers";
export type {
  AnthropicOptions,
  HealthOptions,
  MockProviderOptions,
  OpenAiCompatibleOptions,
  ProviderHealth,
  ProviderHealthStatus,
} from "./providers";
export {
  runBrowserChecks,
  closeBrowserChecks,
  injectCsp,
  BROWSER_CHECK_NAMES,
  BROWSER_NOT_INSTALLED_NOTE,
  CHECK_CATEGORY,
  CHECK_THRESHOLDS,
  categoryOf,
  capabilityChecks,
  failedGates,
  unmeasuredGates,
} from "./checks/browser-checks";
export type {
  BrowserCheckName,
  BrowserChecksOptions,
  BrowserChecksOutcome,
  RegionMetrics,
} from "./checks/browser-checks";
export {
  FsRunStore,
  sanitizeSegment,
  shortModelName,
  runPrefix,
  identitySegment,
  DATA_DIR_ENV,
} from "./store-fs";
export type { WrittenArtifact } from "./store-fs";
export {
  exportBundle,
  withTemporaryBundle,
  computeFingerprint,
  promptHash,
  sha256Hex,
  readReplayConfiguration,
} from "./bundle";
export type { ReplayContract, BundleEvidence } from "./bundle";
export { replayConfiguration } from "./config-fingerprint";
export { captureSourceRevision, captureRunCreation } from "./provenance";
export type { RunCreationRecord, SourceRevision } from "./provenance";
