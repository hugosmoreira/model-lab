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
 *  - TRUNCATION (finish_reason "length") is a harness limit, not a model
 *    result: it emits its own check.warn and is named in the failure message,
 *    so a cut-off answer is never reported as a contract violation or as a
 *    model that shipped a broken document
 *  - full RunEvent stream persisted to events.jsonl; run.json snapshots after
 *    every sample
 *  - verified mode (Phase 5): per endpoint iterate the pack's TASK list
 *    (sampleIndex = task index, samplesPerModel=1 per task in the MVP), skip
 *    artifact extraction and browser checks entirely, and score objectively
 *    (exact-match / contains / json-field → binary 10/0). Unevaluable output
 *    → sample.failed(reason "contract"). Events/persistence flow unchanged.
 */
import type {
  BrowserTestResult,
  JudgePairResult,
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
  capabilityChecks,
  closeBrowserChecks,
  failedGates,
  runBrowserChecks,
  unmeasuredGates,
  type BrowserChecksOutcome,
} from "./checks/browser-checks";
import { scoreObjective } from "./checks/objective";
import { EventBus } from "./event-bus";
import { runJudgePhase } from "./judge";
import { createProvider } from "./providers";
import { errorMessage } from "./providers/util";
import { FsRunStore } from "./store-fs";
import {
  RUNNER_VERSION,
  type EndpointConfig,
  type FinishReason,
  type GenerateRequest,
  type Provider,
  type RunHandle,
  type RunOutcome,
  type RunnerConfig,
  type StoredArtifact,
  type Task,
} from "./types";

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export type ArtifactExtraction = { ok: true; html: string } | { ok: false; violation: string };

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
  /** null when the provider reported none */
  finishReason: FinishReason | null;
  /** hidden reasoning tokens billed inside tokensOut */
  reasoningTokens: number;
}

/** "16.0k" / "950" — token counts read the same everywhere they surface. */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * A truncated generation is OUR fault, not the model's: the answer was cut off
 * at the configured cap. Phrase it so a reader never mistakes it for the model
 * writing a broken document, and name the reasoning spend when that is what
 * consumed the budget.
 */
function truncationNote(gen: GenResult, capTokens: number): string {
  const reasoning =
    gen.reasoningTokens > 0 ? ` — ${fmtTokens(gen.reasoningTokens)} of it on hidden reasoning` : "";
  return `output truncated at the ${fmtTokens(capTokens)}-token cap (${fmtTokens(gen.tokensOut)} out${reasoning})`;
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
  /** Verified runs iterate the task list; sampleIndex = 1-based task index. */
  const verified = cfg.mode === "verified";
  const tasks: Task[] = verified ? (cfg.pack.tasks ?? []) : [];
  const samplesPerEndpoint = verified ? tasks.length : cfg.samplesPerModel;
  const totalPlanned = cfg.endpoints.length * samplesPerEndpoint;
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
  /** LLM-judge phase output (build-arena + config.judge only) */
  let judgePairs: JudgePairResult[] = [];
  let judgeReversalCount = 0;
  let judgeRan = false;

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
      st.scores.length > 0 ? round1(st.scores.reduce((a, b) => a + b, 0) / st.scores.length) : null;
    return {
      runId: cfg.runId,
      endpointId: ep.id,
      status: st.status,
      failedSampleCount: st.failedSampleCount,
      progressPct: Math.round((st.samplesFinished / Math.max(1, samplesPerEndpoint)) * 100),
      currentTask: null,
      tokensOut: st.tokensOut,
      ttftMs: st.ttftMs,
      totalLatencyMs: meanLatency,
      costUsd: round4(st.costUsd),
      visualScore: meanScore !== null ? { value: meanScore, n: st.scores.length } : null,
      // The runner never produces a visual judgement: this is a browser
      // result (or task accuracy in verified mode), and it is labelled so.
      visualSource: meanScore !== null ? (cfg.mode === "verified" ? "objective" : "browser") : null,
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
      // verified runs: per-model sample count = task count (1 sample per task)
      samplesPerModel: samplesPerEndpoint,
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
      judgeReversalCount,
    };
    try {
      store.saveSnapshot(cfg.runId, {
        run,
        models: cfg.endpoints.map(toRunModel),
        samples: [...samples],
        artifacts: [...artifacts],
        config: cfg,
        judgePairs: [...judgePairs],
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
    task?: Task,
    answerWrong?: boolean,
  ): Promise<GenResult> => {
    const started = Date.now();
    let text = "";
    let ttftMs: number | null = null;
    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason: FinishReason | null = null;
    let reasoningTokens = 0;
    const req: GenerateRequest = {
      prompt: task !== undefined ? task.prompt : cfg.pack.prompt,
      model: ep.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxOutputTokens,
      signal: abort.signal,
      sampleIndex,
    };
    if (injectFailure) req.injectFailure = true;
    if (task !== undefined) req.task = task;
    if (answerWrong === true) req.answerWrong = true;
    if (cfg.seed !== null && ep.supportsSeed) req.seed = cfg.seed;
    for await (const chunk of provider.generate(req)) {
      if (chunk.type === "delta") {
        if (ttftMs === null) ttftMs = Date.now() - started;
        text += chunk.text;
      } else {
        tokensIn = chunk.tokensIn;
        tokensOut = chunk.tokensOut;
        finishReason = chunk.finishReason ?? null;
        reasoningTokens = chunk.reasoningTokens ?? 0;
      }
    }
    if (tokensOut === 0 && text.length > 0) tokensOut = Math.ceil(text.length / 4);
    return {
      text,
      ttftMs,
      latencyMs: Date.now() - started,
      tokensIn,
      tokensOut,
      finishReason,
      reasoningTokens,
    };
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
      primaryScorer: verified ? "objective" : "browser",
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
        payload: {
          spentUsd: round4(spentUsd),
          projectedUsd: round4(projected),
          ceilingUsd: cfg.maxBudgetUsd,
        },
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
        payload: {
          spentUsd: round4(spentUsd),
          projectedUsd: round4(projected),
          ceilingUsd: cfg.maxBudgetUsd,
        },
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
      message: `${s}/${samplesPerEndpoint} · retry policy: none (first-shot)`,
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
      recordFailure(
        ep,
        st,
        s,
        "transport",
        `sample ${s}: transport failure — ${transportError}`,
        null,
        [],
        0,
        false,
      );
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
    const reasoningNote =
      gen.reasoningTokens > 0 ? ` · ${fmtTokens(gen.reasoningTokens)} reasoning` : "";
    emit("token.usage", {
      endpointId: ep.id,
      sampleIndex: s,
      message: `${(gen.tokensOut / 1000).toFixed(1)}k out · ${toksPerSec} tok/s${reasoningNote}`,
      // ttftMs: request start → first streamed delta (measured in streamOnce)
      payload: { tokensIn: gen.tokensIn, tokensOut: gen.tokensOut, toksPerSec, ttftMs: gen.ttftMs },
    });
    /**
     * Truncation is a harness limit, not a model result. Surface it loudly and
     * separately from the checks so a cut-off build is never read as a model
     * that wrote a broken document.
     */
    const truncated = gen.finishReason === "length";
    if (truncated) {
      emit("check.warn", {
        endpointId: ep.id,
        sampleIndex: s,
        level: "warn",
        message: `${truncationNote(gen, cfg.maxOutputTokens)} — raise maxOutputTokens for a fair comparison`,
        payload: { truncated: true, reasoningTokens: gen.reasoningTokens },
      });
    }

    // -- immutable raw output ------------------------------------------
    try {
      store.writeRaw(cfg.runId, ep.id, s, gen.text);
    } catch {
      // raw persistence failure never kills the sample
    }

    // -- artifact contract ---------------------------------------------
    const extracted = extractArtifactHtml(gen.text);
    if (!extracted.ok) {
      // A truncated answer isn't a contract violation — say what actually happened.
      const why = truncated
        ? `${truncationNote(gen, cfg.maxOutputTokens)}${gen.text.trim() === "" ? " — no answer text at all" : ""}`
        : `contract violation — ${extracted.violation}`;
      recordFailure(ep, st, s, "contract", `sample ${s}: ${why}`, gen, [], cost, false);
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
    /**
     * SCORE DERIVATION (check taxonomy).
     *
     * Only CAPABILITY checks are scored — "did the model build what the brief
     * asked for". GATE checks are correctness preconditions: one failed gate
     * means the artifact is broken, so the headline score is 0 and the reason
     * names the gate. DIAGNOSTIC checks (screenshot.captured, fps.stable,
     * a11y.contrast) measure the harness and the rendering environment, so
     * they are reported and never scored — counting them is how an artifact
     * that drew nothing at all used to land level with a working build.
     *
     * A gate can also come back "warn": the measurement itself failed, so the
     * gate has no verdict. That is NOT a pass and NOT a zero — it makes the
     * sample noSignal (score null), the same state a missing browser produces.
     * Zeroing on a harness fault would look like a legitimate result and quietly
     * corrupt the leaderboard; null says "we have nothing to report".
     */
    const capability = capabilityChecks(outcome.checks);
    const gatesFailed = failedGates(outcome.checks);
    const gatesUnmeasured = unmeasuredGates(outcome.checks);
    const gatesOk = gatesFailed.length === 0 && gatesUnmeasured.length === 0;
    const capTotal = capability.length;
    const capPassed = gatesOk ? capability.filter((c) => c.status === "passed").length : 0;
    const capSkipped = capability.filter((c) => c.status === "skipped").length;
    const firstGate = gatesFailed[0];
    const firstUnmeasured = gatesUnmeasured[0];
    /**
     * no capability signal at all: browser missing, the runner never ran, or a
     * gate could not be measured (see unmeasuredGates — fail closed).
     */
    const noSignal =
      outcome.degraded ||
      capTotal === 0 ||
      capSkipped === capTotal ||
      firstUnmeasured !== undefined;
    emit("browser.checks", {
      endpointId: ep.id,
      sampleIndex: s,
      level: gatesOk ? "success" : "warn",
      message: gatesOk
        ? `capability ${capPassed}/${capTotal} · gates ok`
        : firstGate !== undefined
          ? `gate failed: ${firstGate.name}${firstGate.note ? ` — ${firstGate.note}` : ""}`
          : `gate unresolved: ${firstUnmeasured?.name ?? "gate"}${firstUnmeasured?.note ? ` — ${firstUnmeasured.note}` : ""}`,
      payload: {
        passed: capPassed,
        total: capTotal,
        failed: capability.filter((c) => c.status === "failed").length,
        gatesOk,
        gatesFailed: gatesFailed.map((c) => c.name),
        gatesUnmeasured: gatesUnmeasured.map((c) => c.name),
      },
    });
    if (capTotal > 0 && !noSignal) {
      st.testsTotal = capTotal;
      st.bestPassed = Math.max(st.bestPassed ?? 0, capPassed);
    }

    /**
     * A sample is FAILED (not merely low-scoring) when the artifact never
     * became a running document or drew nothing — the render gates. A dirty
     * console is also a gate, but it zeroes the score rather than voiding the
     * sample: an artifact that throws once and still renders is worth keeping.
     */
    const renderGateFailure = outcome.checks.find(
      (c) =>
        (c.name === "html.parses" || c.name === "page.loads" || c.name === "canvas.renders") &&
        c.status === "failed",
    );
    const renderFailed = renderGateFailure !== undefined;
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
      // Name the RENDER gate, not merely the first failed gate: "console.clean
      // — foo is not defined" would not explain why the sample was voided.
      // Truncation explains a render failure; without it the log reads as if
      // the model shipped a broken raycaster.
      const named =
        renderGateFailure === undefined
          ? "render failed"
          : `${renderGateFailure.name} — ${renderGateFailure.note}`;
      const detail = `${named}${truncated ? ` — ${truncationNote(gen, cfg.maxOutputTokens)}` : ""}`;
      recordFailure(
        ep,
        st,
        s,
        "render.failed",
        `sample ${s}: ${detail}`,
        gen,
        outcome.checks,
        cost,
        true,
      );
    } else {
      /**
       * visualScore is the capability pass-ratio on a 0-10 scale, zeroed by a
       * failed gate. NOTE: the field still conflates "browser checks" with
       * "visual quality" and is scheduled to be split into a browser score and
       * a judge-supplied visual score; until then it follows the capability
       * ratio so it can never again reward an artifact that drew nothing.
       */
      const score = noSignal ? null : round1((capPassed / capTotal) * 10);
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
        level: score === null || !gatesOk ? "warn" : "success",
        message:
          firstUnmeasured !== undefined
            ? `sample ${s} stored — no score: ${firstUnmeasured.name} could not be measured (${firstUnmeasured.note})`
            : score === null
              ? `sample ${s} stored — checks skipped, score unavailable`
              : gatesOk
                ? `${capPassed}/${capTotal} capability checks · score ${score.toFixed(1)}`
                : `score 0.0 — gate failed: ${firstGate?.name ?? "gate"}${firstGate?.note ? ` (${firstGate.note})` : ""}`,
      });
    }
    st.status = "generating";
    st.samplesFinished += 1;
    finishSample();
  };

  /**
   * Verified mode: one sample = one task. No artifact extraction, no browser
   * checks — the raw output is scored objectively (binary 10/0) with a
   * one-entry scorer trace. Unevaluable output → sample.failed("contract").
   */
  const runVerifiedSample = async (
    provider: Provider,
    ep: EndpointConfig,
    st: ModelState,
    s: number,
    task: Task,
    answerWrong: boolean,
  ): Promise<void> => {
    emit("sample.started", {
      endpointId: ep.id,
      sampleIndex: s,
      message: `${s}/${samplesPerEndpoint} · task ${task.id} · ${task.scorer}`,
    });

    // -- generation with transport retry --------------------------------
    let gen: GenResult | null = null;
    let transportError = "";
    const maxAttempts = 1 + Math.max(0, cfg.transportRetries);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        gen = await streamOnce(provider, ep, s, false, task, answerWrong);
        break;
      } catch (err) {
        if (stopRequested()) return; // aborted by cancel/budget — not a sample failure
        transportError = errorMessage(err);
        if (attempt < maxAttempts) st.retries += 1;
      }
    }
    if (gen === null) {
      recordFailure(
        ep,
        st,
        s,
        "transport",
        `sample ${s}: transport failure — ${transportError}`,
        null,
        [],
        0,
        false,
      );
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
      message: `${(gen.tokensOut / 1000).toFixed(1)}k out · ${toksPerSec} tok/s${
        gen.reasoningTokens > 0 ? ` · ${fmtTokens(gen.reasoningTokens)} reasoning` : ""
      }`,
      payload: { tokensIn: gen.tokensIn, tokensOut: gen.tokensOut, toksPerSec, ttftMs: gen.ttftMs },
    });
    const truncated = gen.finishReason === "length";
    if (truncated) {
      emit("check.warn", {
        endpointId: ep.id,
        sampleIndex: s,
        level: "warn",
        message: `${truncationNote(gen, cfg.maxOutputTokens)} — raise maxOutputTokens for a fair comparison`,
        payload: { truncated: true, reasoningTokens: gen.reasoningTokens },
      });
    }

    // -- immutable raw output ------------------------------------------
    try {
      store.writeRaw(cfg.runId, ep.id, s, gen.text);
    } catch {
      // raw persistence failure never kills the sample
    }

    // -- objective scoring ---------------------------------------------
    st.status = "scoring";
    const outcome = scoreObjective(task, gen.text);
    if (!outcome.ok) {
      // Same rule as build-arena: a cut-off answer is reported as truncation.
      const why = truncated
        ? truncationNote(gen, cfg.maxOutputTokens)
        : `contract violation — ${outcome.violation}`;
      recordFailure(
        ep,
        st,
        s,
        "contract",
        `sample ${s}: ${why}`,
        gen,
        [outcome.trace],
        cost,
        false,
      );
    } else {
      // tasks passed / task total (RunModel "TESTS n/m" display)
      st.testsTotal = samplesPerEndpoint;
      st.bestPassed = (st.bestPassed ?? 0) + (outcome.passed ? 1 : 0);
      st.scores.push(outcome.score);
      samplesScored += 1;
      samples.push({
        runId: cfg.runId,
        endpointId: ep.id,
        sampleIndex: s,
        globalIndex: samples.length + 1,
        status: "scored",
        score: { value: outcome.score },
        primaryScorer: "objective",
        costUsd: round4(cost),
        latencyMs: gen.latencyMs,
        ttftMs: gen.ttftMs,
        seed: cfg.seed !== null && ep.supportsSeed ? cfg.seed : null,
        hasArtifact: false,
        tokensOut: gen.tokensOut,
        rawExcerpt: gen.text.slice(0, 400),
        scorerTrace: [outcome.trace],
        judgeReversed: false,
        humanReviewed: false,
        humanNote: null,
      });
      emit(outcome.passed ? "check.passed" : "check.failed", {
        endpointId: ep.id,
        sampleIndex: s,
        level: outcome.passed ? "success" : "error",
        message: `${outcome.trace.name} — ${outcome.trace.note}`,
        payload: {
          check: outcome.trace.name,
          status: outcome.trace.status,
          durationMs: outcome.trace.durationMs,
        },
      });
      emit("sample.scored", {
        endpointId: ep.id,
        sampleIndex: s,
        level: outcome.passed ? "success" : "warn",
        message: `task ${task.id} · objective score ${outcome.score.toFixed(1)}`,
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
    // mock demo path: the FIRST endpoint answers its LAST task wrong (0-score)
    const firstEndpoint = cfg.endpoints[0]?.id === ep.id;
    for (let s = 1; s <= samplesPerEndpoint; s++) {
      if (pauseGate !== null) await pauseGate;
      if (stopRequested()) return;
      if (verified) {
        const task = tasks[s - 1];
        if (task === undefined) continue; // defensive — validation prevents this
        await runVerifiedSample(provider, ep, st, s, task, firstEndpoint && s === tasks.length);
      } else {
        await runSample(provider, ep, st, s);
      }
    }
    st.status = "completed";
    const scored = st.samplesFinished - st.failedSampleCount;
    emit("model.completed", {
      endpointId: ep.id,
      level: st.failedSampleCount > 0 ? "warn" : "success",
      message:
        st.failedSampleCount > 0
          ? `${scored}/${samplesPerEndpoint} scored · ${st.failedSampleCount} fail preserved`
          : `${samplesPerEndpoint}/${samplesPerEndpoint} samples · $${st.costUsd.toFixed(2)}`,
    });
  };

  const main = async (): Promise<RunOutcome> => {
    emit("run.started", {
      message: verified
        ? `${cfg.runId} · ${cfg.endpoints.length} models · ${tasks.length} tasks · budget $${cfg.maxBudgetUsd.toFixed(2)}`
        : `${cfg.runId} · ${cfg.endpoints.length} models · n=${cfg.samplesPerModel} · budget $${cfg.maxBudgetUsd.toFixed(2)}`,
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
    if (usingDefaultChecks && !verified) await closeBrowserChecks().catch(() => undefined);

    // -- LLM-judge phase: after all samples, before run.completed -----------
    // Gated: build-arena mode only, config.judge set, run not cancelled or
    // budget-stopped. Judge errors NEVER kill the run (check.warn + skip).
    if (cfg.mode === "build-arena" && cfg.judge !== undefined && !stopRequested()) {
      judgeRan = true;
      try {
        const judged = await runJudgePhase({
          cfg,
          judge: cfg.judge,
          artifacts,
          samples,
          artifactRoot: store.root,
          emit,
          getSpentUsd: () => spentUsd,
          addSpendUsd: (usd) => {
            spentUsd += usd;
          },
          shouldStop: stopRequested,
          signal: abort.signal,
        });
        judgePairs = judged.judgePairs;
        judgeReversalCount = judged.reversalCount;
      } catch (err) {
        emit("check.warn", {
          level: "warn",
          message: `judge phase failed: ${errorMessage(err)} — run continues unjudged`,
          payload: { judgePhase: "fatal" },
        });
      }
    }

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
        message: `${samplesDone} samples · $${spentUsd.toFixed(2)}${samplesFailed > 0 ? ` · ${samplesFailed} sample fail preserved` : ""}${judgeRan ? ` · ${judgePairs.length} judge pairs · ${judgeReversalCount} reversal(s)` : ""}`,
      });
    }
    // run.partial was already emitted at the moment of the budget stop
    saveSnapshot(
      status === "completed" ? "completed" : status === "partial" ? "partial" : "cancelled",
    );
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
