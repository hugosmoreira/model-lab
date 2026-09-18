/** Versioned replay contract plus exact, hashed evidence exports. */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { RunManifest, ScorerType } from "@model-lab/schemas";
import { computeFingerprint, replayConfiguration, sha256Hex } from "./config-fingerprint";
import { FsRunStore, sanitizeSegment } from "./store-fs";
import type { SourceRevision } from "./provenance";
import type { BundleResult, RunnerConfig } from "./types";

export { computeFingerprint, promptHash, sha256Hex } from "./config-fingerprint";

export interface BundleEvidence {
  kind: "artifact" | "screenshot" | "raw";
  endpointId: string;
  sampleIndex: number;
  path: string | null;
  sha256: string | null;
  bytes: number | null;
  status: "included" | "missing";
}

export interface ReplayContract {
  schemaVersion: 1;
  format: "model-lab-replay";
  fingerprintAlgorithm: "sha256-canonical-runner-config-v1/12";
  fingerprint: string;
  recordedFingerprint: string;
  fingerprintMatchesRecorded: boolean;
  config: RunnerConfig;
  mode: RunnerConfig["mode"];
  configuredScorers: ScorerType[];
  actualScorers: ScorerType[];
  provenance: {
    status: "captured" | "legacy-incomplete";
    createdAt: string;
    sourceRevision: SourceRevision;
    redactedFields: string[];
    missingFields: string[];
  };
  evidence: BundleEvidence[];
}

/** Read an exported contract and verify its config identity before replay. */
export function readReplayConfiguration(value: unknown): RunnerConfig {
  const replay = value as Partial<ReplayContract> | null;
  if (
    replay === null ||
    typeof replay !== "object" ||
    replay.schemaVersion !== 1 ||
    replay.format !== "model-lab-replay" ||
    replay.fingerprintAlgorithm !== "sha256-canonical-runner-config-v1/12" ||
    !replay.config ||
    computeFingerprint(replay.config) !== replay.fingerprint
  ) {
    throw new Error("invalid replay contract or configuration fingerprint");
  }
  return replayConfiguration(replay.config).config;
}

export async function exportBundle(
  runId: string,
  store: FsRunStore = new FsRunStore(),
): Promise<BundleResult> {
  return writeBundle(runId, store, join(store.bundleDir(runId), randomUUID()), true);
}

/**
 * HTTP downloads own only this temporary export, including failures while
 * writing or consuming it. CLI exports remain persistent. Reads must not grow
 * the persistent bundle collection or append download events to the run log.
 */
export async function withTemporaryBundle<T>(
  runId: string,
  consume: (bundle: BundleResult) => T | Promise<T>,
  store: FsRunStore = new FsRunStore(),
): Promise<T> {
  mkdirSync(store.root, { recursive: true });
  const parent = realpathSync(store.root);
  const ownedDir = resolve(mkdtempSync(join(parent, ".bundle-download-")));
  const ownedStat = lstatSync(ownedDir);
  try {
    const bundle = await writeBundle(runId, store, ownedDir, false);
    return await consume(bundle);
  } finally {
    removeOwnedTemporaryBundle(ownedDir, parent, ownedStat);
  }
}

function removeOwnedTemporaryBundle(
  ownedDir: string,
  parent: string,
  identity: { dev: number; ino: number },
): void {
  if (!existsSync(ownedDir)) return;
  const current = lstatSync(ownedDir);
  // Delete only the exact directory created by this call. Never derive a
  // cleanup target from the mutable BundleResult or scan older exports.
  if (
    dirname(ownedDir) !== parent ||
    !basename(ownedDir).startsWith(".bundle-download-") ||
    current.isSymbolicLink() ||
    realpathSync(ownedDir) !== ownedDir ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  ) {
    throw new Error("temporary bundle directory ownership changed");
  }
  rmSync(ownedDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

async function writeBundle(
  runId: string,
  store: FsRunStore,
  dir: string,
  recordExport: boolean,
): Promise<BundleResult> {
  const snapshot = store.loadSnapshot(runId);
  if (snapshot === null) {
    throw new Error(`no stored results for ${sanitizeSegment(runId)} — complete a run first`);
  }
  const creation = store.loadCreation(runId);
  const safe = replayConfiguration(creation?.config ?? snapshot.config);
  const config = safe.config;
  if (config.runId !== runId) throw new Error("configuration belongs to another run");
  const fingerprint = computeFingerprint(config);
  if (creation !== null && creation.fingerprint !== fingerprint) {
    throw new Error("creation configuration fingerprint is inconsistent");
  }
  if (creation !== null && snapshot.run.fingerprint !== fingerprint) {
    throw new Error("stored run does not match its creation configuration");
  }

  // Every export is a fresh directory. A repeated or simultaneous export can
  // never retain stale files from an earlier snapshot or another run.
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const hashes: Record<string, { sha256: string; bytes: number }> = {};
  const write = (name: string, content: string | Uint8Array): void => {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: "wx" });
    files.push(name);
    hashes[name] = {
      sha256: sha256Hex(content),
      bytes: typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength,
    };
  };
  const json = (name: string, value: unknown): void =>
    write(name, `${JSON.stringify(value, null, 2)}\n`);

  const evidence: BundleEvidence[] = [];
  const include = (
    kind: BundleEvidence["kind"],
    endpointId: string,
    sampleIndex: number,
    reference: string | null,
  ): string | null => {
    const category =
      kind === "artifact" ? "artifacts" : kind === "screenshot" ? "screenshots" : "raw";
    const full = reference === null ? null : store.resolveEvidencePath(reference, category);
    const name = full === null ? null : relative(store.root, full).replace(/\\/g, "/");
    if (full === null || !existsSync(full)) {
      evidence.push({
        kind,
        endpointId,
        sampleIndex,
        path: name,
        sha256: null,
        bytes: null,
        status: "missing",
      });
      return null;
    }
    if (name === null) throw new Error("missing evidence path");
    const data = readFileSync(full);
    if (hashes[name] === undefined) write(name, data);
    const recorded = hashes[name];
    if (recorded === undefined || recorded.sha256 !== sha256Hex(data)) {
      throw new Error("evidence changed during export");
    }
    evidence.push({ kind, endpointId, sampleIndex, path: name, ...recorded, status: "included" });
    return name;
  };

  const artifacts = snapshot.artifacts.map((artifact) => ({
    ...artifact,
    path: include("artifact", artifact.endpointId, artifact.sampleIndex, artifact.path),
    screenshotPath:
      artifact.screenshotPath === null
        ? null
        : include("screenshot", artifact.endpointId, artifact.sampleIndex, artifact.screenshotPath),
  }));
  for (const sample of snapshot.samples) {
    if (sample.runId !== runId) throw new Error("sample belongs to another run");
    include(
      "raw",
      sample.endpointId,
      sample.sampleIndex,
      store.existingRawPath(runId, sample.endpointId, sample.sampleIndex),
    );
  }
  const events = store.readEvents(runId).filter((event) => event.runId === runId);
  const actual = new Set<ScorerType>();
  for (const sample of snapshot.samples) {
    // Failure rows carry the configured primaryScorer even when generation
    // failed before any scorer ran. Only observed scores/traces count here.
    if (sample.status === "scored" && sample.score != null && sample.primaryScorer != null) {
      actual.add(sample.primaryScorer);
    }
    if (sample.scorerTrace?.some((check) => check.name.startsWith("objective."))) {
      actual.add("objective");
    }
  }
  if (
    snapshot.artifacts.some((artifact) =>
      artifact.checks.some((check) => check.status === "passed" || check.status === "failed"),
    )
  ) {
    actual.add("browser");
  }
  if (
    (snapshot.judgePairs?.length ?? 0) > 0 ||
    events.some((event) => event.type === "judge.vote")
  ) {
    actual.add("llm-judge");
  }
  const configuredScorers: ScorerType[] = config.mode === "verified" ? ["objective"] : ["browser"];
  if (config.mode !== "verified" && config.judge !== undefined) configuredScorers.push("llm-judge");
  const sourceRevision = creation?.sourceRevision ?? {
    commit: snapshot.run.gitCommit,
    dirty: null,
    source: "unavailable" as const,
  };
  const missingFields =
    creation === null
      ? ["immutable creation-time configuration", "source tree state at creation"]
      : [];
  if (sourceRevision.commit === null) missingFields.push("source revision");
  if (evidence.some((item) => item.status === "missing"))
    missingFields.push("some recorded evidence files");
  const replay: ReplayContract = {
    schemaVersion: 1,
    format: "model-lab-replay",
    fingerprintAlgorithm: "sha256-canonical-runner-config-v1/12",
    fingerprint,
    recordedFingerprint: snapshot.run.fingerprint,
    fingerprintMatchesRecorded: fingerprint === snapshot.run.fingerprint,
    config,
    mode: config.mode,
    configuredScorers,
    actualScorers: [...actual].sort(),
    provenance: {
      status: creation === null ? "legacy-incomplete" : "captured",
      createdAt: creation?.createdAt ?? snapshot.run.startedAt,
      sourceRevision,
      redactedFields: [...new Set([...(creation?.redactedFields ?? []), ...safe.redactedFields])],
      missingFields,
    },
    evidence,
  };
  const manifest: RunManifest = {
    runId: snapshot.run.id,
    fingerprint: snapshot.run.fingerprint,
    benchmark: `${config.pack.slug} ${config.pack.version}`,
    promptHash: snapshot.run.promptHash,
    runnerVersion: snapshot.run.runnerVersion,
    date: snapshot.run.startedAt.slice(0, 10),
    samplesPerModel: snapshot.run.samplesPerModel,
    modelCount: snapshot.run.modelCount,
    scorers: replay.actualScorers,
    gitCommit: sourceRevision.commit,
    environment: snapshot.environment ?? null,
  };
  json("replay.json", replay);
  json("manifest.json", {
    ...manifest,
    bundleVersion: 1,
    mode: config.mode,
    replay: "replay.json",
  });
  json("benchmark.json", {
    ...config.pack,
    kind: config.mode,
    promptHash: snapshot.run.promptHash,
  });
  json("models.json", snapshot.models);
  json("artifacts.json", artifacts);
  json("judge-pairs.json", snapshot.judgePairs ?? []);
  write("samples.jsonl", snapshot.samples.map((sample) => `${JSON.stringify(sample)}\n`).join(""));
  write("events.jsonl", events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  json(
    "scores.json",
    snapshot.models.map((model) => ({
      endpointId: model.endpointId,
      meanScore: model.visualScore?.value ?? null,
      scoreSource: model.visualSource ?? (config.mode === "verified" ? "objective" : "browser"),
      scoredSamples: model.visualScore?.n ?? 0,
      failedSampleCount: model.failedSampleCount,
      testsPassed: model.testsPassed,
      testsTotal: model.testsTotal,
      tokensOut: model.tokensOut,
      costUsd: model.costUsd,
    })),
  );
  write(
    "README.md",
    [
      `# Run bundle — ${snapshot.run.id}`,
      "",
      `- Format: Model Lab replay v1`,
      `- Benchmark: ${manifest.benchmark} (${config.mode})`,
      `- Recorded fingerprint: ${manifest.fingerprint}`,
      `- Exported configuration fingerprint: ${fingerprint}`,
      `- Creation provenance: ${replay.provenance.status}`,
      `- Source revision: ${sourceRevision.commit ?? "unavailable"}; dirty: ${String(sourceRevision.dirty)}`,
      `- Scorers with recorded evidence: ${replay.actualScorers.join(", ") || "none"}`,
      ...(missingFields.length
        ? [`- Missing provenance/evidence: ${missingFields.join("; ")}`]
        : []),
      ...(replay.provenance.redactedFields.length
        ? [`- Redacted configuration: ${replay.provenance.redactedFields.join("; ")}`]
        : []),
      "",
      "## Replay",
      "",
      "Read replay.json with readReplayConfiguration() from @model-lab/build-arena-runner.",
      "It contains the creation-time RunnerConfig, including objective tasks and scorer settings.",
      "Give the returned configuration a NEW runId, supply provider credentials through the environment,",
      "and call createBuildArenaAdapter().startRun(config), which validates the run settings.",
      "Changing only runId/name preserves the configuration fingerprint.",
      "Redacted endpoint URL fields must be configured separately if the provider requires them.",
      "Legacy exports lack an immutable creation record: inspect the provenance status and fingerprintMatchesRecorded.",
      "A matching configuration does not promise identical output from nondeterministic models or remote aliases.",
      "",
      "## Evidence and integrity",
      "",
      "replay.json lists each exact artifact, screenshot and raw-output reference, its SHA-256 and byte count.",
      "Only files referenced by this run are included. Missing evidence is listed explicitly.",
      "checksums.json records the hash and size of every other exported file; it is an integrity index, not a signature.",
      "artifacts.json, samples.jsonl, models.json, scores.json, judge-pairs.json and events.jsonl preserve the recorded results.",
      "Configuration serialization excludes credential fields and URL userinfo/query/fragment.",
      "Prompts, model output and operator metadata can contain private information: review evidence before publication.",
      "Generated HTML is untrusted. Inspect captured screenshots or use an appropriately isolated viewer;",
      "do not open it directly in a browser with access to your accounts or network.",
      "",
    ].join("\n"),
  );
  // The index deliberately excludes itself to avoid a circular hash definition.
  json("checksums.json", hashes);

  if (recordExport) {
    store.appendEvent(runId, {
      t: new Date().toISOString(),
      type: "export.created",
      runId: snapshot.run.id,
      endpointId: null,
      sampleIndex: null,
      level: "info",
      message: `bundle exported · ${files.length} files`,
      payload: { dir: relative(store.root, dir).replace(/\\/g, "/") },
    });
  }
  return { runId: snapshot.run.id, fingerprint: snapshot.run.fingerprint, dir, files };
}
