import type { CSSProperties } from "react";
import type { ShareAspect } from "@model-lab/schemas";

/**
 * ShareCard — the export artifact itself. PURE presentational component:
 * the identical tree feeds the Phase 4 PNG/SVG pipeline (html-to-image
 * rasterizes this exact DOM node), so every color and font below is a
 * literal. Do NOT reference app CSS variables here — exports must not
 * depend on app CSS. The greens/reds (#3da87c / #d64545) are deliberate
 * export-palette variants of the app tokens (#46b78c / #e05c5c).
 *
 * Three designed templates share one frame (brand header, title block,
 * methodology footer — the footer is NEVER hidden, integrity rule):
 *  - "new-model-scorecard"  — per-model bar rows (Phase 0)
 *  - "cost-vs-quality"      — compact SVG scatter, pareto dashes (Phase 4)
 *  - "surprise-failure"     — headline render-fail stat layout (Phase 4)
 */

export type ShareCardTheme = "dark" | "light";

/** The templates with a shipped canvas design. The other 7 stay pending. */
export type ShareCardTemplateId =
  | "new-model-scorecard"
  | "cost-vs-quality"
  | "surprise-failure";

export const SHARE_CARD_TEMPLATE_IDS: readonly ShareCardTemplateId[] = [
  "new-model-scorecard",
  "cost-vs-quality",
  "surprise-failure",
];

export function isShareCardTemplate(template: string): template is ShareCardTemplateId {
  return (SHARE_CARD_TEMPLATE_IDS as readonly string[]).includes(template);
}

export interface ShareCardRow {
  /** model id (mono) — identity, never status */
  id: string;
  /** model identity color — square dot + bar + scatter point share one hue */
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
  /* -- numeric/source values (templates + CSV/JSON exports) -------------- */
  /** raw visual mean, null when unscored */
  visualValue: number | null;
  /** samples behind the visual mean */
  visualN: number | null;
  costUsd: number;
  latencyMs: number | null;
  /** samples attempted for this model (samplesPerModel) */
  sampleCount: number;
  /** render failures — preserved as evidence, never hidden */
  failedSamples: number;
  /** error excerpt for the failing sample, e.g. "Uncaught TypeError: …" */
  failureNote: string | null;
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

function ModelSquare({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{ width: 8, height: 8, borderRadius: 2, flex: "0 0 8px", background: color }}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * Template: new-model-scorecard (Phase 0 design, unchanged)
 * ------------------------------------------------------------------------- */

function ScorecardBody({ rows, t }: { rows: ShareCardRow[]; t: ThemeTokens }) {
  const testsColor: Record<ShareCardRow["testsState"], string> = {
    ok: t.testsOk,
    warn: t.testsWarn,
    partial: t.testsPartial,
  };
  return (
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
            <ModelSquare color={r.color} />
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
  );
}

/* ------------------------------------------------------------------------- *
 * Template: cost-vs-quality — compact SVG scatter with pareto dashes
 * ------------------------------------------------------------------------- */

function CostQualityBody({ rows, t }: { rows: ShareCardRow[]; t: ThemeTokens }) {
  const pts = rows.flatMap((r) => (r.visualValue === null ? [] : [{ row: r, score: r.visualValue }]));
  if (pts.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: t.muted,
        }}
      >
        no scored models in this run
      </div>
    );
  }

  const VB_W = 560;
  const VB_H = 292;
  const ML = 44;
  const MR = 78;
  const MT = 18;
  const MB = 36;
  const plotW = VB_W - ML - MR;
  const plotH = VB_H - MT - MB;
  const maxCost = Math.max(0.05, ...pts.map((p) => p.row.costUsd)) * 1.18;
  const pad = maxCost * 0.05; // keeps $0 (local) points off the y-axis
  const yMin = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.score))) - 1);
  const yMax = 10;
  const x = (c: number) => ML + ((c + pad) / (maxCost + pad)) * plotW;
  const y = (s: number) => MT + (1 - (s - yMin) / (yMax - yMin)) * plotH;

  /* Pareto frontier: sorted by cost ascending, keep strict score improvements. */
  const frontier: typeof pts = [];
  let bestScore = -Infinity;
  for (const p of [...pts].sort((a, b) => a.row.costUsd - b.row.costUsd || b.score - a.score)) {
    if (p.score > bestScore) {
      frontier.push(p);
      bestScore = p.score;
    }
  }

  const fmtScore = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = [0, maxCost / 2, maxCost];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "6px 0 2px",
      }}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Cost versus visual quality scatter plot"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* axes */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + plotH} stroke={t.border} strokeWidth={1} />
        <line
          x1={ML}
          y1={MT + plotH}
          x2={ML + plotW}
          y2={MT + plotH}
          stroke={t.border}
          strokeWidth={1}
        />
        {/* y ticks — visual score */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={ML - 4} y1={y(v)} x2={ML} y2={y(v)} stroke={t.border} strokeWidth={1} />
            <text
              x={ML - 8}
              y={y(v) + 3}
              textAnchor="end"
              fontFamily={MONO}
              fontSize={9.5}
              fill={t.faint}
            >
              {fmtScore(v)}
            </text>
          </g>
        ))}
        {/* x ticks — cost per run */}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line
              x1={x(v)}
              y1={MT + plotH}
              x2={x(v)}
              y2={MT + plotH + 4}
              stroke={t.border}
              strokeWidth={1}
            />
            <text
              x={x(v)}
              y={MT + plotH + 15}
              textAnchor="middle"
              fontFamily={MONO}
              fontSize={9.5}
              fill={t.faint}
            >
              ${v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* pareto frontier */}
        {frontier.length >= 2 && (
          <polyline
            points={frontier.map((p) => `${x(p.row.costUsd)},${y(p.score)}`).join(" ")}
            fill="none"
            stroke={t.faint}
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        )}
        {/* points + labels */}
        {pts.map((p) => {
          const px = x(p.row.costUsd);
          const py = y(p.score);
          const flip = px > ML + plotW * 0.66;
          const lx = px + (flip ? -10 : 10);
          const anchor = flip ? "end" : "start";
          return (
            <g key={p.row.id}>
              <circle cx={px} cy={py} r={5.5} fill={p.row.color} />
              <text
                x={lx}
                y={py + 3.5}
                textAnchor={anchor}
                fontFamily={MONO}
                fontSize={10.5}
                fill={t.text}
              >
                {p.row.id}
              </text>
              <text
                x={lx}
                y={py + 16}
                textAnchor={anchor}
                fontFamily={MONO}
                fontSize={9}
                fill={t.faint}
              >
                n={p.row.visualN ?? 0}
                {p.row.failedSamples > 0 ? ` · ${p.row.failedSamples} fail` : ""} · {p.row.cost}
              </text>
            </g>
          );
        })}
        {/* axis captions */}
        <text x={ML} y={10} fontFamily={MONO} fontSize={9} letterSpacing="1" fill={t.faint}>
          VISUAL·HUMAN
        </text>
        <text
          x={ML + plotW}
          y={MT + plotH + 30}
          textAnchor="end"
          fontFamily={MONO}
          fontSize={9}
          letterSpacing="1"
          fill={t.faint}
        >
          COST / RUN (USD) · pareto dashed
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Template: surprise-failure — headline render-fail stat
 * ------------------------------------------------------------------------- */

function SurpriseFailureBody({ rows, t }: { rows: ShareCardRow[]; t: ThemeTokens }) {
  const failTotal = rows.reduce((acc, r) => acc + r.failedSamples, 0);
  const sampleTotal = rows.reduce((acc, r) => acc + r.sampleCount, 0);
  const failing = rows.find((r) => r.failedSamples > 0) ?? null;
  const cheapestPassing = rows
    .filter((r) => r.failedSamples === 0 && r.visualValue !== null)
    .reduce<ShareCardRow | null>(
      (best, r) => (best === null || r.costUsd < best.costUsd ? r : best),
      null,
    );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 13,
      }}
    >
      {/* Headline stat */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 54,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: t.testsWarn,
          }}
        >
          {failTotal}/{sampleTotal}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.14em",
              color: t.testsWarn,
            }}
          >
            RENDER FAILURES
          </span>
          <span style={{ fontSize: 11, color: t.faint }}>
            across {sampleTotal} samples — failure preserved as evidence
          </span>
        </span>
      </div>

      {/* Failing model + error excerpt */}
      {failing !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
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
            <ModelSquare color={failing.color} />
            {failing.id}
            <span style={{ color: t.testsWarn }}>
              {failing.failedSamples === 1
                ? "1 render fail"
                : `${failing.failedSamples} render fails`}{" "}
              · {failing.tests} tests
            </span>
          </span>
          {failing.failureNote !== null && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                lineHeight: 1.55,
                color: t.muted,
                borderLeft: `3px solid ${t.testsWarn}`,
                padding: "5px 10px",
                overflowWrap: "anywhere",
              }}
            >
              {failing.failureNote}
            </span>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 12, color: t.muted }}>no render failures in this run</span>
      )}

      {/* Contrast line */}
      {cheapestPassing !== null && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: t.muted,
            minWidth: 0,
          }}
        >
          <ModelSquare color={cheapestPassing.color} />
          <span style={{ minWidth: 0 }}>
            the cheapest passing model —{" "}
            <span style={{ fontFamily: MONO, color: t.text }}>{cheapestPassing.id}</span> — scored{" "}
            <span style={{ fontFamily: MONO, color: t.text }}>{cheapestPassing.visual}/10</span> at{" "}
            <span style={{ fontFamily: MONO, color: t.text }}>{cheapestPassing.cost}</span>
          </span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Card frame — shared brand header, title block, methodology footer
 * ------------------------------------------------------------------------- */

export function ShareCard({
  rows,
  content,
  theme,
  aspect,
  template = "new-model-scorecard",
}: {
  rows: ShareCardRow[];
  content: ShareCardContent;
  theme: ShareCardTheme;
  aspect: ShareAspect;
  template?: ShareCardTemplateId;
}) {
  const t = THEMES[theme];
  const { w, h } = SIZES[aspect];

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

      {/* Template body */}
      {template === "cost-vs-quality" ? (
        <CostQualityBody rows={rows} t={t} />
      ) : template === "surprise-failure" ? (
        <SurpriseFailureBody rows={rows} t={t} />
      ) : (
        <ScorecardBody rows={rows} t={t} />
      )}

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
