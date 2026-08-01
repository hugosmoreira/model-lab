import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { RunModel, SampleResult } from "@model-lab/schemas";
import { TopBar } from "@/components/shell/TopBar";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { Callout, EmptyState, ModelDot, Panel, RUN_STATUS_COLORS } from "@/components/ui/primitives";
import { CategoryBars, type CategoryRow } from "@/components/charts/CategoryBars";
import { CostQualityScatter, type ScatterPoint } from "@/components/charts/CostQualityScatter";
import { LatencyBands, type LatencyBandRow } from "@/components/charts/LatencyBands";
import { WTLMatrix } from "@/components/charts/WTLMatrix";
import { endpointProviderLabel, modelColor, modelIdOf, shortNameOf } from "@/lib/data";
import { getRunView } from "@/lib/server/loaders";
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

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
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
    stats.get(endpointId) ?? { failed: 0, total: n, min: null, max: null };

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
        case "browser":
          return { name: "BROWSER / TEST", color: "var(--color-teal)" };
        case "human":
          return { name: `HUMAN RUBRIC ${s.rubricVersion ?? ""}`.trim(), color: "var(--color-amber)" };
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

  /* ---------- category bars (all values computed from the run's own data) ---------- */
  // Efficiency = 1 − (0.5·costNorm + 0.5·latencyNorm), each normalized 0–1
  // against the most expensive / slowest model in the run. Higher = cheaper + faster.
  const maxCost = Math.max(...runModels.map((rm) => rm.costUsd), 0.0001);
  const maxLat = Math.max(...runModels.map((rm) => rm.totalLatencyMs ?? 0), 1);
  const efficiency = (rm: RunModel): number =>
    1 - (0.5 * (rm.costUsd / maxCost) + 0.5 * ((rm.totalLatencyMs ?? maxLat) / maxLat));

  const hasVisual = runModels.some((rm) => rm.visualScore != null);

  const categories: CategoryRow[] = [
    {
      name: "Run success",
      scorer: "browser scorer",
      bars: runModels.map((rm) => {
        const st = statsFor(rm.endpointId);
        const ok = st.total - st.failed;
        return {
          key: rm.endpointId,
          color: modelColor(rm.endpointId),
          pct: st.total > 0 ? (ok / st.total) * 100 : 0,
          label:
            st.failed > 0 ? (
              <>
                {ok}/{st.total} · <span style={{ color: "var(--color-red)" }}>{st.failed} failed</span>
              </>
            ) : (
              `${ok}/${st.total}`
            ),
        };
      }),
    },
    {
      name: "Browser tests",
      scorer: `browser scorer · ${checksTotal} checks`,
      bars: runModels.map((rm) => {
        const passed = rm.testsPassed;
        const total = rm.testsTotal ?? checksTotal;
        return {
          key: rm.endpointId,
          color: modelColor(rm.endpointId),
          pct: passed != null && total > 0 ? (passed / total) * 100 : 0,
          label:
            passed != null ? (
              `${passed}/${total}`
            ) : (
              <span style={{ color: "var(--color-faint)" }}>—</span>
            ),
        };
      }),
    },
    // Visual quality renders only when a visual score exists for this run
    // (fixture: human rubric; store runs: mean per-sample score).
    ...(hasVisual
      ? [
          {
            name: "Visual quality",
            scorer: humanScorer
              ? `human rubric ${humanScorer.rubricVersion ?? ""}`.trim()
              : "mean sample score",
            bars: runModels.map((rm) => ({
              key: rm.endpointId,
              color: modelColor(rm.endpointId),
              pct: (rm.visualScore?.value ?? 0) * 10,
              label:
                rm.visualScore != null ? (
                  `${rm.visualScore.value.toFixed(1)}${rm.visualScore.n < n ? ` (n=${rm.visualScore.n})` : ""}`
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
        pct: efficiency(rm) * 100,
        label: `${usd(rm.costUsd)} · ${Math.round((rm.totalLatencyMs ?? 0) / 1000)}s`,
      })),
    },
  ];

  /* ---------- cost vs quality scatter ---------- */
  const scatterPoints: ScatterPoint[] = runModels.map((rm) => {
    const st = statsFor(rm.endpointId);
    const score = rm.visualScore;
    return {
      label: `${shortNameOf(rm.endpointId)} ${score?.value.toFixed(1) ?? "—"}${
        score != null && score.n < n ? ` (n=${score.n})` : ""
      }`,
      color: modelColor(rm.endpointId),
      costUsd: rm.costUsd,
      score: score?.value ?? 0,
      failed: rm.failedSampleCount > 0,
      scoreMin: st.min ?? undefined,
      scoreMax: st.max ?? undefined,
    };
  });
  const failedModel = runModels.find((rm) => rm.failedSampleCount > 0);
  const scatterFootnote = failedModel
    ? `Whiskers = min–max across samples. ${shortNameOf(failedModel.endpointId)} mean excludes ${failedModel.failedSampleCount} failed render (marked, not zero-scored).`
    : "Whiskers = min–max across samples.";

  /* ---------- latency bands + reliability ---------- */
  const latencyRows: LatencyBandRow[] = Object.entries(latencyRanges)
    .map(([endpointId, r]) => ({
      label: modelIdOf(endpointId),
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
        ? `${st.failed} render fail`
        : warns > 0
          ? `${warns} warn`
          : `${rm.retries} retries`;
    return {
      endpointId: rm.endpointId,
      label: modelIdOf(rm.endpointId),
      value: `${pct}% · ${detail}`,
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
            <Link href={`/runs/${runId}/artifacts`} className="hover-border" style={secondaryLink}>
              View Artifacts
            </Link>
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
          <span style={{ fontSize: 12, color: "var(--color-faint)" }}>Scoring methods in this run:</span>
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
              title="Weight editing arrives in Phase 3"
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
          <div style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Category scores */}
            <Panel style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Category scores</span>
                <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                  n={n} per model · higher is better
                </span>
              </div>
              <CategoryBars categories={categories} />
            </Panel>

            {/* Scatter + Latency/Reliability */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
              <Panel style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Cost vs quality</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                    {humanScorer ? "visual, human-scored" : "mean sample score"} · n={n}/model
                  </span>
                </div>
                <CostQualityScatter points={scatterPoints} showPareto footnote={scatterFootnote} />
              </Panel>

              <Panel style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Latency · total per sample</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                    lower is better · n={n}/model
                  </span>
                </div>
                <LatencyBands rows={latencyRows} />
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
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Win / tie / loss — judge pairs, order-swapped</span>
                {judge !== null && (
                  <span
                    style={{
                      ...mono,
                      fontSize: 11,
                      color: run.judgeReversalCount > 0 ? "var(--color-amber)" : "var(--color-faint)",
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
                  <span style={{ fontSize: 11, color: "var(--color-faint)", display: "block", marginTop: 8 }}>
                    Read as row vs column: W–T–L over {judge.judgePairs.length} pairs, n={n} samples × 2
                    orders per pair. ⟲ = verdict reversed when answer order was swapped — the flagged pair
                    is excluded from the aggregate verdict; cells show raw tallies.
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
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {runModels.map((rm) => {
              const failed = rm.failedSampleCount > 0;
              return (
                <section
                  key={rm.endpointId}
                  className="panel"
                  style={{
                    padding: "13px 15px",
                    borderColor: failed ? "var(--color-danger-border)" : undefined,
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
                      <span style={{ marginLeft: "auto", ...badgeStyle(flagColor(rm)) }}>{rm.flag}</span>
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
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>VISUAL</span>
                      <span>
                        {rm.visualScore != null ? (
                          `${rm.visualScore.value.toFixed(1)}/10${rm.visualScore.n < n ? ` (n=${rm.visualScore.n})` : ""}`
                        ) : (
                          <span style={{ color: "var(--color-faint)" }}>—</span>
                        )}
                      </span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>TESTS</span>
                      <span>
                        {rm.testsPassed != null ? (
                          `${rm.testsPassed}/${rm.testsTotal ?? checksTotal}`
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
                  <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 12 }}>
                    <Link
                      href={`/runs/${runId}/artifacts/${encodeEndpointId(rm.endpointId)}`}
                      className="hover-amber"
                      style={{ color: "var(--color-amber)" }}
                    >
                      Artifact →
                    </Link>
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
              <button type="button" disabled title="Export arrives in Phase 4" style={secondaryButtonDisabled}>
                Export Data (CSV/JSON)
              </button>
              <button type="button" disabled title="Re-run arrives in Phase 1" style={secondaryButtonDisabled}>
                Re-run
              </button>
              <button
                type="button"
                disabled
                title="Fork Configuration arrives in Phase 1"
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
              <strong style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>Legend:</strong>{" "}
              scores marked <span style={{ color: "var(--color-red)" }}>failed</span> are execution failures
              (evidence preserved), <span style={{ color: "var(--color-faint)" }}>—</span> is
              missing/not-applicable, and <span style={mono}>0</span> is a true zero score. These are never
              conflated.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
