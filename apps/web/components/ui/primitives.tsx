import type { CSSProperties, ReactNode } from "react";

/** Panel card: bg panel, 1px border, radius 8. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="panel" style={style}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  caption,
  action,
}: {
  title: ReactNode;
  caption?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      {caption && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-faint)" }}>
          {caption}
        </span>
      )}
      {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="section-label">{children}</span>;
}

/** Model identity dot: SQUARE, radius 2 (never encodes status). */
export function ModelDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: 2,
        background: color,
        display: "inline-block",
      }}
    />
  );
}

/** Status/liveness dot: CIRCLE. */
export function StatusDot({
  color,
  size = 7,
  glow = false,
  pulse = false,
}: {
  color: string;
  size?: number;
  glow?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={pulse ? "ml-pulse" : undefined}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: "50%",
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : undefined,
        display: "inline-block",
      }}
    />
  );
}

/** Thin progress track (Mission Control / Live Run: 5px; TopBar: 4px). */
export function ProgressBar({
  pct,
  color,
  gradient = false,
  height = 5,
}: {
  pct: number;
  color?: string;
  gradient?: boolean;
  height?: number;
}) {
  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        display: "block",
        height,
        borderRadius: 3,
        background: "var(--color-border)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: gradient
            ? "linear-gradient(90deg,#e8a33d,#d16ba0)"
            : (color ?? "var(--color-amber)"),
        }}
      />
    </span>
  );
}

const MODE_COLORS: Record<string, string> = {
  "build-arena": "var(--color-magenta)",
  verified: "var(--color-model-gpt)",
  performance: "var(--color-muted)",
  "head-to-head": "var(--color-model-gemini)",
  custom: "var(--color-faint)",
};

export function ModeBadge({ mode }: { mode: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: MODE_COLORS[mode] ?? "var(--color-muted)",
        border: "1px solid var(--color-border)",
        borderRadius: 3,
        padding: "2px 6px",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {mode}
    </span>
  );
}

export const RUN_STATUS_COLORS: Record<string, string> = {
  running: "var(--color-amber)",
  completed: "var(--color-teal)",
  partial: "var(--color-amber)",
  failed: "var(--color-red)",
  cancelled: "var(--color-faint)",
  paused: "var(--color-muted)",
  queued: "var(--color-faint)",
};

export function Callout({
  variant,
  glyph,
  children,
  style,
}: {
  variant: "warning" | "danger" | "insight" | "note";
  glyph?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const styles: Record<string, CSSProperties> = {
    warning: {
      background: "var(--color-warning-bg)",
      border: "1px solid var(--color-warning-border)",
      color: "var(--color-warning-text)",
    },
    danger: {
      background: "var(--color-danger-bg)",
      border: "1px solid var(--color-danger-border)",
      color: "var(--color-danger-text)",
    },
    insight: {
      background: "var(--color-insight)",
      border: "1px solid var(--color-insight-border)",
      color: "var(--color-text-secondary)",
    },
    note: {
      background: "var(--color-panel)",
      border: "1px solid var(--color-border)",
      color: "var(--color-muted)",
    },
  };
  return (
    <div
      style={{
        ...styles[variant],
        borderRadius: 8,
        padding: "11px 15px",
        fontSize: 12.5,
        lineHeight: 1.6,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        ...style,
      }}
    >
      {glyph && <span aria-hidden>{glyph}</span>}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-muted)" }}>{title}</span>
      {hint && <span style={{ fontSize: 12.5, color: "var(--color-faint)" }}>{hint}</span>}
    </div>
  );
}
