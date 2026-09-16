/**
 * Model Lab CLI — the app without the browser.
 *
 *   pnpm cli run --pack raycaster-oneshot --models anthropic/claude-sonnet-4-6,openai/gpt-5-mini
 *   pnpm cli run --pack raycaster-oneshot --models … --samples 3 --budget 2 --fail-under 0.8
 *   pnpm cli models          # every registry endpoint and what this environment would do with it
 *   pnpm cli packs           # every benchmark pack, and whether it is on disk
 *
 * It goes through the same run service the web app uses (mock policy, judge,
 * persistence, provenance), so a CLI run shows up in the UI afterwards and a
 * UI run could have been started here. Keys and MODEL_LAB_* settings come
 * from the environment and the root .env, exactly as for the server.
 *
 * Exit codes: 0 completed · 1 --fail-under not met · 2 usage or configuration
 * error · 3 the run ended partial, cancelled or failed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Model Lab — run a benchmark from the terminal

usage
  pnpm cli run --pack <slug> --models <endpoint,endpoint,…> [options]
  pnpm cli models [--check]   # --check probes every provider (free, read-only)
  pnpm cli packs

run options
  --pack <slug>          benchmark pack (see: pnpm cli packs)
  --models <ids>         comma-separated endpoint ids (see: pnpm cli models)
  --samples <n>          samples per model (default 1; n=1 is an anecdote)
  --budget <usd>         hard spend ceiling for the run (default: workspace setting)
  --mode <mode>          build-arena (default) | verified
  --name <text>          run name (default: the pack name)
  --fail-under <ratio>   exit 1 if any model's capability ratio is below this (0–1)
  --mock                 force every endpoint and the judge to the zero-spend mock
  --no-judge             skip the LLM judge phase
  --store <backend>      memory | sqlite | supabase (default: MODEL_LAB_STORE or memory)
  --no-bundle            do not export the run bundle at the end
  --quiet                only the summary, not the event stream
`;

/** Same rule as apps/web/next.config.ts: the root .env fills in what the environment lacks. */
function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      if (!existsSync(candidate)) return;
      for (const line of readFileSync(candidate, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m || m[1] === undefined) continue;
        if (process.env[m[1]] !== undefined) continue;
        process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      pack: { type: "string" },
      models: { type: "string" },
      samples: { type: "string", default: "1" },
      budget: { type: "string" },
      mode: { type: "string", default: "build-arena" },
      name: { type: "string" },
      "fail-under": { type: "string" },
      mock: { type: "boolean", default: false },
      "no-judge": { type: "boolean", default: false },
      store: { type: "string" },
      "no-bundle": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || command === undefined) {
    console.log(USAGE);
    process.exit(command === undefined && !values.help ? 2 : 0);
  }

  // Environment first: everything below reads it lazily.
  loadRootEnv();
  if (values.store !== undefined) process.env["MODEL_LAB_STORE"] = values.store;
  if (values.mock) process.env["MODEL_LAB_MOCK_PROVIDERS"] = "1";
  if (values["no-judge"]) process.env["MODEL_LAB_JUDGE"] = "0";
  process.env["MODEL_LAB_STORE"] ??= "memory";

  // Imported after the environment is settled; these modules are server-only.
  const runService = await import("../lib/server/run-service");
  const { benchmarkPacks } = await import("@model-lab/schemas/fixtures");
  const { loadPackFromDisk } = await import("../lib/server/packs");
  const { FsRunStore, exportBundle, checkProvidersHealth } =
    await import("@model-lab/build-arena-runner");

  if (command === "models") {
    const rows = runService.listEndpointAvailability();
    console.log(`${pad("endpoint", 40)}${pad("deployment", 12)}now`);
    for (const r of rows) {
      const status = r.mocked
        ? "mock (no key in this environment)"
        : r.providerId === "ollama"
          ? "real (local server, keyless)"
          : "real (key present)";
      console.log(`${pad(r.id, 40)}${pad(r.deployment, 12)}${status}`);
    }
    if (values.check) {
      // One read-only model-list request per provider — proves the key works
      // and the endpoint answers; spends nothing.
      const ids = [...new Set(rows.map((r) => r.providerId))];
      const health = await checkProvidersHealth(ids, { timeoutMs: 6000 });
      console.log("");
      console.log(
        `${pad("provider", 14)}${pad("status", 14)}${pad("latency", 9)}${pad("models", 8)}detail`,
      );
      for (const h of health) {
        if (h.status === "unsupported") continue;
        console.log(
          `${pad(h.providerId, 14)}${pad(h.status, 14)}${pad(h.latencyMs != null ? `${h.latencyMs}ms` : "—", 9)}${pad(h.modelsAvailable != null ? String(h.modelsAvailable) : "—", 8)}${h.detail ?? ""}`,
        );
      }
    }
    return;
  }

  if (command === "packs") {
    console.log(`${pad("slug", 26)}${pad("kind", 13)}${pad("version", 9)}${pad("on disk", 9)}name`);
    for (const p of benchmarkPacks) {
      const onDisk = loadPackFromDisk(p.slug) !== null ? "yes" : "no";
      console.log(
        `${pad(p.slug, 26)}${pad(p.kind, 13)}${pad(p.version, 9)}${pad(onDisk, 9)}${p.name}`,
      );
    }
    return;
  }

  if (command !== "run") fail(`Unknown command: ${command}\n\n${USAGE}`, 2);

  if (values.pack === undefined || values.models === undefined) {
    fail(`run needs --pack and --models\n\n${USAGE}`, 2);
  }
  const mode = values.mode;
  if (mode !== "build-arena" && mode !== "verified") {
    fail(`--mode must be build-arena or verified (got ${mode})`, 2);
  }
  const samples = Number.parseInt(values.samples, 10);
  if (!Number.isInteger(samples) || samples < 1 || samples > 10) {
    fail(`--samples must be an integer from 1 to 10 (got ${values.samples})`, 2);
  }
  const budget = values.budget === undefined ? undefined : Number.parseFloat(values.budget);
  if (budget !== undefined && !(budget > 0)) fail(`--budget must be a positive amount`, 2);
  const failUnder =
    values["fail-under"] === undefined ? undefined : Number.parseFloat(values["fail-under"]);
  if (failUnder !== undefined && !(failUnder >= 0 && failUnder <= 1)) {
    fail(`--fail-under must be a ratio between 0 and 1`, 2);
  }
  const endpointIds = values.models
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  let runId: string;
  try {
    ({ runId } = await runService.startRun({
      name: values.name ?? null,
      mode,
      packSlug: values.pack,
      endpointIds,
      samplesPerModel: samples,
      ...(budget !== undefined ? { maxBudgetUsd: budget } : {}),
    }));
  } catch (err) {
    if (err instanceof runService.RunServiceError) fail(err.message, 2);
    throw err;
  }
  console.log(`run ${runId} started · ${endpointIds.length} models · n=${samples} · mode ${mode}`);

  const stream = await runService.subscribeRun(runId);
  if (stream === null) fail(`run ${runId} produced no event stream`, 3);
  let terminal: string | null = null;
  const shown = new Set([
    "run.started",
    "run.partial",
    "run.completed",
    "run.cancelled",
    "model.started",
    "model.failed",
    "model.completed",
    "sample.failed",
    "sample.scored",
    "browser.checks",
    "judge.vote",
    "check.warn",
  ]);
  for await (const event of stream) {
    if (!values.quiet && (shown.has(event.type) || event.level === "warn")) {
      const where = `${event.endpointId ?? "-"}${event.sampleIndex !== null ? `#${event.sampleIndex}` : ""}`;
      console.log(`[${event.type}] ${where} · ${event.message}`);
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.partial" ||
      event.type === "run.cancelled"
    ) {
      terminal = event.type;
    }
  }

  // Summary from the runner's own snapshot — the same data the bundle carries.
  const snapshot = new FsRunStore().loadSnapshot(runId);
  if (snapshot === null) fail(`run ${runId} left no snapshot on disk`, 3);
  const served = snapshot.environment?.servedModels ?? {};
  console.log("");
  console.log(
    `${pad("model", 36)}${pad("capability", 12)}${pad("cost", 9)}${pad("latency", 9)}served as`,
  );
  let minRatio = 1;
  for (const m of snapshot.models) {
    const ratio =
      m.testsPassed != null && m.testsTotal != null && m.testsTotal > 0
        ? m.testsPassed / m.testsTotal
        : null;
    if (ratio !== null) minRatio = Math.min(minRatio, ratio);
    const capability =
      m.testsPassed != null && m.testsTotal != null ? `${m.testsPassed}/${m.testsTotal}` : "—";
    const latency = m.totalLatencyMs != null ? `${(m.totalLatencyMs / 1000).toFixed(1)}s` : "—";
    console.log(
      `${pad(m.endpointId, 36)}${pad(capability, 12)}${pad(usd(m.costUsd), 9)}${pad(latency, 9)}${served[m.endpointId] ?? "—"}`,
    );
  }
  const env = snapshot.environment;
  console.log("");
  console.log(
    `${snapshot.run.status} · ${usd(snapshot.run.costSpentUsd)} of ${usd(snapshot.run.budgetCeilingUsd)} · fingerprint ${snapshot.run.fingerprint}` +
      (env ? ` · node ${env.node} · ${env.chromium ?? "no browser"}` : ""),
  );

  if (!values["no-bundle"]) {
    const bundle = await exportBundle(runId);
    console.log(`bundle: ${bundle.dir}`);
  }

  if (terminal !== "run.completed" || snapshot.run.status !== "completed") {
    fail(`run ended ${snapshot.run.status}`, 3);
  }
  if (failUnder !== undefined && minRatio < failUnder) {
    fail(`capability ratio ${minRatio.toFixed(2)} is below --fail-under ${failUnder}`, 1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(3);
});
