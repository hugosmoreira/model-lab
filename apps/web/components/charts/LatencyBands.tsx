export interface LatencyBandRow {
  /** display label (full model id) */
  label: string;
  /** model identity color — identity only, never status */
  color: string;
  minMs: number;
  medianMs: number;
  maxMs: number;
}

/** "17.8" below one minute, "96" at or above (matches prototype range strings). */
function fmtSec(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? String(Math.round(s)) : s.toFixed(1);
}

/** Shared linear scale ceiling: next 10s step above the slowest max. */
function niceCeilMs(ms: number): number {
  return Math.max(10_000, Math.ceil(ms / 10_000) * 10_000);
}

/**
 * Latency min–max bands on one shared 0→niceCeil(max) linear scale (Results).
 * 10px track, band at 0.45 opacity spanning min→max, 2px solid median tick.
 */
export function LatencyBands({ rows }: { rows: LatencyBandRow[] }) {
  const scaleMs = niceCeilMs(Math.max(0, ...rows.map((r) => r.maxMs)));
  const pct = (ms: number) => (ms / scaleMs) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-muted)",
            }}
          >
            <span>{r.label}</span>
            <span>
              {fmtSec(r.minMs)}–{fmtSec(r.maxMs)}s
            </span>
          </span>
          <div
            role="img"
            aria-label={`${r.label}: ${fmtSec(r.minMs)} to ${fmtSec(r.maxMs)} seconds, median ${fmtSec(r.medianMs)} seconds`}
            style={{
              position: "relative",
              height: 10,
              borderRadius: 3,
              background: "var(--color-raised)",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                bottom: 2,
                borderRadius: 2,
                left: `${pct(r.minMs)}%`,
                width: `${pct(r.maxMs) - pct(r.minMs)}%`,
                background: r.color,
                opacity: 0.45,
              }}
            />
            <span
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 2,
                left: `${pct(r.medianMs)}%`,
                background: r.color,
              }}
            />
          </div>
        </div>
      ))}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-faint)" }}>
        shared scale 0–{Math.round(scaleMs / 1000)}s · band = min–max · tick = median
      </span>
    </div>
  );
}
