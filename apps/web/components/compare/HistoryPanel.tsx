import { Panel } from "@/components/ui/primitives";

export interface HistoryRow {
  pairIndex: number;
  /** "5/6" */
  index: string;
  /** "gpt-5.2-mini vs gemini-3-fl" (short names) */
  pairing: string;
  /** "you: A wins · high" | "pending your vote" | "skipped / invalid" */
  yourVote: string;
  /** CSS color (design token var) for the your-vote cell */
  yourVoteColor: string;
  /** "judge: A wins · both orders" | "REVERSED on swap ⟲" | "hidden until you vote" | "—" */
  judge: string;
  /** CSS color (design token var) for the judge cell */
  judgeColor: string;
}

/** Aggregate voting-history panel over the merged pair queue (presentational). */
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
              gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
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
                color: r.yourVoteColor,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.yourVote}
            </span>
            <span
              style={{
                color: r.judgeColor,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.judge}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
