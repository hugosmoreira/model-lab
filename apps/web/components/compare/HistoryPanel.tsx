import { Panel } from "@/components/ui/primitives";

export interface HistoryRow {
  pairIndex: number;
  /** "5/6" */
  index: string;
  /** "gpt-5.2-mini vs gemini-3-fl" (short names) */
  pairing: string;
  result: string;
  /** CSS color (design token var) for the result cell */
  resultColor: string;
  order: string;
}

/** Aggregate voting-history panel (server-rendered, pure fixture data). */
export function HistoryPanel({ rows, runId }: { rows: HistoryRow[]; runId: string }) {
  return (
    <Panel style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Aggregate voting history · this run</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-faint)" }}>
          {runId} · n={rows.length} pairs
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {rows.map((r) => (
          <div
            key={r.pairIndex}
            style={{
              display: "grid",
              gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr) minmax(90px,130px)",
              gap: 12,
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--color-muted)",
            }}
          >
            <span style={{ color: "var(--color-faint)" }}>{r.index}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.pairing}
            </span>
            <span
              style={{
                color: r.resultColor,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.result}
            </span>
            <span style={{ color: "var(--color-faint)" }}>{r.order}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
