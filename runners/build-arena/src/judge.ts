/**
 * LLM-as-judge phase (build-arena mode only, gated on config.judge).
 *
 * Runs AFTER every endpoint has finished its samples and BEFORE run.completed:
 *  1. RUBRIC — one call per judged model: grade brief adherence 0–10 against
 *     playability, textured walls, WASD movement, minimap, single-file
 *     compliance, and code quality. Commentary is attached to the model's
 *     best artifact (persisted as artifacts.judge_commentary) and emitted as
 *     a judge.vote event with payload {kind:"rubric", ...}.
 *  2. PAIRWISE, ORDER-SWAPPED — per C(n,2) pair of pairwise-eligible models,
 *     two calls (A/B then B/A with the sources swapped). Model identities are
 *     NEVER in the prompt — builds are labeled "Build A"/"Build B" only. The
 *     B/A verdict is normalized back to the canonical slot order; a
 *     disagreement between the two normalized verdicts = reversal →
 *     excludedFromTally. Emitted as judge.vote {kind:"pair", ...}.
 *
 * Inputs are best-of-model artifacts: renderOk preferred (highest browser
 * score wins); a model whose only artifacts failed to render is EXCLUDED from
 * pairwise judging but still rubric-graded on code intent, capped at 5.0.
 *
 * Judge calls stream through the EXISTING anthropic provider (temperature 0,
 * maxTokens 800 — the adapter passes temperature through unchanged). Token
 * usage is charged into the run cost at the judge model's prices and surfaced
 * via budget.status events; a projected budget overrun skips the remaining
 * judge calls (budget.status warn) — the judge phase NEVER kills the run.
 * Any per-call provider/parse error → check.warn, that grade/pair is skipped,
 * and the phase continues.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  JudgePairResult,
  RunEventLevel,
  RunEventType,
  SampleResult,
} from "@model-lab/schemas";
import { AnthropicProvider } from "./providers/anthropic";
import { errorMessage } from "./providers/util";
import type {
  EndpointConfig,
  GenerateRequest,
  JudgeConfig,
  Provider,
  RunnerConfig,
  StoredArtifact,
} from "./types";

export const JUDGE_MAX_TOKENS = 800;
export const JUDGE_TEMPERATURE = 0;
/** Rubric score ceiling for artifacts that failed to render (code-intent grade). */
export const RENDER_FAILED_SCORE_CAP = 5.0;
/** Artifact HTML is truncated to this many chars per slot in judge prompts. */
export const JUDGE_MAX_HTML_CHARS = 60_000;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export interface JudgeEmit {
  (
    type: RunEventType,
    opts: {
      endpointId?: string | null;
      sampleIndex?: number | null;
      level?: RunEventLevel;
      message: string;
      payload?: Record<string, unknown>;
    },
  ): void;
}

export interface JudgePhaseOptions {
  cfg: RunnerConfig;
  judge: JudgeConfig;
  /** run artifacts — judgeCommentary is written onto the graded entries */
  artifacts: StoredArtifact[];
  /** scored samples (used to pick the best-of-model artifact) */
  samples: SampleResult[];
  /** FsRunStore root — artifact relPaths resolve against it */
  artifactRoot: string;
  emit: JudgeEmit;
  getSpentUsd: () => number;
  addSpendUsd: (usd: number) => void;
  shouldStop: () => boolean;
  signal?: AbortSignal;
  /** injectable for tests; defaults to the real AnthropicProvider */
  provider?: Provider;
}

export interface JudgePhaseResult {
  judgePairs: JudgePairResult[];
  reversalCount: number;
  /** rubric grades actually emitted, keyed by endpointId */
  rubricScores: Map<string, number>;
}

interface JudgedModel {
  endpoint: EndpointConfig;
  artifact: StoredArtifact;
  html: string;
  /** false = artifact failed to render → rubric-only, capped at 5.0 */
  renderOk: boolean;
}

/* ------------------------------------------------------------------------- *
 * Strict-JSON parsing (defensive: fences stripped, first {...} extracted)
 * ------------------------------------------------------------------------- */

/** Strip markdown fences and extract the first balanced-looking JSON object. */
export function extractJsonObject(raw: string): unknown | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i);
  if (fence?.[1] !== undefined) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export interface RubricVerdict {
  score: number; // 0-10, one decimal
  commentary: string;
}

export function parseRubricVerdict(raw: string): RubricVerdict | null {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const score = obj["score"];
  const commentary = obj["commentary"];
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  if (typeof commentary !== "string" || commentary.trim() === "") return null;
  return {
    score: round1(Math.min(10, Math.max(0, score))),
    commentary: commentary.trim(),
  };
}

export type PairWinner = "A" | "B" | "tie";

export interface PairVerdict {
  winner: PairWinner;
  reasoning: string;
}

export function parsePairVerdict(raw: string): PairVerdict | null {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const winner = obj["winner"];
  const reasoning = obj["reasoning"];
  if (winner !== "A" && winner !== "B" && winner !== "tie") return null;
  if (typeof reasoning !== "string") return null;
  return { winner, reasoning: reasoning.trim() };
}

/** Normalize a swapped-presentation verdict back to canonical slot order. */
export function normalizeSwappedVerdict(winner: PairWinner): PairWinner {
  return winner === "A" ? "B" : winner === "B" ? "A" : "tie";
}

/* ------------------------------------------------------------------------- *
 * Prompts — model identities never appear; builds are "Build A"/"Build B".
 * ------------------------------------------------------------------------- */

const JUDGE_SYSTEM =
  "You are a strict, fair judge for a coding benchmark. You always respond " +
  "with EXACTLY the JSON object requested — no prose, no markdown fences.";

function truncatedHtml(html: string): string {
  if (html.length <= JUDGE_MAX_HTML_CHARS) return html;
  return `${html.slice(0, JUDGE_MAX_HTML_CHARS)}\n<!-- [truncated for judging: ${html.length - JUDGE_MAX_HTML_CHARS} chars omitted] -->`;
}

function rubricPrompt(brief: string, html: string, renderFailed: boolean): string {
  const renderNote = renderFailed
    ? "\nNOTE: this artifact FAILED to render in a headless browser. Grade the " +
      `code's INTENT only and cap your score at ${RENDER_FAILED_SCORE_CAP.toFixed(1)}.\n`
    : "";
  return (
    "A model was asked to complete this challenge brief:\n\n<brief>\n" +
    brief +
    "\n</brief>\n\nHere is the FULL HTML source the model produced:\n\n<artifact>\n" +
    truncatedHtml(html) +
    "\n</artifact>\n" +
    renderNote +
    "\nGrade how well this build adheres to the brief on a 0-10 scale (one " +
    "decimal place), weighing: playability, textured walls, WASD movement, " +
    "minimap present, single-file/no-network compliance, and code quality.\n\n" +
    'Respond with STRICT JSON only, exactly this shape:\n{"score": <number 0-10, one decimal>, "commentary": "<2-3 sentences>"}'
  );
}

function pairPrompt(brief: string, htmlA: string, htmlB: string): string {
  return (
    "Two anonymous builds — Build A and Build B — attempt the same challenge " +
    "brief:\n\n<brief>\n" +
    brief +
    "\n</brief>\n\nBuild A:\n<build_a>\n" +
    truncatedHtml(htmlA) +
    "\n</build_a>\n\nBuild B:\n<build_b>\n" +
    truncatedHtml(htmlB) +
    "\n</build_b>\n\nWhich build better fulfills the brief? Consider " +
    "playability, textured walls, WASD movement, minimap, single-file/" +
    "no-network compliance, and code quality. \"tie\" only when they are " +
    "genuinely indistinguishable in quality.\n\n" +
    'Respond with STRICT JSON only, exactly this shape:\n{"winner": "A"|"B"|"tie", "reasoning": "<1-2 sentences>"}'
  );
}

const JSON_ONLY_REMINDER =
  "\n\nREMINDER: your previous answer was not parseable. Return ONLY the JSON " +
  "object — no prose, no markdown fences, nothing before or after it.";

/* ------------------------------------------------------------------------- *
 * The phase
 * ------------------------------------------------------------------------- */

export async function runJudgePhase(options: JudgePhaseOptions): Promise<JudgePhaseResult> {
  const { cfg, judge, artifacts, samples, emit } = options;
  const provider = options.provider ?? new AnthropicProvider();
  const result: JudgePhaseResult = {
    judgePairs: [],
    reversalCount: 0,
    rubricScores: new Map(),
  };

  /* -- budget guard -------------------------------------------------------
   * Never kill the run at judge stage: when the projected spend of the next
   * call would cross the ceiling, warn once and skip everything remaining. */
  let budgetExhausted = false;
  const callCosts: number[] = [];
  const estimateCallCost = (promptChars: number): number => {
    if (callCosts.length > 0) {
      return Math.max(...callCosts); // observed worst case beats a guess
    }
    const estTokensIn = Math.ceil(promptChars / 4) + 200;
    return (estTokensIn * judge.priceInPerMtokUsd + JUDGE_MAX_TOKENS * judge.priceOutPerMtokUsd) / 1_000_000;
  };
  const budgetAllows = (promptChars: number): boolean => {
    if (budgetExhausted) return false;
    if (cfg.maxBudgetUsd <= 0) return true;
    const projected = options.getSpentUsd() + estimateCallCost(promptChars);
    if (projected < cfg.maxBudgetUsd) return true;
    budgetExhausted = true;
    emit("budget.status", {
      level: "warn",
      message: `judge: projected $${projected.toFixed(2)} ≥ budget $${cfg.maxBudgetUsd.toFixed(2)} — remaining judge calls skipped`,
      payload: {
        spentUsd: round4(options.getSpentUsd()),
        projectedUsd: round4(projected),
        ceilingUsd: cfg.maxBudgetUsd,
        judgeSkipped: true,
      },
    });
    return false;
  };

  /** One judge call: stream, collect text, charge cost, emit budget.status. */
  const judgeCall = async (prompt: string): Promise<string> => {
    const req: GenerateRequest = {
      system: JUDGE_SYSTEM,
      prompt,
      model: judge.model,
      temperature: JUDGE_TEMPERATURE,
      maxTokens: JUDGE_MAX_TOKENS,
    };
    if (options.signal !== undefined) req.signal = options.signal;
    let text = "";
    let tokensIn = 0;
    let tokensOut = 0;
    for await (const chunk of provider.generate(req)) {
      if (chunk.type === "delta") text += chunk.text;
      else {
        tokensIn = chunk.tokensIn;
        tokensOut = chunk.tokensOut;
      }
    }
    if (tokensOut === 0 && text.length > 0) tokensOut = Math.ceil(text.length / 4);
    const cost =
      (tokensIn * judge.priceInPerMtokUsd + tokensOut * judge.priceOutPerMtokUsd) / 1_000_000;
    callCosts.push(cost);
    options.addSpendUsd(cost);
    const spent = options.getSpentUsd();
    const pct =
      cfg.maxBudgetUsd > 0 ? Math.min(999, Math.round((spent / cfg.maxBudgetUsd) * 100)) : 0;
    emit("budget.status", {
      message: `$${spent.toFixed(2)} spent · ${pct}% of ceiling (judge: ${judge.model})`,
      payload: {
        spentUsd: round4(spent),
        projectedUsd: round4(spent),
        ceilingUsd: cfg.maxBudgetUsd,
        judgeCostUsd: round4(cost),
      },
    });
    return text;
  };

  /** Call → parse; one "JSON only" retry on parse failure; null = give up. */
  const judgeCallParsed = async <T>(
    prompt: string,
    parse: (raw: string) => T | null,
  ): Promise<T | null> => {
    const first = parse(await judgeCall(prompt));
    if (first !== null) return first;
    if (!budgetAllows(prompt.length + JSON_ONLY_REMINDER.length)) return null;
    return parse(await judgeCall(prompt + JSON_ONLY_REMINDER));
  };

  // -- best-of-model artifact selection ------------------------------------
  const judged: JudgedModel[] = [];
  for (const endpoint of cfg.endpoints) {
    const own = artifacts.filter((a) => a.endpointId === endpoint.id);
    if (own.length === 0) {
      emit("check.warn", {
        endpointId: endpoint.id,
        level: "warn",
        message: `judge: ${endpoint.modelId} has no artifact — excluded from judging`,
        payload: { judgeExcluded: true },
      });
      continue;
    }
    const scoreOf = (a: StoredArtifact): number => {
      const sample = samples.find(
        (s) => s.endpointId === a.endpointId && s.sampleIndex === a.sampleIndex,
      );
      const score = sample?.score;
      return score !== null && score !== undefined && "value" in score ? score.value : -1;
    };
    const renderable = own.filter((a) => a.renderOk);
    const pool = renderable.length > 0 ? renderable : own;
    const best = pool.reduce((acc, a) => (scoreOf(a) > scoreOf(acc) ? a : acc), pool[0] as StoredArtifact);
    let html: string;
    try {
      html = readFileSync(join(options.artifactRoot, ...best.path.split("/")), "utf8");
    } catch (err) {
      emit("check.warn", {
        endpointId: endpoint.id,
        level: "warn",
        message: `judge: cannot read artifact for ${endpoint.modelId} — excluded (${errorMessage(err)})`,
        payload: { judgeExcluded: true },
      });
      continue;
    }
    judged.push({ endpoint, artifact: best, html, renderOk: renderable.length > 0 });
  }
  if (judged.length === 0) return result;

  const brief = cfg.pack.prompt;

  // -- 1. rubric grading (one call per model) ------------------------------
  for (const model of judged) {
    if (options.shouldStop() || budgetExhausted) break;
    const prompt = rubricPrompt(brief, model.html, !model.renderOk);
    if (!budgetAllows(prompt.length)) break;
    let verdict: RubricVerdict | null = null;
    try {
      verdict = await judgeCallParsed(prompt, parseRubricVerdict);
    } catch (err) {
      emit("check.warn", {
        endpointId: model.endpoint.id,
        level: "warn",
        message: `judge: rubric call failed for ${model.endpoint.modelId} — ${errorMessage(err)}`,
        payload: { judgePhase: "rubric" },
      });
      continue;
    }
    if (verdict === null) {
      if (!budgetExhausted) {
        emit("check.warn", {
          endpointId: model.endpoint.id,
          level: "warn",
          message: `judge: unparseable rubric verdict for ${model.endpoint.modelId} — grade skipped`,
          payload: { judgePhase: "rubric" },
        });
      }
      continue;
    }
    let { score, commentary } = verdict;
    if (!model.renderOk) {
      score = Math.min(score, RENDER_FAILED_SCORE_CAP);
      commentary = `[render failed — graded on code intent, capped at ${RENDER_FAILED_SCORE_CAP.toFixed(1)}] ${commentary}`;
    }
    model.artifact.judgeCommentary = commentary; // terminal snapshot persists it
    result.rubricScores.set(model.endpoint.id, score);
    emit("judge.vote", {
      endpointId: model.endpoint.id,
      sampleIndex: model.artifact.sampleIndex,
      level: "success",
      message: `rubric ${score.toFixed(1)}/10 · ${model.endpoint.modelId} brief adherence`,
      payload: { kind: "rubric", endpointId: model.endpoint.id, score, commentary },
    });
  }

  // -- 2. pairwise, order-swapped (renderable models only) -----------------
  const pairable = judged.filter((m) => m.renderOk);
  let pairIndex = 0;
  for (let i = 0; i < pairable.length; i++) {
    for (let j = i + 1; j < pairable.length; j++) {
      pairIndex += 1;
      if (options.shouldStop() || budgetExhausted) continue;
      const a = pairable[i];
      const b = pairable[j];
      if (a === undefined || b === undefined) continue;
      const promptAB = pairPrompt(brief, a.html, b.html);
      const promptBA = pairPrompt(brief, b.html, a.html);
      if (!budgetAllows(Math.max(promptAB.length, promptBA.length))) continue;
      let ab: PairVerdict | null = null;
      let ba: PairVerdict | null = null;
      try {
        ab = await judgeCallParsed(promptAB, parsePairVerdict);
        if (ab !== null && budgetAllows(promptBA.length)) {
          ba = await judgeCallParsed(promptBA, parsePairVerdict);
        }
      } catch (err) {
        emit("check.warn", {
          level: "warn",
          message: `judge: pair ${pairIndex} (${a.endpoint.modelId} vs ${b.endpoint.modelId}) call failed — pair skipped (${errorMessage(err)})`,
          payload: { judgePhase: "pair", pairIndex },
        });
        continue;
      }
      if (ab === null || ba === null) {
        if (!budgetExhausted) {
          emit("check.warn", {
            level: "warn",
            message: `judge: pair ${pairIndex} (${a.endpoint.modelId} vs ${b.endpoint.modelId}) — unparseable verdict, pair skipped`,
            payload: { judgePhase: "pair", pairIndex },
          });
        }
        continue;
      }
      const verdictAB = ab.winner;
      // The B/A call saw the builds swapped — normalize back to canonical slots.
      const verdictBA = normalizeSwappedVerdict(ba.winner);
      const reversed = verdictAB !== verdictBA;
      if (reversed) result.reversalCount += 1;
      const commentary = `${ab.reasoning}${reversed ? " [REVERSED on order swap]" : ""}`;
      result.judgePairs.push({
        runId: cfg.runId,
        pairIndex,
        pairing: [a.endpoint.id, b.endpoint.id],
        verdictAB,
        verdictBA,
        reversed,
        excludedFromTally: reversed,
        commentary,
      });
      emit("judge.vote", {
        level: reversed ? "warn" : "info",
        message: `pair ${pairIndex}: ${a.endpoint.modelId} vs ${b.endpoint.modelId} → A/B ${verdictAB} · B/A ${verdictBA}${reversed ? " ⟲ REVERSED — excluded from tally" : ""}`,
        payload: {
          kind: "pair",
          pairIndex,
          endpointA: a.endpoint.id,
          endpointB: b.endpoint.id,
          verdictAB,
          verdictBA,
          reversed,
        },
      });
    }
  }

  return result;
}
