"use client";

import Link from "next/link";
import { useState } from "react";
import { ModelDot } from "@/components/ui/primitives";
import { FailureTrace, ScenePlaceholder } from "./ScenePlaceholder";
import { encodeEndpointId, type ArenaData, type BuildVM } from "./model";

const mono = { fontFamily: "var(--font-mono)" } as const;

type SortKey = "score" | "cost" | "speed" | "tests";
const SORTS: ReadonlyArray<SortKey> = ["score", "cost", "speed", "tests"];

function sortBuilds(builds: BuildVM[], key: SortKey): BuildVM[] {
  const arr = [...builds];
  arr.sort((a, b) =>
    key === "score"
      ? b.sortScore - a.sortScore
      : key === "cost"
        ? a.sortCost - b.sortCost
        : key === "speed"
          ? a.sortLatency - b.sortLatency
          : b.sortTests - a.sortTests,
  );
  return arr;
}

const BLIND_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

const overlayBtn = {
  background: "rgba(10,8,14,0.8)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "var(--color-text)",
  borderRadius: 5,
  padding: "5px 12px",
  fontSize: 12,
} as const;

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>{label}</span>
      <span style={{ color: color ?? "var(--color-muted)" }}>{value}</span>
    </span>
  );
}

export function ArenaGrid({ data }: { data: ArenaData }) {
  const [blind, setBlind] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const sorted = sortBuilds(data.builds, sort);

  return (
    <>
      {/* Challenge header */}
      <section
        className="panel"
        style={{
          padding: "14px 18px",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            ...mono,
            fontSize: 10.5,
            color: "var(--color-magenta)",
            border: "1px solid var(--color-border-magenta)",
            borderRadius: 3,
            padding: "3px 8px",
            whiteSpace: "nowrap",
          }}
        >
          CHALLENGE · {data.packVersion}
        </span>
        <div style={{ flex: 1, minWidth: 280 }}>
          <p
            style={{
              margin: 0,
              ...mono,
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--color-text-secondary)",
            }}
          >
            {`"${data.prompt}"`}
          </p>
          <span style={{ fontSize: 12, color: "var(--color-faint)" }}>{data.caption}</span>
        </div>
        <button
          type="button"
          onClick={() => setBlind(!blind)}
          aria-pressed={blind}
          className="hover-border"
          style={{
            background: blind ? "var(--color-selected)" : "none",
            border: `1px solid ${blind ? "var(--color-magenta)" : "var(--color-border)"}`,
            color: blind ? "var(--color-magenta)" : "var(--color-muted)",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {blind ? "◉ Blind labels ON" : "○ Blind labels"}
        </button>
        <span
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            fontSize: 12,
            color: "var(--color-faint)",
          }}
        >
          sort:
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className="hover-text"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
                padding: "2px 4px",
                color: sort === s ? "var(--color-amber)" : "var(--color-faint)",
                fontWeight: sort === s ? 600 : 400,
              }}
            >
              {s}
            </button>
          ))}
        </span>
      </section>

      {/* Artifact cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))",
          gap: 14,
        }}
      >
        {sorted.map((b, i) => {
          const href = `/runs/${data.runId}/artifacts/${encodeEndpointId(b.endpointId)}`;
          const name = blind ? `Model ${BLIND_LETTERS[i] ?? "?"}` : b.name;
          const provider = blind ? "hidden until vote" : b.provider;
          const dotColor = blind ? "var(--color-model-blind)" : b.color;
          return (
            <section
              key={b.endpointId}
              style={{
                background: "var(--color-panel)",
                border: `1px solid ${b.renderOk ? "var(--color-border)" : "var(--color-danger-border)"}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {/* Preview area — Phase 2 replaces the placeholder scene with the stored screenshot */}
              <div
                style={{
                  position: "relative",
                  height: 230,
                  background: b.renderOk ? undefined : "var(--color-void)",
                  overflow: "hidden",
                }}
              >
                {b.renderOk ? (
                  <ScenePlaceholder color={b.color} seedKey={b.endpointId} variant="card" />
                ) : (
                  <FailureTrace
                    lines={b.artifact.consoleLines}
                    tail={`screenshot blank · render failed · sample ${b.sampleIndexLabel} shown`}
                    fontSize={12}
                    inset={14}
                  />
                )}
                <span style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 6 }}>
                  <Link href={href} className="hover-amber-border" style={overlayBtn}>
                    ▶ Play
                  </Link>
                  <Link href={href} className="hover-border" style={overlayBtn}>
                    Inspect ⧉
                  </Link>
                </span>
                <span
                  style={{
                    position: "absolute",
                    right: 10,
                    bottom: 10,
                    ...mono,
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 3,
                    background: "rgba(10,8,14,0.8)",
                    border: `1px solid ${b.renderOk ? "rgba(70,183,140,0.4)" : "rgba(224,92,92,0.4)"}`,
                    color: b.renderOk ? "var(--color-teal)" : "var(--color-red)",
                  }}
                >
                  {b.renderOk ? b.sandboxChipLabel : "render failed"}
                </span>
              </div>

              {/* Card footer */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 14px",
                  borderTop: "1px solid var(--color-border-subtle)",
                }}
              >
                <ModelDot color={dotColor} size={9} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span
                    style={{
                      ...mono,
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{provider}</span>
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    gap: "6px 14px",
                    ...mono,
                    fontSize: 11.5,
                  }}
                >
                  <Metric label="VISUAL" value={b.visualLabel} color="var(--color-text)" />
                  <Metric label="TESTS" value={b.testsLabel} color={b.testsColor} />
                  <Metric label="COST" value={b.costLabel} />
                  <Metric label="LATENCY" value={b.latencyLabel} />
                  <Metric label="CONSOLE" value={b.consoleLabel} color={b.consoleColor} />
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
