import { Fragment } from "react";
import type { CSSProperties } from "react";
import type { WtlCell } from "@model-lab/schemas";

export interface WtlRowSpec {
  /** endpoint id — key into the matrix */
  id: string;
  /** short display label for the header and row (shortName) */
  label: string;
}

const CELL_BASE: CSSProperties = {
  textAlign: "center",
  padding: "7px 0",
  borderRadius: 3,
  background: "var(--color-raised)",
};

/**
 * Pairwise win–tie–loss matrix (row vs column) for the order-swapped judge.
 * Teal = net win, red = net loss, amber + ⟲ = reversal-flagged pair (raw
 * tally shown, excluded from the aggregate verdict), "—" self/missing on
 * inset-alt background. Grid is 130px + one 1fr column per model.
 */
export function WTLMatrix({
  rows,
  matrix,
}: {
  rows: WtlRowSpec[];
  matrix: Record<string, Record<string, WtlCell>>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `130px repeat(${rows.length},1fr)`,
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        maxWidth: 560,
      }}
    >
      <span />
      {rows.map((c) => (
        <span key={c.id} style={{ color: "var(--color-faint)", textAlign: "center", padding: "4px 0" }}>
          {c.label}
        </span>
      ))}
      {rows.map((r) => (
        <Fragment key={r.id}>
          <span style={{ color: "var(--color-muted)", display: "flex", alignItems: "center" }}>
            {r.label}
          </span>
          {rows.map((c) => {
            if (c.id === r.id) {
              return (
                <span
                  key={c.id}
                  title="self — not applicable"
                  style={{ ...CELL_BASE, background: "var(--color-inset-alt)", color: "var(--color-faint)" }}
                >
                  —
                </span>
              );
            }
            const cell = matrix[r.id]?.[c.id];
            if (!cell) {
              return (
                <span
                  key={c.id}
                  title="missing — no judgments recorded"
                  style={{ ...CELL_BASE, color: "var(--color-faint)" }}
                >
                  —
                </span>
              );
            }
            const color = cell.reversalFlagged
              ? "var(--color-amber)"
              : cell.w > cell.l
                ? "var(--color-teal)"
                : cell.l > cell.w
                  ? "var(--color-red)"
                  : "var(--color-muted)";
            return (
              <span key={c.id} style={{ ...CELL_BASE, color }}>
                {cell.w}–{cell.t}–{cell.l}
                {cell.reversalFlagged ? " ⟲" : ""}
              </span>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
