/**
 * Reproducible run bundle export + content-addressed config fingerprint.
 * bundles/<runId>/: manifest.json, models.json, benchmark.json, samples.jsonl,
 * scores.json, README.md, artifacts/, screenshots/, events.jsonl.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunManifest } from "@model-lab/schemas";
import { FsRunStore, runPrefix, sanitizeSegment } from "./store-fs";
import type { BundleResult, RunnerConfig } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const v = record[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Content-addressed fingerprint: sha256 of the canonical (sorted-keys) config
 * JSON, 12-hex prefix with "fp_". Per-run identity fields (runId, name) are
 * excluded so identical configurations share a fingerprint across runs.
 */
export function computeFingerprint(cfg: RunnerConfig): string {
  const { runId: _runId, name: _name, ...content } = cfg;
  const canonical = JSON.stringify(canonicalize(content));
  return `fp_${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12)}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 8-hex prompt hash, matching the fixture's promptHash shape. */
export function promptHash(prompt: string): string {
  return sha256Hex(prompt).slice(0, 8);
}

export async function exportBundle(
  runId: string,
  store: FsRunStore = new FsRunStore(),
): Promise<BundleResult> {
  const snapshot = store.loadSnapshot(runId);
  if (snapshot === null) {
    throw new Error(`no stored results for ${sanitizeSegment(runId)} — complete a run first`);
  }
  const dir = store.bundleDir(runId);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string): void => {
    writeFileSync(join(dir, name), content, "utf8");
    files.push(name);
  };

  const manifest: RunManifest = {
    runId: snapshot.run.id,
    fingerprint: snapshot.run.fingerprint,
    benchmark: `${snapshot.config.pack.slug} ${snapshot.config.pack.version}`,
    promptHash: snapshot.run.promptHash,
    runnerVersion: snapshot.run.runnerVersion,
    date: snapshot.run.startedAt.slice(0, 10),
    samplesPerModel: snapshot.run.samplesPerModel,
    modelCount: snapshot.run.modelCount,
    scorers: ["browser"],
    gitCommit: snapshot.run.gitCommit,
    environment: snapshot.environment ?? null,
  };
  write("manifest.json", JSON.stringify(manifest, null, 2));
  write("models.json", JSON.stringify(snapshot.models, null, 2));
  write(
    "benchmark.json",
    JSON.stringify(
      {
        slug: snapshot.config.pack.slug,
        version: snapshot.config.pack.version,
        kind: "build-arena",
        browserCheckCount: snapshot.config.pack.browserCheckCount,
        prompt: snapshot.config.pack.prompt,
        promptHash: snapshot.run.promptHash,
      },
      null,
      2,
    ),
  );
  write("samples.jsonl", `${snapshot.samples.map((s) => JSON.stringify(s)).join("\n")}\n`);
  const scores = snapshot.models.map((m) => ({
    endpointId: m.endpointId,
    meanScore: m.visualScore?.value ?? null,
    scoredSamples: m.visualScore?.n ?? 0,
    failedSampleCount: m.failedSampleCount,
    testsPassed: m.testsPassed,
    testsTotal: m.testsTotal,
    tokensOut: m.tokensOut,
    costUsd: m.costUsd,
  }));
  write("scores.json", JSON.stringify(scores, null, 2));
  write(
    "README.md",
    [
      `# Run bundle — ${snapshot.run.id}`,
      "",
      `- benchmark: ${manifest.benchmark}`,
      `- fingerprint: ${manifest.fingerprint} (sha256 of canonical config, 12-hex)`,
      `- prompt hash: ${manifest.promptHash}`,
      `- runner: ${manifest.runnerVersion}`,
      `- date: ${manifest.date} · ${manifest.modelCount} models × ${manifest.samplesPerModel} samples`,
      ...(snapshot.environment
        ? [
            `- environment: node ${snapshot.environment.node} · ${snapshot.environment.platform} · ${snapshot.environment.chromium ?? "browser checks did not run"}` +
              (snapshot.environment.localHardware
                ? ` · local hardware ${snapshot.environment.localHardware}`
                : ""),
            `- served models: ${
              Object.entries(snapshot.environment.servedModels)
                .map(([id, model]) => `${id} → ${model}`)
                .join(", ") || "not reported by the providers"
            }`,
            ...(Object.keys(snapshot.environment.quantizations).length > 0
              ? [
                  `- quantizations: ${Object.entries(snapshot.environment.quantizations)
                    .map(([id, q]) => `${id} → ${q}`)
                    .join(", ")}`,
                ]
              : []),
          ]
        : ["- environment: not recorded (run predates provenance capture)"]),
      "",
      "## Contents",
      "",
      "| file | contents |",
      "|---|---|",
      "| manifest.json | run identity + provenance |",
      "| benchmark.json | pack slug/version + verbatim challenge prompt |",
      "| models.json | per-endpoint aggregates (RunModel[]) |",
      "| samples.jsonl | one SampleResult per line |",
      "| scores.json | per-endpoint score summary |",
      "| artifacts/ | generated single-file HTML artifacts |",
      "| screenshots/ | browser-check screenshots (PNG) |",
      "| events.jsonl | full append-only RunEvent log |",
      "",
      "## Replay",
      "",
      "1. Recreate the RunnerConfig from benchmark.json + models.json",
      "   (same pack version, prompt, temperature, seed, samplesPerModel).",
      "2. `startRun(config)` with @model-lab/build-arena-runner — an identical",
      "   config yields the same fingerprint, so results are comparable.",
      "3. Artifacts are untrusted model output: open only inside a sandboxed",
      "   iframe/viewer (network blocked). Never open them directly in a browser",
      "   with network access.",
    ].join("\n"),
  );

  const artifactsSrc = join(store.root, "artifacts", runPrefix(runId));
  if (existsSync(artifactsSrc)) {
    cpSync(artifactsSrc, join(dir, "artifacts"), { recursive: true });
    files.push("artifacts/");
  }
  const screenshotsSrc = join(store.root, "screenshots", runPrefix(runId));
  if (existsSync(screenshotsSrc)) {
    cpSync(screenshotsSrc, join(dir, "screenshots"), { recursive: true });
    files.push("screenshots/");
  }
  const eventsSrc = join(store.runDir(runId), "events.jsonl");
  if (existsSync(eventsSrc)) {
    cpSync(eventsSrc, join(dir, "events.jsonl"));
    files.push("events.jsonl");
  }

  store.appendEvent(runId, {
    t: new Date().toISOString(),
    type: "export.created",
    runId: snapshot.run.id,
    endpointId: null,
    sampleIndex: null,
    level: "info",
    message: `bundle exported · ${files.length} entries`,
    // Relative to the data root: the event log ships inside the bundle, and an
    // absolute path would publish the exporter's username and disk layout.
    payload: { dir: relative(store.root, dir).split("\\").join("/") },
  });

  return { runId: snapshot.run.id, fingerprint: snapshot.run.fingerprint, dir, files };
}
