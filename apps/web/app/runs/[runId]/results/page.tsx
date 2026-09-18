import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { RunModel, SampleResult } from "@model-lab/schemas";
import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import {
  Callout,
  EmptyState,
  ModelDot,
  Panel,
  RUN_STATUS_COLORS,
} from "@/components/ui/primitives";
import { CategoryBars, type CategoryRow } from "@/components/charts/CategoryBars";
import { CostQualityScatter, type ScatterPoint } from "@/components/charts/CostQualityScatter";
import { LatencyBands, type LatencyBandRow } from "@/components/charts/LatencyBands";
import { WTLMatrix } from "@/components/charts/WTLMatrix";
import { capabilityForModel, type CapabilityTally } from "@/lib/checks";
import { endpointProviderLabel, modelColor, modelIdOf, shortNameOf } from "@/lib/data";
import { getRunView } from "@/lib/server/loaders";
import { modelScoreSource, scoreAxisLabel, SCORE_LABELS } from "@/lib/score-presentation";
import { mmss, seconds, usd } from "@/lib/format";

/** Reads the persistence store — must render per request. */
export const dynamic = "force-dynamic";

const mono = { fontFamily: "var(--font-mono)" } as const;

/** Endpoint ids contain "/" — encode for URLs by swapping to "~". */
function encodeEndpointId(endpointId: string): string {
  return endpointId.replace(/\//g, "~");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap known model ids inside the verdict narrative in their identity colors. */
function tintNarrative(text: string, tints: Map<string, string>): ReactNode[] {
  if (tints.size === 0) return [text];
  const ids = [...tints.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${ids.map(escapeRegExp).join("|")})`, "g");
  return text.split(pattern).map((part, i) => {
    const color = tints.get(part);
    return color ? (
      <span key={i} style={{ color }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

/** Mono badge used for scorer methods and model-card flags. */
function badgeStyle(color: string): CSSProperties {
  return {
    ...mono,
    fontSize: 10.5,
    color,
    border: "1px solid var(--color-border)",
    borderRadius: 3,
    padding: "3px 8px",
    whiteSpace: "nowrap",
  };
}

const secondaryLink: CSSProperties = {
  background: "var(--color-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12.5,
};

const secondaryButtonDisabled: CSSProperties = {
  background: "var(--color-raised)",
  border: "1px solid var(--color-border)",
  color: "var(--color-disabled)",
  borderRadius: 6,
  padding: "7px 12px",
  cursor: "not-allowed",
  fontSize: 12.5,
  fontFamily: "inherit",
};

interface SampleStats {
  failed: number;
  total: number;
  min: number | null;
  max: number | null;
}

/** Per-endpoint sample rollup: scored/failed counts + min–max of scored values. */
function buildSampleStats(samples: SampleResult[]): Map<string, SampleStats> {
  const map = new Map<string, SampleStats>();
  for (const s of samples) {
    if (s.status !== "scored" && s.status !== "failed") continue;
    const cur = map.get(s.endpointId) ?? { failed: 0, total: 0, min: null, max: null };
    cur.total += 1;
    if (s.status === "failed" || (s.score != null && "failed" in s.score)) {
      cur.failed += 1;
    } else if (s.score != null && "value" in s.score) {
      cur.min = cur.min == null ? s.score.value : Math.min(cur.min, s.score.value);
      cur.max = cur.max == null ? s.score.value : Math.max(cur.max, s.score.value);
    }
    map.set(s.endpointId, cur);
  }
  return map;
}

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const view = await getRunView(runId);
  const {
    run,
    configuration: runConfiguration,
    manifest: runManifest,
    samples,
    runModels,
    latencyRanges,
    judge,
  } = view;
  const n = run.samplesPerModel;
  const stats = buildSampleStats(samples);
  const statsFor = (endpointId: string): SampleStats =>
    stats.get(endpointId) ?? { failed: 0, total: 0, min: null, max: null };

  /* Verified runs have no artifacts/browser checks — objective scores only. */
  const isVerified = run.mode === "verified";
  const hasArtifacts = view.artifacts.length > 0;

  /**
   * Brief adherence (0–10): the judge's RUBRIC score per model (averaged over
   * both presentation orders) — a graded assessment of how well the artifact
   * fulfills the brief. Distinct from the pairwise W–T–L record, which lives
   * in the matrix panel with its own reversal-exclusion rule. Null when the
   * run had no judge scorer.
   */
  const judgeAdherence = (endpointId: string): number | null =>
    judge?.briefScores[endpointId] ?? null;

  /* ---------- header meta ---------- */
  const meta = `${runManifest.date} · ${mmss(run.elapsedSec ?? 0)} duration · ${run.modelCount} models · n=${n} each · ${samples.length} samples`;

  /* ---------- verdict narrative tinting ---------- */
  const tints = new Map(
    runModels.map((rm): [string, string] => [modelIdOf(rm.endpointId), modelColor(rm.endpointId)]),
  );

  /* ---------- scorer badges (from run configuration + composite weighting) ---------- */
  const scorerBadges: { name: string; color: string }[] = runConfiguration.scorers
    .filter((s) => s.enabled)
    .map((s) => {
      switch (s.type) {
        case "objective":
          return { name: "OBJECTIVE", color: "var(--color-model-gpt)" };
        case "browser":
          return { name: "BROWSER / TEST", color: "var(--color-teal)" };
        case "human":
          return {
            name: `HUMAN RUBRIC ${s.rubricVersion ?? ""}`.trim(),
            color: "var(--color-amber)",
          };
        case "llm-judge":
          return {
            name: `LLM JUDGE${s.orderSwapped ? " (order-swapped)" : ""}`,
            color: "var(--color-magenta)",
          };
        default:
          return { name: s.name.toUpperCase(), color: "var(--color-muted)" };
      }
    });
  if (run.compositeWeighting.efficiency > 0) {
    // objective efficiency scorer is implied by a non-zero composite weight
    scorerBadges.push({ name: "OBJECTIVE (efficiency)", color: "var(--color-model-gpt)" });
  }
  const weights = run.compositeWeighting;

  const humanScorer = runConfiguration.scorers.find((s) => s.type === "human");
  const judgeScorer = runConfiguration.scorers.find((s) => s.type === "llm-judge");
  const checksTotal = view.checksTotal;

  /**
   * The headline browser number is the CAPABILITY ratio — did the model build
   * what the brief asked for. Gates (html.parses, page.loads, console.clean,
   * canvas.renders) are correctness preconditions: one failed gate means the
   * artifact is broken, so the ratio is 0 and the gate is named rather than the
   * model being shown as a partial pass. Diagnostics (screenshot.captured,
   * fps.stable, a11y.contrast) measure the harness and are never scored.
   *
   * Read per model from that model's own stored traces (they carry the
   * category, and a legacy trace classifies correctly by check name), falling
   * back to the RunModel rollup for runs that stored no artifacts.
   */
  const capabilityFor = (endpointId: string): CapabilityTally => {
    const rm = runModels.find((m) => m.endpointId === endpointId);
    return capabilityForModel(
      view.artifacts.filter((a) => a.endpointId === endpointId).map((a) => a.checks),
      { passed: rm?.testsPassed ?? null, total: rm?.testsTotal ?? view.capabilityTotal },
    );
  };
  const capabilityByEndpoint = new Map(
    runModels.map((rm): [string, CapabilityTally] => [rm.endpointId, capabilityFor(rm.endpointId)]),
  );

  // Scored annotations make a run human-scored even without a configured
  // human scorer — visual ratings arrive post-run via the audit trail.
  const hasHumanRatings = runModels.some(
    (rm) => rm.visualSource === "human" && rm.visualScore != null,
  );
  if (hasHumanRatings && humanScorer == null) {
    scorerBadges.push({ name: "HUMAN (visual ratings)", color: "var(--color-amber)" });
  }
  const scoreLabel = scoreAxisLabel(
    runModels.filter((rm) => rm.visualScore != null).map(modelScoreSource),
  );

  /* ---------- category bars (all values computed from the run's own data) ---------- */
  // Efficiency = 1 − (0.5·costNorm + 0.5·latencyNorm), each normalized 0–1
  // against the most expensive / slowest model in the run. Higher = cheaper + faster.
  const maxCost = Math.max(...runModels.map((rm) => rm.costUsd), 0.0001);
  const maxLat = Math.max(...runModels.map((rm) => rm.totalLatencyMs ?? 0), 1);
  const efficiency = (rm: RunModel): number | null =>
    rm.totalLatencyMs == null
      ? null
      : 1 - (0.5 * (rm.costUsd / maxCost) + 0.5 * (rm.totalLatencyMs / maxLat));

  const hasVisual = runModels.some((rm) => rm.visualScore != null);
  const hasBrowserScorer = runConfiguration.scorers.some((s) => s.type === "browser" && s.enabled);

  const categories: CategoryRow[] = [
    {
      name: "Run success",
      scorer: hasBrowserScorer ? "browser scorer" : "objective scorer",
      bars: runModels.map((rm) => {
        const st = statsFor(rm.endpointId);
        const ok = st.total - st.failed;
        return {
          key: rm.endpointId,
          color: modelColor(rm.endpointId),
          pct: st.total > 0 ? (ok / st.total) * 100 : 0,
          label:
            st.total === 0 ? (
              "— · no terminal samples"
            ) : st.failed > 0 ? (
              <>
                {ok}/{st.total} ·{" "}
                <span style={{ color: "var(--color-red)" }}>{st.failed} failed</span>
              </>
            ) : (
              `${ok}/${st.total}`
            ),
        };
      }),
    },
    // Browser tests exist only for arena runs — verified runs have no checks;
    // their pass/fail story is the "Task accuracy" row below.
    ...(isVerified
      ? []
      : [
          {
            name: "Browser tests",
            scorer: `browser scorer · ${view.capabilityTotal} capability checks of ${checksTotal}`,
            bars: runModels.map((rm) => {
              const cap = capabilityByEndpoint.get(rm.endpointId);
              const passed = cap?.passed ?? null;
              const total = cap?.total ?? view.capabilityTotal;
              return {
                key: rm.endpointId,
                color: modelColor(rm.endpointId),
                pct: passed != null && total > 0 ? (passed / total) * 100 : 0,
                label:
                  passed == null ? (
                    <span style={{ color: "var(--color-faint)" }}>—</span>
                  ) : cap?.gateName != null ? (
                    // Not a partial pass: a failed gate means the build is broken.
                    <span style={{ color: "var(--color-red)" }}>
                      {passed}/{total} · gate {cap.gateName}
                    </span>
                  ) : (
                    `${passed}/${total}`
                  ),
              };
            }),
          } satisfies CategoryRow,
        ]),
    // Visual quality renders only when a visual score exists for this run
    // (fixture: human rubric; store runs: mean per-sample score). Verified
    // runs relabel it "Task accuracy" — the mean objective score (10/0 basis).
    ...(hasVisual
      ? [
          {
            name: "Recorded score",
            scorer: "source and n shown per model",
            bars: runModels.map((rm) => ({
              key: rm.endpointId,
              color: modelColor(rm.endpointId),
              pct: (rm.visualScore?.value ?? 0) * 10,
              label:
                rm.visualScore != null ? (
                  `${rm.visualScore.value.toFixed(1)} · ${SCORE_LABELS[modelScoreSource(rm)]} · n=${rm.visualScore.n}`
                ) : (
                  <span style={{ color: "var(--color-faint)" }}>—</span>
                ),
            })),
          } satisfies CategoryRow,
        ]
      : []),
    // Brief adherence exists only when the run had a judge scorer.
    ...(judge !== null
      ? [
          {
            name: "Brief adherence",
            scorer: `judge${judgeScorer?.orderSwapped ? ", order-swapped" : ""}`,
            // Derived: win-rate over non-excluded judge pairs ×10 (see judgeAdherence).
            bars: runModels.map((rm) => {
              const v = judgeAdherence(rm.endpointId);
              return {
                key: rm.endpointId,
                color: modelColor(rm.endpointId),
                pct: (v ?? 0) * 10,
                label:
                  v != null ? v.toFixed(1) : <span style={{ color: "var(--color-faint)" }}>—</span>,
              };
            }),
          } satisfies CategoryRow,
        ]
      : []),
    {
      name: "Efficiency",
      scorer: "objective · cost+latency",
      bars: runModels.map((rm) => ({
        key: rm.endpointId,
        color: modelColor(rm.endpointId),
        pct: (efficiency(rm) ?? 0) * 100,
        label: `${usd(rm.costUsd)} · ${rm.totalLatencyMs == null ? "— latency not recorded" : `${Math.round(rm.totalLatencyMs / 1000)}s`}`,
      })),
    },
  ];

  /* ---------- cost vs quality scatter ---------- */
  const scatterPoints: ScatterPoint[] = runModels.flatMap((rm) => {
    const score = rm.visualScore;
    if (score == null) return [];
    const source = modelScoreSource(rm);
    const matching =
      source !== "browser" && source !== "objective"
        ? [] // Sample.score is the recorded automatic score, not a later human annotation.
        : samples
            .filter(
              (s) =>
                s.endpointId === rm.endpointId &&
                s.primaryScorer === source &&
                s.score != null &&
                "value" in s.score,
            )
            .flatMap((s) => (s.score != null && "value" in s.score ? [s.score.value] : []));
    return [
      {
        label: `${shortNameOf(rm.endpointId)} ${score.value.toFixed(1)}`,
        source: SCORE_LABELS[source],
        n: score.n,
        color: modelColor(rm.endpointId),
        costUsd: rm.costUsd,
        score: score.value,
        failed: rm.failedSampleCount > 0,
        scoreMin: matching.length > 0 ? Math.min(...matching) : undefined,
        scoreMax: matching.length > 0 ? Math.max(...matching) : undefined,
      },
    ];
  });
  const comparableScores =
    new Set(runModels.filter((rm) => rm.visualScore != null).map(modelScoreSource)).size === 1 &&
    runModels
      .filter((rm) => rm.visualScore != null)
      .every((rm) => modelScoreSource(rm) !== "unknown");
  const scatterFootnote =
    "Each point names its source and measured sample count. Missing scores are omitted. Whiskers show the range of recorded automatic samples; human ratings have no automatic-score whiskers. Different sources are not directly comparable.";
  /* ---------- latency bands + reliability ---------- */
  const latencyRows: LatencyBandRow[] = Object.entries(latencyRanges)
    .map(([endpointId, r]) => ({
      label: `${modelIdOf(endpointId)} · n=${r.n}`,
      color: modelColor(endpointId),
      minMs: r.min,
      medianMs: r.median,
      maxMs: r.max,
    }))
    .sort((a, b) => a.medianMs - b.medianMs);

  // check.warn events per endpoint (surfaces gemini's texture-fallback warning)
  const warnCounts = view.checkWarnCounts;
  const reliabilityRows = runModels.map((rm) => {
    const st = statsFor(rm.endpointId);
    const pct = st.total > 0 ? Math.round(((st.total - st.failed) / st.total) * 100) : 0;
    const warns = warnCounts[rm.endpointId] ?? 0;
    const detail =
      st.failed > 0
        ? `${st.failed} ${isVerified ? "task fail" : "render fail"}`
        : warns > 0
          ? `${warns} warn`
          : `${rm.retries} retries`;
    return {
      endpointId: rm.endpointId,
      label: modelIdOf(rm.endpointId),
      value: st.total === 0 ? "— · no terminal samples" : `${pct}% · ${detail} · n=${st.total}`,
      color: st.failed > 0 ? "var(--color-red)" : "var(--color-teal)",
    };
  });

  /* ---------- W–T–L matrix ---------- */
  const matrixRows = runModels.map((rm) => ({
    id: rm.endpointId,
    label: shortNameOf(rm.endpointId),
  }));

  /* ---------- model summary cards ---------- */
  const flagColor = (rm: RunModel): string => {
    if (rm.flag == null) return "var(--color-muted)";
    if (rm.flag.includes("fail")) return "var(--color-red)";
    if (rm.flag === "all tests pass") return "var(--color-teal)";
    return modelColor(rm.endpointId); // "best visual" / "best value" — identity-tinted per audit
  };

  return (
    <>
      <TopBar title={`Results — ${run.name}`} />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 1400,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{run.name}</h1>
          <span
            style={{
              ...mono,
              fontSize: 11,
              color: RUN_STATUS_COLORS[run.status] ?? "var(--color-muted)",
              border: "1px solid var(--color-border-success)",
              borderRadius: 4,
              padding: "2px 8px",
            }}
          >
            {run.status}
          </span>
          <span style={{ ...mono, fontSize: 12, color: "var(--color-faint)" }}>{meta}</span>
          <span style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <Link href={`/runs/${runId}/samples`} className="hover-border" style={secondaryLink}>
              Explore Samples
            </Link>
            {/* Runs without artifacts (verified mode) get no artifact links. */}
            {hasArtifacts && (
              <Link
                href={`/runs/${runId}/artifacts`}
                className="hover-border"
                style={secondaryLink}
              >
                View Artifacts
              </Link>
            )}
            <Link
              href={`/share/${runId}`}
              className="btn-primary"
              style={{
                background: "var(--color-amber)",
                color: "var(--color-on-accent)",
                fontWeight: 600,
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12.5,
              }}
            >
              Create Share Card
            </Link>
          </span>
        </div>

        <ReproStrip manifest={runManifest} />
        {view.mockedEndpointIds.length > 0 && (
          <Callout variant="warning">
            Synthetic mock outputs: {view.mockedEndpointIds.map(modelIdOf).join(", ")}. These
            endpoints did not call providers; their recorded costs are simulated.
          </Callout>
        )}
        {view.source === "fixtures" && (
          <Callout variant="insight">
            Illustrative demo data — these measurements are a seeded example, not a benchmark
            performed on this instance.
          </Callout>
        )}

        {/* Verdict banner — neutral completion note when no verdict was recorded */}
        {run.verdict ? (
          <Callout variant="insight" style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <span
                style={{
                  ...mono,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-magenta)",
                  border: "1px solid var(--color-border-magenta)",
                  borderRadius: 4,
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                }}
              >
                {run.verdict.label}
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--color-text-secondary)",
                  flex: "1 1 300px",
                  minWidth: 0,
                }}
              >
                {tintNarrative(run.verdict.narrative, tints)}
              </p>
            </div>
          </Callout>
        ) : (
          <Callout variant="note" style={{ padding: "14px 18px" }}>
            <span style={{ fontSize: 13.5 }}>
              Run {run.status} — {samples.length} samples · {usd(run.costSpentUsd)}. No verdict
              narrative recorded for this run.
            </span>
          </Callout>
        )}

        {/* Scorer badges + composite weighting */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--color-faint)" }}>
            Scoring methods in this run:
          </span>
          {scorerBadges.map((b) => (
            <span key={b.name} style={badgeStyle(b.color)}>
              {b.name}
            </span>
          ))}
          <span style={{ fontSize: 12, color: "var(--color-faint)", marginLeft: "auto" }}>
            Composite weighting: browser {weights.browser}% · visual {weights.visual}% · efficiency{" "}
            {weights.efficiency}%{" "}
            <button
              type="button"
              disabled
              title="Weights are recorded with the run and cannot be edited afterward"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                font: "inherit",
                color: "var(--color-disabled)",
                textDecoration: "underline",
                cursor: "not-allowed",
              }}
            >
              edit
            </button>
          </span>
        </div>

        {/* Two-column body */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
          {/* LEFT column */}
          <div
            style={{
              flex: "2 1 520px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Category scores */}
            <Panel style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Category scores</span>
                <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                  planned n={n} per model · source and measured n below
                </span>
              </div>
              <CategoryBars categories={categories} />
            </Panel>

            {/* Scatter + Latency/Reliability */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 14,
              }}
            >
              <Panel style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Cost vs score</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                    {scoreLabel}
                  </span>
                </div>
                {scatterPoints.length === 0 ? (
                  <EmptyState
                    title="No scores recorded"
                    hint="Unscored models are omitted rather than plotted as zero."
                  />
                ) : (
                  <CostQualityScatter
                    points={scatterPoints}
                    showPareto={comparableScores}
                    footnote={scatterFootnote}
                    yLabel={scoreLabel}
                  />
                )}
              </Panel>

              <Panel
                style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Latency · total per sample</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                    lower is better · measured n per row
                  </span>
                </div>
                {latencyRows.length === 0 ? (
                  <EmptyState
                    title="No latency recorded"
                    hint="Measured latency will appear when sample data is available."
                  />
                ) : (
                  <LatencyBands rows={latencyRows} />
                )}
                <div
                  style={{
                    borderTop: "1px solid var(--color-border-subtle)",
                    paddingTop: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Reliability</span>
                  {reliabilityRows.map((r) => (
                    <span
                      key={r.endpointId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        ...mono,
                        fontSize: 11.5,
                        color: "var(--color-muted)",
                      }}
                    >
                      <span>{r.label}</span>
                      <span style={{ color: r.color }}>{r.value}</span>
                    </span>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Win/tie/loss matrix */}
            <Panel style={{ padding: "14px 18px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 10,
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  Win / tie / loss — judge pairs, order-swapped
                </span>
                {judge !== null && (
                  <span
                    style={{
                      ...mono,
                      fontSize: 11,
                      color:
                        run.judgeReversalCount > 0 ? "var(--color-amber)" : "var(--color-faint)",
                    }}
                  >
                    {run.judgeReversalCount > 0
                      ? `${run.judgeReversalCount} order reversal${run.judgeReversalCount === 1 ? "" : "s"} detected`
                      : "no order reversals"}
                  </span>
                )}
              </div>
              {judge !== null ? (
                <>
                  <WTLMatrix rows={matrixRows} matrix={judge.wtlMatrix} />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-faint)",
                      display: "block",
                      marginTop: 8,
                    }}
                  >
                    Read as row vs column: W–T–L over {judge.judgePairs.length} pairs,{" "}
                    {view.source === "store"
                      ? "best build judged in both presentation orders per pair"
                      : `n=${n} samples × 2 orders per pair`}
                    . ⟲ = verdict reversed when answer order was swapped — the flagged pair is
                    excluded from the aggregate verdict; cells show raw tallies.
                  </span>
                </>
              ) : (
                <EmptyState
                  title="No judge scorer in this run"
                  hint="Pairwise W–T–L verdicts require an LLM-judge scorer — this run scored with browser checks only."
                />
              )}
            </Panel>
          </div>

          {/* RIGHT rail */}
          <div
            style={{
              flex: "1 1 300px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {runModels.map((rm) => {
              const failed = rm.failedSampleCount > 0;
              const cap = capabilityByEndpoint.get(rm.endpointId);
              const gated = cap?.gateName != null;
              return (
                <section
                  key={rm.endpointId}
                  className="panel"
                  style={{
                    padding: "13px 15px",
                    borderColor: failed || gated ? "var(--color-danger-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                    <ModelDot color={modelColor(rm.endpointId)} size={9} />
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ ...mono, fontSize: 13.5 }}>{modelIdOf(rm.endpointId)}</span>
                      <span style={{ fontSize: 11, color: "var(--color-faint)" }}>
                        {endpointProviderLabel(rm.endpointId)}
                      </span>
                    </span>
                    {rm.flag && (
                      <span style={{ marginLeft: "auto", ...badgeStyle(flagColor(rm)) }}>
                        {rm.flag}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4,1fr)",
                      gap: 8,
                      ...mono,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>
                        {isVerified ? "SCORE" : "HUMAN"}
                      </span>
                      <span>
                        {/* Only a human rating is shown as one; the browser ratio
                            already sits in the CAPABILITY column beside it. */}
                        {rm.visualScore != null && (isVerified || rm.visualSource === "human") ? (
                          `${rm.visualScore.value.toFixed(1)}/10${rm.visualScore.n < n ? ` (n=${rm.visualScore.n})` : ""}`
                        ) : (
                          <span style={{ color: "var(--color-faint)" }}>—</span>
                        )}
                      </span>
                    </span>
                    {/* Capability ratio — a failed gate shows 0 in the failure
                        color with the gate named below, never as a partial pass. */}
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>
                        {gated ? "GATE FAILED" : "CAPABILITY"}
                      </span>
                      <span style={gated ? { color: "var(--color-red)" } : undefined}>
                        {cap?.passed != null ? (
                          `${cap.passed}/${cap.total}`
                        ) : (
                          <span style={{ color: "var(--color-faint)" }}>—</span>
                        )}
                      </span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>COST</span>
                      <span>{usd(rm.costUsd)}</span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>LATENCY</span>
                      <span>
                        {rm.totalLatencyMs != null ? (
                          seconds(rm.totalLatencyMs)
                        ) : (
                          <span style={{ color: "var(--color-faint)" }}>—</span>
                        )}
                      </span>
                    </span>
                  </div>
                  {cap?.gateDetail != null && (
                    <span
                      style={{
                        ...mono,
                        display: "block",
                        marginTop: 8,
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: "var(--color-red)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      gate failed · {cap.gateDetail}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 12 }}>
                    {hasArtifacts && (
                      <Link
                        href={`/runs/${runId}/artifacts/${encodeEndpointId(rm.endpointId)}`}
                        className="hover-amber"
                        style={{ color: "var(--color-amber)" }}
                      >
                        Artifact →
                      </Link>
                    )}
                    <Link
                      href={`/runs/${runId}/samples`}
                      className="hover-text"
                      style={{ color: "var(--color-muted)" }}
                    >
                      Samples
                    </Link>
                  </div>
                </section>
              );
            })}

            {/* Action row — wired in later phases */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled
                title="Open Share Studio for CSV and JSON exports"
                style={secondaryButtonDisabled}
              >
                Export Data (CSV/JSON)
              </button>
              <button
                type="button"
                disabled
                title="Create a New Run to repeat this benchmark"
                style={secondaryButtonDisabled}
              >
                Re-run
              </button>
              <button
                type="button"
                disabled
                title="Configuration cloning is not available"
                style={secondaryButtonDisabled}
              >
                Fork Configuration
              </button>
            </div>

            {/* Legend */}
            <div
              style={{
                background: "var(--color-inset-alt)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 12,
                color: "var(--color-muted)",
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>
                Legend:
              </strong>{" "}
              scores marked <span style={{ color: "var(--color-red)" }}>failed</span> are execution
              failures (evidence preserved), <span style={{ color: "var(--color-faint)" }}>—</span>{" "}
              is missing/not-applicable, and <span style={mono}>0</span> is a true zero score. These
              are never conflated.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
