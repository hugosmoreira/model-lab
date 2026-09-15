import type { CSSProperties, ReactNode } from "react";

export interface CategoryBarDatum {
  /** stable key (endpoint id) */
  key: string;
  /** model identity color — identity only, never status */
  color: string;
  /** 0–100 bar width against the category's own scale */
  pct: number;
  /** mono value label beside the bar (may carry failure text) */
  label: ReactNode;
}

export interface CategoryRow {
  name: string;
  /** scorer sublabel, mono ("browser scorer · 5 capability checks of 12") */
  scorer: string;
  /** one bar per model, canonical run order */
  bars: CategoryBarDatum[];
}

const mono: CSSProperties = { fontFamily: "var(--font-mono)" };

/**
 * Grouped per-category horizontal bars (Results screen). Pure DIV chart:
 * each category is a 150px/1fr grid row; each model gets an 8px bar in its
 * identity color with a mono value label to the right.
 */
export function CategoryBars({ categories }: { categories: CategoryRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {categories.map((c) => (
        <div
          key={c.name}
          style={{
            display: "grid",
            gridTemplateColumns: "150px 1fr",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>{c.name}</span>
            <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>{c.scorer}</span>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {c.bars.map((b) => (
              <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  aria-hidden
                  style={{
                    height: 8,
                    borderRadius: 2,
                    width: `${Math.min(100, Math.max(0, b.pct))}%`,
                    background: b.color,
                    flex: "0 1 auto",
                  }}
                />
                <span
                  style={{
                    ...mono,
                    fontSize: 11,
                    color: "var(--color-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
