/**
 * In-memory run bundle for the seeded demo scenario (run_8f3ac21e).
 *
 * SERVER-ONLY (imports adm-zip / node Buffer) — used exclusively by
 * GET /api/runs/[runId]/bundle. The demo run never touched the FsRunStore,
 * so its bundle is generated from the typed fixtures with the same file
 * layout the native runner's exportBundle() writes to bundles/<runId>/
 * (runners/build-arena/src/bundle.ts): manifest.json, models.json,
 * benchmark.json, samples.jsonl, scores.json, README.md.
 */
import AdmZip from "adm-zip";
import {
  benchmarkPacks,
  challengePrompt,
  runCompleted,
  runManifest,
  runModelsCompleted,
  samples,
} from "@model-lab/schemas/fixtures";

export const DEMO_RUN_ID = "run_8f3ac21e";

export function buildDemoBundleZip(): Buffer {
  const zip = new AdmZip();
  const add = (name: string, content: string): void => {
    zip.addFile(name, Buffer.from(content, "utf8"));
  };

  add("manifest.json", JSON.stringify(runManifest, null, 2));
  add("models.json", JSON.stringify(runModelsCompleted, null, 2));

  const pack = benchmarkPacks.find((p) => p.slug === runCompleted.pack.slug);
  add(
    "benchmark.json",
    JSON.stringify(
      {
        slug: runCompleted.pack.slug,
        version: runCompleted.pack.version,
        kind: "build-arena",
        browserCheckCount: pack?.browserCheckCount ?? 12,
        prompt: challengePrompt,
        promptHash: runCompleted.promptHash,
      },
      null,
      2,
    ),
  );

  add("samples.jsonl", `${samples.map((s) => JSON.stringify(s)).join("\n")}\n`);

  const scores = runModelsCompleted.map((m) => ({
    endpointId: m.endpointId,
    meanScore: m.visualScore?.value ?? null,
    scoredSamples: m.visualScore?.n ?? 0,
    failedSampleCount: m.failedSampleCount,
    testsPassed: m.testsPassed,
    testsTotal: m.testsTotal,
    tokensOut: m.tokensOut,
    costUsd: m.costUsd,
  }));
  add("scores.json", JSON.stringify(scores, null, 2));

  add(
    "README.md",
    [
      `# Run bundle — ${runManifest.runId} (demo fixture)`,
      "",
      `- benchmark: ${runManifest.benchmark}`,
      `- fingerprint: ${runManifest.fingerprint} (sha256 of canonical config, 12-hex)`,
      `- prompt hash: ${runManifest.promptHash}`,
      `- runner: ${runManifest.runnerVersion}`,
      `- date: ${runManifest.date} · ${runManifest.modelCount} models × ${runManifest.samplesPerModel} samples`,
      "- provenance: generated in-memory from the seeded demo fixtures — not a disk run export,",
      "  so artifacts/, screenshots/, and events.jsonl are omitted",
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

  return zip.toBuffer();
}
