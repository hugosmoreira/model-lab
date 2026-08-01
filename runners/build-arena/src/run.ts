/**
 * The Build Arena executor.
 *
 * Semantics (audit §13.3 + schemas):
 *  - endpoints run in parallel up to `concurrency`; samples per endpoint are
 *    sequential; generation retries: none (first-shot), transport retries per
 *    config, then sample.failed(reason "transport")
 *  - a failed SAMPLE emits sample.failed — it NEVER fails the model or run
 *  - HARD budget stop: when projected spend ≥ maxBudgetUsd, emit budget.status
 *    (warn) then run.partial and cancel all remaining sample generation
 *  - artifact contract: strip ``` fences, require <html or <!DOCTYPE, single
 *    file, ≤2MB — violation → sample.failed(reason "contract")
 *  - full RunEvent stream persisted to events.jsonl; run.json snapshots after
 *    every sample
 */
import type {
  BrowserTestResult,
  Run,
  RunEvent,
  RunEventLevel,
  RunEventType,
  RunModel,
  RunModelStatus,
  RunStatus,
  SampleResult,
} from "@model-lab/schemas";
import { computeFingerprint, promptHash } from "./bundle";
import {
  closeBrowserChecks,
  runBrowserChecks,
  type BrowserChecksOutcome,
} from "./checks/browser-checks";
import { EventBus } from "./event-bus";
import { createProvider } from "./providers";
import { errorMessage } from "./providers/util";
import { FsRunStore } from "./store-fs";
import {
  RUNNER_VERSION,
  type EndpointConfig,
  type GenerateRequest,
  type Provider,
  type RunHandle,
  type RunOutcome,
  type RunnerConfig,
  type StoredArtifact,
} from "./types";

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export type ArtifactExtraction =
  | { ok: true; html: string }
  | { ok: false; violation: string };

/**
 * Normalize raw model output into a single-file HTML artifact.
 * Strips markdown fences, trims prose around the document, enforces the
 * <html|<!DOCTYPE requirement, the 2MB cap, and the no-external-network
 * single-file contract.
 */
export function extractArtifactHtml(raw: string): ArtifactExtraction {
  let text = raw.trim();
  const fences = [...text.matchAll(/```(?:html)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (fences.length > 0) {
    const withDoc = fences
      .map((m) => m[1] ?? "")
      .find((s) => /<!doctype\s+html|<html[\s>]/i.test(s));
    text = (withDoc ?? fences[0]?.[1] ?? text).trim();
  }
  const start = text.search(/<!doctype\s+html|<html[\s>]/i);
  if (start < 0) {
    return { ok: false, violation: "not an HTML document (missing <html or <!DOCTYPE)" };
  }
  let html = text.slice(start);
  const endIdx = html.toLowerCase().lastIndexOf("</html>");
  if (endIdx >= 0) html = html.slice(0, endIdx + "</html>".length);
  if (Buffer.byteLength(html, "utf8") > MAX_ARTIFACT_BYTES) {
    return { ok: false, violation: "artifact exceeds the 2MB single-file cap" };
  }
  if (
    /<script[^>]*\ssrc\s*=\s*["']?https?:/i.test(html) ||
    /<link[^>]*\shref\s*=\s*["']?https?:/i.test(html)
  ) {
    return { ok: false, violation: "external network reference violates the single-file contract" };
  }
  return { ok: true, html };
}

export interface StartRunOptions {
  store?: FsRunStore;
  /** injectable for tests; defaults to the Playwright implementation */
  checksRunner?: (
    html: string,
    opts: { screenshotPath: string; watchdogMs?: number },
  ) => Promise<BrowserChecksOutcome>;
  providerFactory?: (endpoint: EndpointConfig) => Provider;
  browserWatchdogMs?: number;
}

interface GenResult {
  text: string;
  ttftMs: number | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

interface ModelState {
  status: RunModelStatus;
  failedSampleCount: number;
  samplesFinished: number;
  tokensOut: number;
  ttftMs: number | null;
  latencies: number[];
  costUsd: number;
  scores: number[];
  bestPassed: number | null;
  testsTotal: number | null;
  retries: number;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function kindLabel(ep: EndpointConfig): string {
  if (ep.baseKind === "mock") return "mock";
  if (ep.baseKind === "ollama") return "local";
  return "cloud";
}

export function startRun(cfg: RunnerConfig, options: StartRunOptions = {}): RunHandle {
  const store = options.store ?? new FsRunStore();
  const checksRunner = options.checksRunner ?? runBrowserChecks;
  const providerFactory = options.providerFactory ?? createProvider;
  const usingDefaultChecks = options.checksRunner === undefined;

  const bus = new EventBus<RunEvent>();
  const abort = new AbortController();
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const fingerprint = computeFingerprint(cfg);
  const totalPlanned = cfg.endpoints.length * cfg.samplesPerModel;
  const hash = promptHash(cfg.pack.prompt);

  let cancelled = false;
  let budgetStopped = false;
  let spentUsd = 0;
  let samplesDone = 0;
  let samplesScored = 0;
  let samplesFailed = 0;
  const samples: SampleResult[] = [];
  const artifacts: StoredArtifact[] = [];
  const modelStates = new Map<string, ModelState>();

  let pauseGate: Promise<void> | null = null;
  let pauseResolve: (() => void) | null = null;

  const stopRequested = (): boolean => cancelled || budgetStopped;
  const unseeded = (ep: EndpointConfig): boolean => cfg.seed !== null && !ep.supportsSeed;

  const emit = (
    type: RunEventType,
    opts: {
      endpointId?: string | null;
      sampleIndex?: number | null;
      level?: RunEventLevel;
      message: string;
      payload?: Record<string, unknown>;
    },
  ): void => {
    const event: RunEvent = {
      t: new Date().toISOString(),
      type,
      runId: cfg.runId,
      endpointId: opts.endpointId ?? null,
      sampleIndex: opts.sampleIndex ?? null,
      level: opts.level ?? "info",
      message: opts.message,
      payload: opts.payload ?? {},
    };
    try {
      store.appendEvent(cfg.runId, event);
    } catch {
      // persistence is best-effort; the live stream must not die
    }
    bus.emit(event);
  };

  const stateFor = (ep: EndpointConfig): ModelState => {
    let st = modelStates.get(ep.id);
    if (st === undefined) {
      st = {
        status: "queued",
        failedSampleCount: 0,
        samplesFinished: 0,
        tokensOut: 0,
        ttftMs: null,
        latencies: [],
        costUsd: 0,
        scores: [],
        bestPassed: null,
        testsTotal: null,
        retries: 0,
      };
      modelStates.set(ep.id, st);
    }
    return st;
  };

  const toRunModel = (ep: EndpointConfig): RunModel => {
    const st = stateFor(ep);
    const meanLatency =
      st.latencies.length > 0
        ? Math.round(st.latencies.reduce((a, b) => a + b, 0) / st.latencies.length)
        : null;
    const meanScore =
      st.scores.length > 0
        ? round1(st.scores.reduce((a, b) => a + b, 0) / st.scores.length)
        : null;
    return {
      runId: cfg.runId,
      endpointId: ep.id,
      status: st.status,
      failedSampleCount: st.failedSampleCount,
      progressPct: Math.round((st.samplesFinished / cfg.samplesPerModel) * 100),
      currentTask: null,
      tokensOut: st.tokensOut,
      ttftMs: st.ttftMs,
      totalLatencyMs: meanLatency,
      costUsd: round4(st.costUsd),
      visualScore: meanScore !== null ? { value: meanScore, n: st.scores.length } : null,
      testsPassed: st.bestPassed,
      testsTotal: st.testsTotal,
      retries: st.retries,
      unseeded: unseeded(ep),
      flag:
        st.failedSampleCount > 0
          ? `${st.failedSampleCount} sample fail`
          : st.bestPassed !== null && st.testsTotal !== null && st.bestPassed === st.testsTotal
            ? "all tests pass"
            : null,
    };
  };

  const saveSnapshot = (status: RunStatus): void => {
    const terminal = status !== "running" && status !== "queued";
    const run: Run = {
      id: cfg.runId,
      fingerprint,
      name: cfg.name,
      mode: cfg.mode,
      status,
      pack: { slug: cfg.pack.slug, version: cfg.pack.version },
      promptHash: hash,
      samplesPerModel: cfg.samplesPerModel,
      modelCount: cfg.endpoints.length,
      budgetCeilingUsd: cfg.maxBudgetUsd,
      costSpentUsd: round4(spentUsd),
      estCostRangeUsd: null,
      startedAt: startedAtIso,
      completedAt: terminal ? new Date().toISOString() : null,
      elapsedSec: Math.round((Date.now() - startedAtMs) / 1000),
      runnerVersion: RUNNER_VERSION,
      gitCommit: null,
      compositeWeighting: { browser: 50, visual: 35, efficiency: 15 },
      verdict: null,
      judgeReversalCount: 0,
    };
    try {
      store.saveSnapshot(cfg.runId, {
        run,
        models: cfg.endpoints.map(toRunModel),
        samples: [...samples],
        artifacts: [...artifacts],
        config: cfg,
      });
    } catch {
      // snapshot persistence is best-effort
    }
  };

  const tokenCost = (ep: EndpointConfig, tokensIn: number, tokensOut: number): number => {
    const priceIn = ep.priceInPerMtokUsd ?? 0; // null = free/local → $0
    const priceOut = ep.priceOutPerMtokUsd ?? 0;
    return (tokensIn * priceIn + tokensOut * priceOut) / 1_000_000;
  };

  const streamOnce = async (
    provider: Provider,
    ep: EndpointConfig,
    sampleIndex: number,
    injectFailure: boolean,
  ): Promise<GenResult> => {
    const started = Date.now();
    let text = "";
    let ttftMs: number | null = null;
    let tokensIn = 0;
    let tokensOut = 0;
    const req: GenerateRequest = {
      prompt: cfg.pack.prompt,
      model: ep.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxOutputTokens,
      signal: abort.signal,
      sampleIndex,
    };
    if (injectFailure) req.injectFailure = true;
    if (cfg.seed !== null && ep.supportsSeed) req.seed = cfg.seed;
    for await (const chunk of provider.generate(req)) {
      if (chunk.type === "delta") {
        if (ttftMs === null) ttftMs = Date.now() - started;
        text += chunk.text;
      } else {
        tokensIn = chunk.tokensIn;
        tokensOut = chunk.tokensOut;
      }
    }
    if (tokensOut === 0 && text.length > 0) tokensOut = Math.ceil(text.length / 4);
    return { text, ttftMs, latencyMs: Date.now() - started, tokensIn, tokensOut };
  };

  const recordFailure = (
    ep: EndpointConfig,
    st: ModelState,
    sampleIndex: number,
    reason: "transport" | "contract" | "render.failed",
    message: string,
    gen: GenResult | null,
    checks: BrowserTestResult[],
    costUsd: number,
    hasArtifact: boolean,
  ): void => {
    samplesFailed += 1;
    st.failedSampleCount += 1;
    samples.push({
      runId: cfg.runId,
      endpointId: ep.id,
      sampleIndex,
      globalIndex: samples.length + 1,
      status: "failed",
      score: { failed: true },
      primaryScorer: "browser",
      costUsd: round4(costUsd),
      latencyMs: gen?.latencyMs ?? null,
      ttftMs: gen?.ttftMs ?? null,
      seed: cfg.seed !== null && ep.supportsSeed ? cfg.seed : null,
      hasArtifact,
      tokensOut: gen?.tokensOut ?? null,
      rawExcerpt: (gen?.text ?? "").slice(0, 400),
      scorerTrace: checks,
      judgeReversed: false,
      humanReviewed: false,
      humanNote: null,
    });
    emit("sample.failed", {
      endpointId: ep.id,
      sampleIndex,
      level: "error",
      message,
      payload: { reason },
    });
  };

  /** budget.status after every sample; HARD stop on projected overrun. */
  const finishSample = (): void => {
    samplesDone += 1;
    const remaining = totalPlanned - samplesDone;
    const avg = samplesDone > 0 ? spentUsd / samplesDone : 0;
    const projected = spentUsd + avg * remaining;
    const pct =
      cfg.maxBudgetUsd > 0 ? Math.min(999, Math.round((spentUsd / cfg.maxBudgetUsd) * 100)) : 0;
    if (
      !budgetStopped &&
      !cancelled &&
      cfg.maxBudgetUsd > 0 &&
      remaining > 0 &&
      (spentUsd >= cfg.maxBudgetUsd || projected >= cfg.maxBudgetUsd)
    ) {
      budgetStopped = true;
      emit("budget.status", {
        level: "warn",
        message: `projected $${projected.toFixed(2)} ≥ budget $${cfg.maxBudgetUsd.toFixed(2)} — hard stop`,
        payload: { spentUsd: round4(spentUsd), projectedUsd: round4(projected), ceilingUsd: cfg.maxBudgetUsd },
      });
      emit("run.partial", {
        level: "warn",
        message: `${samplesDone}/${totalPlanned} samples · $${spentUsd.toFixed(2)} — budget ceiling reached`,
        payload: { samplesDone, totalPlanned },
      });
      abort.abort(); // cancel remaining/in-flight sample generation
    } else {
      emit("budget.status", {
        message: `$${spentUsd.toFixed(2)} spent · ${pct}% of ceiling`,
        payload: { spentUsd: round4(spentUsd), projectedUsd: round4(projected), ceilingUsd: cfg.maxBudgetUsd },
      });
    }
    saveSnapshot("running");
  };

  const runSample = async (
    provider: Provider,
    ep: EndpointConfig,
    st: ModelState,
    s: number,
  ): Promise<void> => {
    emit("sample.started", {
      endpointId: ep.id,
      sampleIndex: s,
      message: `${s}/${cfg.samplesPerModel} · retry policy: none (first-shot)`,
    });
    const injectFailure =
      cfg.failSample !== undefined &&
      cfg.failSample.endpointId === ep.id &&
      cfg.failSample.sampleIndex === s;

    // -- generation with transport retry --------------------------------
    let gen: GenResult | null = null;
    let transportError = "";
    const maxAttempts = 1 + Math.max(0, cfg.transportRetries);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        gen = await streamOnce(provider, ep, s, injectFailure);
        break;
      } catch (err) {
        if (stopRequested()) return; // aborted by cancel/budget — not a sample failure
        transportError = errorMessage(err);
        if (attempt < maxAttempts) st.retries += 1;
      }
    }
    if (gen === null) {
      recordFailure(ep, st, s, "transport", `sample ${s}: transport failure — ${transportError}`, null, [], 0, false);
      st.samplesFinished += 1;
      finishSample();
      return;
    }

    // -- cost + usage ---------------------------------------------------
    const cost = tokenCost(ep, gen.tokensIn, gen.tokensOut);
    spentUsd += cost;
    st.costUsd += cost;
    st.tokensOut += gen.tokensOut;
    if (st.ttftMs === null) st.ttftMs = gen.ttftMs;
    st.latencies.push(gen.latencyMs);
    const toksPerSec =
      gen.latencyMs > 0 ? Math.round(gen.tokensOut / (gen.latencyMs / 1000)) : gen.tokensOut;
    emit("token.usage", {
      endpointId: ep.id,
      sampleIndex: s,
      message: `${(gen.tokensOut / 1000).toFixed(1)}k out · ${toksPerSec} tok/s`,
      // ttftMs: request start → first streamed delta (measured in streamOnce)
      payload: { tokensIn: gen.tokensIn, tokensOut: gen.tokensOut, toksPerSec, ttftMs: gen.ttftMs },
    });

    // -- immutable raw output ------------------------------------------
    try {
      store.writeRaw(cfg.runId, ep.id, s, gen.text);
    } catch {
      // raw persistence failure never kills the sample
    }

    // -- artifact contract ---------------------------------------------
    const extracted = extractArtifactHtml(gen.text);
    if (!extracted.ok) {
      recordFailure(ep, st, s, "contract", `sample ${s}: contract violation — ${extracted.violation}`, gen, [], cost, false);
      st.samplesFinished += 1;
      finishSample();
      return;
    }

    st.status = "testing";
    const written = store.writeArtifact(cfg.runId, ep.id, s, extracted.html);
    emit("artifact.created", {
      endpointId: ep.id,
      sampleIndex: s,
      level: "success",
      message: `${written.filename} · ${written.sizeKb}kb`,
      payload: { path: written.relPath, sizeKb: written.sizeKb },
    });

    // -- browser checks -------------------------------------------------
    const screenshotPath = store.screenshotPath(cfg.runId, ep.id, s);
    let outcome: BrowserChecksOutcome;
    try {
      outcome = await checksRunner(extracted.html, {
        screenshotPath,
        ...(options.browserWatchdogMs !== undefined
          ? { watchdogMs: options.browserWatchdogMs }
          : {}),
      });
    } catch (err) {
      outcome = {
        checks: [],
        consoleLines: [],
        screenshotSaved: false,
        degraded: false,
      };
      emit("check.warn", {
        endpointId: ep.id,
        sampleIndex: s,
        level: "warn",
        message: `check runner crashed: ${errorMessage(err)}`,
        payload: {},
      });
    }

    for (const check of outcome.checks) {
      const type: RunEventType =
        check.status === "passed"
          ? "check.passed"
          : check.status === "failed"
            ? "check.failed"
            : "check.warn";
      const level: RunEventLevel =
        check.status === "passed" ? "success" : check.status === "failed" ? "error" : "warn";
      emit(type, {
        endpointId: ep.id,
        sampleIndex: s,
        level,
        message: check.note === "" ? check.name : `${check.name} — ${check.note}`,
        payload: { check: check.name, status: check.status, durationMs: check.durationMs },
      });
    }
    const passed = outcome.checks.filter((c) => c.status === "passed").length;
    const failedChecks = outcome.checks.filter((c) => c.status === "failed").length;
    const total = outcome.checks.length;
    emit("browser.checks", {
      endpointId: ep.id,
      sampleIndex: s,
      level: failedChecks > 0 ? "warn" : "success",
      message: `${passed}/${total} passed`,
      payload: { passed, total, failed: failedChecks },
    });
    if (total > 0) {
      st.testsTotal = total;
      st.bestPassed = Math.max(st.bestPassed ?? 0, passed);
    }

    const renderFailed = outcome.checks.some(
      (c) =>
        (c.name === "canvas.renders" || c.name === "page.loads" || c.name === "html.parses") &&
        c.status === "failed",
    );
    artifacts.push({
      endpointId: ep.id,
      sampleIndex: s,
      path: written.relPath,
      filename: written.filename,
      sizeKb: written.sizeKb,
      renderOk: !renderFailed,
      screenshotPath: outcome.screenshotSaved ? screenshotPath : null,
      consoleLines: outcome.consoleLines,
      checks: outcome.checks,
    });

    st.status = "scoring";
    if (renderFailed) {
      const firstFail = outcome.checks.find((c) => c.status === "failed");
      recordFailure(
        ep, st, s, "render.failed",
        `sample ${s}: ${firstFail?.note ?? "render failed"}`,
        gen, outcome.checks, cost, true,
      );
    } else {
      const score = outcome.degraded || total === 0 ? null : round1((passed / total) * 10);
      if (score !== null) st.scores.push(score);
      samplesScored += 1;
      samples.push({
        runId: cfg.runId,
        endpointId: ep.id,
        sampleIndex: s,
        globalIndex: samples.length + 1,
        status: "scored",
        score: score !== null ? { value: score } : null,
        primaryScorer: "browser",
        costUsd: round4(cost),
        latencyMs: gen.latencyMs,
        ttftMs: gen.ttftMs,
        seed: cfg.seed !== null && ep.supportsSeed ? cfg.seed : null,
        hasArtifact: true,
        tokensOut: gen.tokensOut,
        rawExcerpt: gen.text.slice(0, 400),
        scorerTrace: outcome.checks,
        judgeReversed: false,
        humanReviewed: false,
        humanNote: null,
      });
      emit("sample.scored", {
        endpointId: ep.id,
        sampleIndex: s,
        level: "success",
        message:
          score !== null
            ? `${passed}/${total} browser tests · score ${score.toFixed(1)}`
            : `sample ${s} stored — checks skipped, score unavailable`,
      });
    }
    st.status = "generating";
    st.samplesFinished += 1;
    finishSample();
  };

  const runEndpoint = async (ep: EndpointConfig): Promise<void> => {
    const st = stateFor(ep);
    let provider: Provider;
    try {
      provider = providerFactory(ep);
    } catch (err) {
      st.status = "failed";
      emit("model.failed", {
        endpointId: ep.id,
        level: "error",
        message: `${ep.modelId} · provider setup failed: ${errorMessage(err)}`,
      });
      return;
    }
    st.status = "generating";
    emit("model.started", {
      endpointId: ep.id,
      message: `${ep.modelId} · ${ep.providerId} · ${kindLabel(ep)}${unseeded(ep) ? " · unseeded" : ""}`,
    });
    for (let s = 1; s <= cfg.samplesPerModel; s++) {
      if (pauseGate !== null) await pauseGate;
      if (stopRequested()) return;
      await runSample(provider, ep, st, s);
    }
    st.status = "completed";
    const scored = st.samplesFinished - st.failedSampleCount;
    emit("model.completed", {
      endpointId: ep.id,
      level: st.failedSampleCount > 0 ? "warn" : "success",
      message:
        st.failedSampleCount > 0
          ? `${scored}/${cfg.samplesPerModel} scored · ${st.failedSampleCount} fail preserved`
          : `${cfg.samplesPerModel}/${cfg.samplesPerModel} samples · $${st.costUsd.toFixed(2)}`,
    });
  };

  const main = async (): Promise<RunOutcome> => {
    emit("run.started", {
      message: `${cfg.runId} · ${cfg.endpoints.length} models · n=${cfg.samplesPerModel} · budget $${cfg.maxBudgetUsd.toFixed(2)}`,
      payload: { fingerprint },
    });
    for (const ep of cfg.endpoints) {
      stateFor(ep);
      emit("model.queued", { endpointId: ep.id, message: `${ep.modelId} · ${ep.providerId}` });
    }
    saveSnapshot("running");

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(cfg.concurrency, cfg.endpoints.length));
    const workers: Array<Promise<void>> = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(
        (async () => {
          for (;;) {
            if (stopRequested()) return;
            const idx = cursor;
            cursor += 1;
            const ep = cfg.endpoints[idx];
            if (ep === undefined) return;
            await runEndpoint(ep);
          }
        })(),
      );
    }
    await Promise.all(workers);
    if (usingDefaultChecks) await closeBrowserChecks().catch(() => undefined);

    const status: RunOutcome["status"] = cancelled
      ? "cancelled"
      : budgetStopped
        ? "partial"
        : "completed";
    if (status === "cancelled") {
      emit("run.cancelled", {
        level: "warn",
        message: `${samplesDone}/${totalPlanned} samples · $${spentUsd.toFixed(2)} — cancelled`,
      });
    } else if (status === "completed") {
      emit("run.completed", {
        level: "success",
        message: `${samplesDone} samples · $${spentUsd.toFixed(2)}${samplesFailed > 0 ? ` · ${samplesFailed} sample fail preserved` : ""}`,
      });
    }
    // run.partial was already emitted at the moment of the budget stop
    saveSnapshot(status === "completed" ? "completed" : status === "partial" ? "partial" : "cancelled");
    bus.close();
    return { status, spentUsd: round4(spentUsd), samplesScored, samplesFailed };
  };

  const done = main().catch((err) => {
    emit("run.cancelled", { level: "error", message: `runner crashed: ${errorMessage(err)}` });
    saveSnapshot("failed");
    bus.close();
    return {
      status: "cancelled" as const,
      spentUsd: round4(spentUsd),
      samplesScored,
      samplesFailed,
    };
  });

  return {
    runId: cfg.runId,
    events: bus,
    cancel: (): void => {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
      if (pauseResolve !== null) pauseResolve();
      pauseGate = null;
      pauseResolve = null;
    },
    pause: (): void => {
      if (pauseGate === null) {
        pauseGate = new Promise<void>((resolve) => {
          pauseResolve = resolve;
        });
      }
    },
    resume: (): void => {
      if (pauseResolve !== null) pauseResolve();
      pauseGate = null;
      pauseResolve = null;
    },
    done,
  };
}
