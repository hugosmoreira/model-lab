/**
 * End-to-end selftest: full mock-provider 2-endpoint × 2-sample run to
 * completion, printing the live event stream, the event-log tail, and the
 * exported bundle path. One (endpoint, sample) combination is forced to fail
 * (null-canvas bug) to exercise the sample.failed path.
 *
 * Run with:  pnpm --filter @model-lab/build-arena-runner exec tsx src/selftest.ts
 * (or any TS runtime that resolves extensionless ESM imports)
 */
import type { RunEvent } from "@model-lab/schemas";
import { BuildArenaAdapter } from "./adapter";
import { BROWSER_NOT_INSTALLED_NOTE } from "./checks/browser-checks";
import type { RunnerConfig } from "./types";

async function main(): Promise<void> {
  const adapter = new BuildArenaAdapter();
  const runId = `run_st${Date.now().toString(16).slice(-6)}`;
  const cfg: RunnerConfig = {
    runId,
    name: "Selftest — mock 2×2",
    mode: "build-arena",
    pack: {
      slug: "raycaster-oneshot",
      version: "v1.3",
      prompt:
        "Build a playable raycaster in ONE self-contained HTML file. Textured walls, WASD movement, " +
        "a minimap, and no external network dependencies. Return only the HTML document.",
      browserCheckCount: 12,
    },
    endpoints: [
      {
        id: "mock/alpha",
        providerId: "mock",
        modelId: "mock-alpha",
        baseKind: "mock",
        model: "mock-alpha",
        priceInPerMtokUsd: 3,
        priceOutPerMtokUsd: 15,
        supportsSeed: true,
      },
      {
        id: "mock/beta",
        providerId: "mock",
        modelId: "mock-beta",
        baseKind: "mock",
        model: "mock-beta",
        priceInPerMtokUsd: null,
        priceOutPerMtokUsd: null,
        supportsSeed: false,
      },
    ],
    samplesPerModel: 2,
    temperature: 0.7,
    maxOutputTokens: 8_000,
    seed: 42,
    concurrency: 2,
    maxBudgetUsd: 5,
    transportRetries: 1,
    failSample: { endpointId: "mock/beta", sampleIndex: 2 },
  };

  const validation = adapter.validateConfiguration(cfg);
  console.log(
    `validate: ok=${String(validation.ok)} errors=${validation.errors.length} warnings=${validation.warnings.length}`,
  );
  for (const w of validation.warnings) console.log(`  warn ${w.field}: ${w.message}`);
  const estimate = adapter.estimateRun(cfg);
  console.log(
    `estimate: $${estimate.estCostRangeUsd[0].toFixed(2)}–$${estimate.estCostRangeUsd[1].toFixed(2)} · ${estimate.totalSamples} samples · withinBudget=${String(estimate.withinBudget)}`,
  );

  const handle = adapter.startRun(cfg);
  const log: RunEvent[] = [];
  for await (const event of handle.events) {
    log.push(event);
    const where = `${event.endpointId ?? "-"}${event.sampleIndex !== null ? `#${event.sampleIndex}` : ""}`;
    console.log(`[${event.type}] ${where} · ${event.message}`);
  }
  const outcome = await handle.done;

  console.log("\n— event log tail —");
  for (const event of log.slice(-12)) {
    console.log(`  ${event.t} ${event.type} · ${event.message}`);
  }

  const bundle = await adapter.exportBundle(runId);
  console.log(`\nbundle: ${bundle.dir}`);
  console.log(`fingerprint: ${bundle.fingerprint}`);
  console.log(
    `outcome: ${outcome.status} · scored=${outcome.samplesScored} failed=${outcome.samplesFailed} · $${outcome.spentUsd.toFixed(4)}`,
  );

  const degraded = log.some((e) => e.message.includes(BROWSER_NOT_INSTALLED_NOTE));
  const sawInjectedFailure = log.some(
    (e) => e.type === "sample.failed" && e.endpointId === "mock/beta" && e.sampleIndex === 2,
  );
  const sawCompletion = log.some((e) => e.type === "run.completed");
  if (outcome.status !== "completed" || !sawCompletion) {
    console.error("SELFTEST FAIL: run did not complete");
    process.exitCode = 1;
    return;
  }
  if (!degraded && !sawInjectedFailure) {
    console.error("SELFTEST FAIL: injected failure did not surface as sample.failed");
    process.exitCode = 1;
    return;
  }
  console.log(
    degraded
      ? "SELFTEST PASS (degraded: chromium not installed — checks skipped, failure path not exercised)"
      : "SELFTEST PASS",
  );
}

main().catch((err: unknown) => {
  console.error("SELFTEST CRASH:", err);
  process.exitCode = 1;
});
