export interface ScatterPoint {
  label: string;
  color: string;
  costUsd: number;
  score: number; // 0–10
  failed?: boolean;
  /** optional min–max whisker on the score axis */
  scoreMin?: number;
  scoreMax?: number;
}

/**
 * Cost-vs-quality scatter (Mission Control + Results). Data-driven port of the
 * prototype SVG (viewBox 300×180). X: $0 → xMax linear; Y: 0–10 linear.
 */
export function CostQualityScatter({
  points,
  showPareto = false,
  footnote,
}: {
  points: ScatterPoint[];
  showPareto?: boolean;
  footnote?: string;
}) {
  const W = 300;
  const H = 180;
  const X0 = 34;
  const X1 = 290;
  const Y0 = 150; // baseline
  const Y1 = 10;
  const xMax = Math.max(0.5, ...points.map((p) => p.costUsd)) * 1.15;

  const x = (c: number) => X0 + ((X1 - X0) * c) / xMax;
  const y = (s: number) => Y0 - ((Y0 - Y1) * s) / 10;

  // Pareto frontier: non-dominated points (higher score, lower cost), by cost asc
  const frontier = showPareto
    ? [...points]
        .filter((p) => !p.failed)
        .sort((a, b) => a.costUsd - b.costUsd)
        .filter((p, _, arr) =>
          arr.every((q) => q === p || !(q.costUsd <= p.costUsd && q.score > p.score)),
        )
    : [];

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`Cost versus visual quality scatter plot: ${points
          .map((p) => `${p.label} at $${p.costUsd.toFixed(2)}, score ${p.score}`)
          .join("; ")}`}
      >
        <line x1={X0} y1={Y1} x2={X0} y2={Y0} stroke="var(--color-border)" strokeWidth={1} />
        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="var(--color-border)" strokeWidth={1} />
        <text x={X0 - 6} y={Y1 + 4} textAnchor="end" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">
          10
        </text>
        <text x={X0 - 6} y={Y0 + 4} textAnchor="end" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">
          0
        </text>
        <text x={X0} y={Y0 + 16} fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">
          $0.00
        </text>
        <text x={X1} y={Y0 + 16} textAnchor="end" fontSize={10} fill="var(--color-faint)" fontFamily="var(--font-mono)">
          ${xMax.toFixed(2)}
        </text>
        <text
          x={X0 - 22}
          y={(Y0 + Y1) / 2}
          fontSize={10}
          fill="var(--color-faint)"
          fontFamily="var(--font-mono)"
          transform={`rotate(-90 ${X0 - 22} ${(Y0 + Y1) / 2})`}
          textAnchor="middle"
        >
          visual ↑
        </text>

        {showPareto && frontier.length >= 2 && (
          <>
            <polyline
              points={frontier.map((p) => `${x(p.costUsd)},${y(p.score)}`).join(" ")}
              fill="none"
              stroke="var(--color-insight-border)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={x(frontier[frontier.length - 1]!.costUsd) - 6}
              y={y(frontier[frontier.length - 1]!.score) - 10}
              textAnchor="end"
              fontSize={9.5}
              fill="var(--color-faint)"
              fontFamily="var(--font-mono)"
            >
              pareto frontier
            </text>
          </>
        )}

        {points.map((p) => (
          <g key={p.label}>
            {p.scoreMin != null && p.scoreMax != null && (
              <line
                x1={x(p.costUsd)}
                y1={y(p.scoreMin)}
                x2={x(p.costUsd)}
                y2={y(p.scoreMax)}
                stroke={p.color}
                strokeWidth={1}
                opacity={0.5}
              />
            )}
            <circle
              cx={x(p.costUsd)}
              cy={y(p.score)}
              r={6}
              fill={p.color}
              stroke={p.failed ? "var(--color-red)" : "none"}
              strokeWidth={p.failed ? 1.5 : 0}
              strokeDasharray={p.failed ? "2 2" : undefined}
            />
            <text
              x={x(p.costUsd) + 9}
              y={y(p.score) + 3}
              fontSize={10}
              fill="var(--color-muted)"
              fontFamily="var(--font-mono)"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      {footnote && (
        <figcaption style={{ fontSize: 11, color: "var(--color-faint)", marginTop: 6 }}>
          {footnote}
        </figcaption>
      )}
    </figure>
  );
}
