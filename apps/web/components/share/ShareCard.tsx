import type { CSSProperties } from "react";
import type { ShareAspect } from "@model-lab/schemas";

/**
 * ShareCard — the export artifact itself. PURE presentational component:
 * the identical tree will feed the Phase 4 PNG/SVG pipeline, so every
 * color and font below is a literal. Do NOT reference app CSS variables
 * here — exports must not depend on app CSS. The greens/reds
 * (#3da87c / #d64545) are deliberate export-palette variants of the app
 * tokens (#46b78c / #e05c5c).
 */

export type ShareCardTheme = "dark" | "light";

export interface ShareCardRow {
  /** model id (mono) — identity, never status */
  id: string;
  /** model identity color — square dot + bar share one hue */
  color: string;
  /** formatted visual score, e.g. "9.2" or footnoted "6.8*" */
  visual: string;
  /** bar width % = visualScore × 10 — the bar encodes VISUAL·HUMAN, not tests */
  pct: number;
  /** "10/12" */
  tests: string;
  testsState: "ok" | "warn" | "partial";
  /** "$0.41" */
  cost: string;
}

export interface ShareCardContent {
  title: string;
  takeaway: string;
  /** ISO date of the run, e.g. "2026-07-31" */
  date: string;
  /** provenance line — NEVER hidden (integrity rule) */
  methodology: string;
  /** e.g. "* mean of n=2 — one sample failed"; appended to the methodology line */
  footnote: string | null;
  /** "run_8f3ac21e · github.com/hugom/model-lab" */
  runLink: string;
  showRepoLink: boolean;
}

interface ThemeTokens {
  bg: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  track: string;
  testsOk: string;
  testsWarn: string;
  testsPartial: string;
}

const THEMES: Record<ShareCardTheme, ThemeTokens> = {
  dark: {
    bg: "#16131d",
    text: "#eae7f0",
    muted: "#948da3",
    faint: "#6b6478",
    border: "#2b2637",
    track: "#2b2637",
    testsOk: "#3da87c",
    testsWarn: "#d64545",
    testsPartial: "#d9a23d",
  },
  light: {
    bg: "#faf8f4",
    text: "#25202e",
    muted: "#6f6880",
    faint: "#8f8899",
    border: "#e2ddd4",
    track: "#e8e3da",
    testsOk: "#3da87c",
    testsWarn: "#d64545",
    testsPartial: "#b07f24",
  },
};

const SIZES: Record<ShareAspect, { w: number; h: number }> = {
  "16:9": { w: 640, h: 360 },
  "1:1": { w: 500, h: 500 },
  "4:5": { w: 420, h: 525 },
};

/* Literal font stacks — no var(--font-*) inside the export artifact. */
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "150px 1fr 64px 66px 58px",
  gap: 10,
};

export function ShareCard({
  rows,
  content,
  theme,
  aspect,
}: {
  rows: ShareCardRow[];
  content: ShareCardContent;
  theme: ShareCardTheme;
  aspect: ShareAspect;
}) {
  const t = THEMES[theme];
  const { w, h } = SIZES[aspect];
  const testsColor: Record<ShareCardRow["testsState"], string> = {
    ok: t.testsOk,
    warn: t.testsWarn,
    partial: t.testsPartial,
  };

  return (
    <div
      style={{
        width: w,
        height: h,
        flex: "0 0 auto",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        padding: "22px 26px",
        boxSizing: "border-box",
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        fontFamily: SANS,
        color: t.text,
      }}
    >
      {/* Brand header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "linear-gradient(135deg,#e8a33d,#d16ba0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 11,
            color: "#1a1420",
            fontFamily: MONO,
            flex: "0 0 22px",
          }}
        >
          ML
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.faint }}>
          model-lab · open-source benchmark run
        </span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: t.faint }}>
          {content.date}
        </span>
      </div>

      {/* Title block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "14px 0 4px" }}>
        <span style={{ fontSize: 23, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>
          {content.title}
        </span>
        <span style={{ fontSize: 13.5, color: t.muted }}>{content.takeaway}</span>
      </div>

      {/* Scorecard rows */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 9,
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        {rows.map((r) => (
          <div key={r.id} style={{ ...GRID, alignItems: "center" }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: MONO,
                fontSize: 11.5,
                color: t.text,
                minWidth: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  flex: "0 0 8px",
                  background: r.color,
                }}
              />
              {r.id}
            </span>
            <span
              aria-hidden
              style={{
                height: 9,
                borderRadius: 3,
                background: t.track,
                overflow: "hidden",
                display: "block",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.min(100, Math.max(0, r.pct))}%`,
                  background: r.color,
                  borderRadius: 3,
                }}
              />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: t.text }}>{r.visual}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: testsColor[r.testsState] }}>
              {r.tests}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: t.faint }}>{r.cost}</span>
          </div>
        ))}
        {/* Column labels */}
        <div style={{ ...GRID, marginTop: -2 }}>
          <span />
          <span />
          <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: t.faint }}>VISUAL·HUMAN</span>
          <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: t.faint }}>TESTS·BROWSER</span>
          <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: t.faint }}>COST</span>
        </div>
      </div>

      {/* Methodology footer — never hidden */}
      <div
        style={{
          display: "flex",
          gap: 10,
          borderTop: `1px solid ${t.border}`,
          paddingTop: 10,
          fontFamily: MONO,
          fontSize: 9.5,
          color: t.faint,
          lineHeight: 1.5,
        }}
      >
        <span style={{ flex: "1 1 auto", minWidth: 0 }}>
          {content.methodology}
          {content.footnote ? ` · ${content.footnote}` : ""}
        </span>
        {content.showRepoLink && (
          <span style={{ marginLeft: "auto", flex: "0 1 auto", textAlign: "right" }}>
            {content.runLink}
          </span>
        )}
      </div>
    </div>
  );
}
