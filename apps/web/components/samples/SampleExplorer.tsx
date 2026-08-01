"use client";

import { useMemo, useState } from "react";
import type { HumanAnnotation, RunManifest } from "@model-lab/schemas";
import { ReproStrip } from "@/components/shell/ReproStrip";
import { EmptyState, ModelDot } from "@/components/ui/primitives";
import { pad2, seconds, usd } from "@/lib/format";
import { SampleDetail } from "./SampleDetail";
import { isFailed, scoreText, type SampleRowData } from "./shared";

const mono = { fontFamily: "var(--font-mono)" } as const;

const FILTERS = [
  "All",
  "Failed",
  "Slow",
  "Expensive",
  "Judge reversed",
  "Browser errors",
  "Human reviewed",
  "Local",
] as const;
type Filter = (typeof FILTERS)[number];

/** Header and rows must share this template exactly (audit spec). */
const GRID = {
  display: "grid",
  gridTemplateColumns: "44px 1.3fr 90px 70px 70px 70px 90px 60px",
  gap: 8,
  alignItems: "center",
} as const;

/** Linear-interpolated 90th percentile over this run's per-sample values. */
function p90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  const rank = 0.9 * (sorted.length - 1);
  const lo = Math.floor(rank);
  const a = sorted[lo] ?? Number.POSITIVE_INFINITY;
  const b = sorted[lo + 1] ?? a;
  return a + (b - a) * (rank - lo);
}

function makePredicate(
  filter: Filter,
  latencyP90: number,
  costP90: number,
): (r: SampleRowData) => boolean {
  switch (filter) {
    case "All":
      return () => true;
    case "Failed":
      return (r) => r.sample.status === "failed";
    case "Slow":
      return (r) => r.sample.latencyMs != null && r.sample.latencyMs > latencyP90;
    case "Expensive":
      return (r) => r.sample.costUsd > costP90;
    case "Judge reversed":
      return (r) => r.sample.judgeReversed;
    case "Browser errors":
      return (r) => r.sample.scorerTrace.some((t) => t.status === "failed");
    case "Human reviewed":
      return (r) => r.sample.humanReviewed;
    case "Local":
      return (r) => r.isLocal;
  }
}

export function SampleExplorer({
  runId,
  rows,
  taskLabel,
  challengePrompt,
  manifest,
  annotations,
}: {
  runId: string;
  rows: SampleRowData[];
  taskLabel: string;
  challengePrompt: string;
  manifest: RunManifest;
  /** Append-only human audit trail for the whole run. */
  annotations: HumanAnnotation[];
}) {
  // Prototype default selection: gpt-5.2-mini · sample 3/3 (globalIndex 6).
  const [selectedIndex, setSelectedIndex] = useState(6);
  const [filter, setFilter] = useState<Filter>("All");

  const latencyP90 = useMemo(
    () => p90(rows.map((r) => r.sample.latencyMs).filter((v): v is number => v != null)),
    [rows],
  );
  const costP90 = useMemo(() => p90(rows.map((r) => r.sample.costUsd)), [rows]);

  const visible = useMemo(
    () => rows.filter(makePredicate(filter, latencyP90, costP90)),
    [rows, filter, latencyP90, costP90],
  );

  // Selection policy (audit ambiguity, resolved): a filtered-out selection
  // falls back to the first visible row; the stored index is untouched.
  const selected =
    visible.find((r) => r.sample.globalIndex === selectedIndex) ?? visible[0] ?? null;

  const chipTitle = (name: Filter): string | undefined => {
    if (name === "Slow") return `latency > p90 (${seconds(latencyP90)})`;
    if (name === "Expensive") return `cost > p90 (${usd(costP90)})`;
    return undefined;
  };

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Row hover must live in CSS: an inline background would out-rank :hover. */}
      <style>{`.smpx-row{background:transparent}.smpx-row:hover{background:var(--color-row-hover)}`}</style>

      {/* Filter chip bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "12px 20px",
          borderBottom: "1px solid var(--color-border-subtle)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--color-faint)", marginRight: 4 }}>Filters:</span>
        {FILTERS.map((name) => {
          const active = filter === name;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              title={chipTitle(name)}
              onClick={() => setFilter(name)}
              className={active ? undefined : "hover-border hover-text"}
              style={{
                background: active ? "var(--color-selected)" : "none",
                border: `1px solid ${active ? "var(--color-border-hover)" : "var(--color-border)"}`,
                color: active ? "var(--color-text)" : "var(--color-muted)",
                borderRadius: 14,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              {name}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          {visible.length} of {rows.length} samples · {runId}
        </span>
      </div>

      {/* Two panes: table + detail aside */}
      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", minHeight: 0 }}>
        <div
          style={{
            flex: "2 1 460px",
            minWidth: 0,
            overflow: "auto",
            borderRight: "1px solid var(--color-border-subtle)",
          }}
        >
          <div
            style={{ minWidth: 680, minHeight: "100%", display: "flex", flexDirection: "column" }}
          >
            {/* Sticky header */}
            <div
              style={{
                ...GRID,
                padding: "8px 16px",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontSize: 10.5,
                color: "var(--color-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                position: "sticky",
                top: 0,
                background: "var(--color-page)",
                zIndex: 2,
              }}
            >
              <span>#</span>
              <span>Model / sample</span>
              <span>Score</span>
              <span>Scorer</span>
              <span>Cost</span>
              <span>Latency</span>
              <span>Status</span>
              <span>Artifact</span>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title="No samples match this filter"
                hint={`0 of ${rows.length} samples — switch back to "All" to see every sample.`}
              />
            ) : (
              visible.map((r) => {
                const failed = isFailed(r.sample);
                const isSel = selected?.sample.globalIndex === r.sample.globalIndex;
                const statusLabel = failed
                  ? "render fail"
                  : r.sample.status === "scored"
                    ? "scored"
                    : r.sample.status;
                return (
                  <button
                    key={r.sample.globalIndex}
                    type="button"
                    aria-selected={isSel}
                    onClick={() => setSelectedIndex(r.sample.globalIndex)}
                    className="smpx-row"
                    style={{
                      ...GRID,
                      width: "100%",
                      boxSizing: "border-box",
                      textAlign: "left",
                      padding: "9px 16px",
                      border: "none",
                      borderBottom: "1px solid var(--color-border-row)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "var(--color-text)",
                      ...(isSel
                        ? {
                            background: "var(--color-selected-row)",
                            boxShadow: "inset 2px 0 0 var(--color-amber)",
                          }
                        : null),
                    }}
                  >
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                      {pad2(r.sample.globalIndex)}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <ModelDot color={r.color} size={8} />
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            ...mono,
                            fontSize: 12.5,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                          }}
                        >
                          {r.modelId}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-faint)" }}>
                          {taskLabel} · sample {r.sample.sampleIndex}/{manifest.samplesPerModel}
                        </span>
                      </span>
                    </span>
                    <span
                      style={{
                        ...mono,
                        fontSize: 12,
                        color: failed ? "var(--color-red)" : "var(--color-text)",
                      }}
                    >
                      {scoreText(r.sample)}
                    </span>
                    <span style={{ ...mono, fontSize: 10, color: "var(--color-muted)" }}>
                      {(r.sample.primaryScorer ?? "—").toUpperCase()}
                    </span>
                    <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
                      {usd(r.sample.costUsd)}
                    </span>
                    <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
                      {r.sample.latencyMs != null ? seconds(r.sample.latencyMs) : "—"}
                    </span>
                    <span
                      style={{
                        ...mono,
                        fontSize: 10.5,
                        color: failed
                          ? "var(--color-red)"
                          : r.sample.status === "scored"
                            ? "var(--color-teal)"
                            : "var(--color-muted)",
                      }}
                    >
                      {statusLabel}
                    </span>
                    {r.sample.hasArtifact ? (
                      <span
                        title={failed ? "artifact captured — render failed" : "artifact available"}
                        aria-label={
                          failed ? "artifact captured — render failed" : "artifact available"
                        }
                        style={{ fontSize: 12 }}
                      >
                        {failed ? "⬚" : "▣"}
                      </span>
                    ) : (
                      <span
                        title="no artifact"
                        aria-label="no artifact"
                        style={{ fontSize: 11, color: "var(--color-faint)" }}
                      >
                        —
                      </span>
                    )}
                  </button>
                );
              })
            )}

            {/* Repro strip — bottom of the left main column, full table width */}
            <div style={{ marginTop: "auto", padding: "12px 16px" }}>
              <ReproStrip manifest={manifest} />
            </div>
          </div>
        </div>

        <SampleDetail
          runId={runId}
          row={selected}
          taskLabel={taskLabel}
          challengePrompt={challengePrompt}
          promptHash={manifest.promptHash}
          samplesPerModel={manifest.samplesPerModel}
          annotations={annotations}
        />
      </div>
    </main>
  );
}
