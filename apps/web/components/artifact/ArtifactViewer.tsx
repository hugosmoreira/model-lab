"use client";

import Link from "next/link";
import { useState } from "react";
import type { BrowserTestResult, ConsoleLine, HumanAnnotation } from "@model-lab/schemas";
import { ModelDot, SectionLabel } from "@/components/ui/primitives";
import { CATEGORY_META, groupByCategory, tallyCapability } from "@/lib/checks";
import { ArtifactSandbox } from "./ArtifactSandbox";
import { FailureTrace, ScenePlaceholder } from "./ScenePlaceholder";
import { RateBuildPanel } from "./RateBuildPanel";
import { encodeEndpointId, type BuildVM, type ViewerData } from "./model";

const mono = { fontFamily: "var(--font-mono)" } as const;

type TabId =
  | "preview"
  | "screenshot"
  | "source"
  | "tests"
  | "console"
  | "network"
  | "scores"
  | "methodology"
  | "notes";

const TABS: ReadonlyArray<{ id: TabId; label: string; live: boolean }> = [
  { id: "preview", label: "Preview", live: true },
  { id: "screenshot", label: "Screenshot", live: true },
  { id: "source", label: "Source", live: true },
  { id: "tests", label: "Browser Tests", live: true },
  { id: "console", label: "Console", live: true },
  { id: "network", label: "Network", live: false },
  { id: "scores", label: "Scores", live: false },
  { id: "methodology", label: "Methodology", live: false },
  { id: "notes", label: "Notes", live: false },
];

type ViewportId = "desktop" | "tablet" | "mobile";
const VIEWPORTS: ReadonlyArray<{ id: ViewportId; label: string; width: number | null }> = [
  { id: "desktop", label: "⬜ 100%", width: null },
  { id: "tablet", label: "▭ 760", width: 760 },
  { id: "mobile", label: "▯ 390", width: 390 },
];

const CHECK_MARKS: Record<string, { glyph: string; color: string }> = {
  passed: { glyph: "✓", color: "var(--color-teal)" },
  failed: { glyph: "✗", color: "var(--color-red)" },
  skipped: { glyph: "–", color: "var(--color-faint)" },
  warn: { glyph: "⚠", color: "var(--color-amber)" },
};

const CONSOLE_COLORS: Record<string, string> = {
  info: "var(--color-muted)",
  warn: "var(--color-amber)",
  error: "var(--color-red)",
  muted: "var(--color-faint)",
};

const toolBtn = {
  background: "none",
  border: "1px solid var(--color-border)",
  color: "var(--color-muted)",
  borderRadius: 5,
  width: 26,
  height: 26,
  cursor: "pointer",
  fontSize: 13,
  flex: "0 0 auto",
} as const;

const actionLink = {
  background: "var(--color-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "7px 12px",
  fontSize: 12.5,
  textAlign: "center",
} as const;

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "var(--color-panel)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <span style={{ color: "var(--color-faint)", fontSize: 10 }}>{label}</span>
      <span style={{ fontSize: 15.5, color: color ?? "var(--color-text)" }}>{value}</span>
    </span>
  );
}

/** Framed fail-state stand-in shown INSTEAD of the sandbox iframe. */
function FailFrame({
  widthPx,
  lines,
  tail,
}: {
  widthPx: number | null;
  lines: ConsoleLine[];
  tail: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        alignSelf: "stretch",
        width: widthPx ?? "100%",
        maxWidth: "100%",
        minHeight: 320,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--color-border)",
        background: "var(--color-void)",
        margin: "0 auto",
      }}
    >
      <FailureTrace lines={lines} tail={tail} fontSize={13} inset={18} />
    </div>
  );
}

function ScreenshotPane({ build, widthPx }: { build: BuildVM; widthPx: number | null }) {
  const capture = build.artifact.checks.find((c) => c.name === "screenshot.captured");
  const screenshotSrc = build.artifact.screenshotRef;
  return (
    <div
      style={{
        alignSelf: "stretch",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          flex: 1,
          width: widthPx ?? "100%",
          maxWidth: "100%",
          minHeight: 280,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "var(--color-void)",
          margin: "0 auto",
        }}
      >
        {screenshotSrc != null ? (
          /* Stored capture served by /api/runs/[runId]/screenshots/[...path] */
          // eslint-disable-next-line @next/next/no-img-element -- dynamic run capture, no static import
          <img
            src={screenshotSrc}
            alt={`${build.name} — stored capture, sample ${build.sampleIndexLabel}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : build.renderOk ? (
          /* No stored capture (fixture demo) — placeholder scene */
          <ScenePlaceholder color={build.color} seedKey={build.endpointId} variant="stage" />
        ) : (
          <FailureTrace
            lines={build.artifact.consoleLines}
            tail={`screenshot blank · render failed · sample ${build.sampleIndexLabel} shown`}
            fontSize={13}
            inset={18}
          />
        )}
      </div>
      <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)", textAlign: "center" }}>
        {screenshotSrc != null
          ? `stored capture · ${capture?.note || "browser check capture"}`
          : `stored capture unavailable · ${capture?.note || "no capture"} — placeholder shown`}
      </span>
    </div>
  );
}

function CheckCard({ check }: { check: BrowserTestResult }) {
  const m = CHECK_MARKS[check.status] ?? { glyph: "–", color: "var(--color-faint)" };
  return (
    <div
      title={check.status}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        background: "var(--color-inset-alt)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: 6,
        padding: "8px 12px",
        ...mono,
        fontSize: 12,
      }}
    >
      <span aria-label={check.status} style={{ width: 14, flex: "0 0 14px", color: m.color }}>
        {m.glyph}
      </span>
      <span style={{ color: "var(--color-text-secondary)", flex: 1, minWidth: 0 }}>
        {check.name}
      </span>
      <span style={{ color: "var(--color-faint)", fontSize: 11, textAlign: "right" }}>
        {check.note}
      </span>
    </div>
  );
}

/**
 * The checks, grouped by what they are FOR. The three kinds answer different
 * questions and are never averaged: a failed gate zeroes the headline score,
 * the capability group IS the headline score, and diagnostics measure the
 * harness (they used to be counted, which is how a build that drew nothing at
 * all landed level with a working one).
 */
function ChecksPane({ checks }: { checks: BrowserTestResult[] }) {
  const groups = groupByCategory(checks);
  const tally = tallyCapability(checks);
  return (
    <div
      style={{
        alignSelf: "stretch",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflow: "auto",
        minWidth: 0,
      }}
    >
      {tally.gateDetail != null ? (
        <div
          role="status"
          style={{
            background: "var(--color-inset-alt)",
            border: "1px solid var(--color-danger-border)",
            borderLeft: "3px solid var(--color-red)",
            borderRadius: 6,
            padding: "10px 13px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <span style={{ ...mono, fontSize: 12, color: "var(--color-red)" }}>
            gate failed · {tally.gateDetail}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
            A failed gate means the artifact is broken — the headline score is 0/{tally.total}{" "}
            however many capability checks passed.
          </span>
        </div>
      ) : (
        <div
          style={{
            ...mono,
            fontSize: 11.5,
            color: "var(--color-faint)",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {tally.passed != null ? (
            <>
              <span style={{ color: "var(--color-teal)" }}>gates ok</span>
              <span>
                · capability {tally.passed}/{tally.total} — the headline score
              </span>
            </>
          ) : (
            /* Nothing failed and nothing ran — degraded harness, not a pass. */
            <span>checks did not run — no capability signal for this build</span>
          )}
        </div>
      )}

      {groups.map((g) => {
        const meta = CATEGORY_META[g.category];
        const passed = g.checks.filter((c) => c.status === "passed").length;
        return (
          <div
            key={g.category}
            style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <SectionLabel>{meta.heading}</SectionLabel>
              <span style={{ ...mono, fontSize: 10.5, color: "var(--color-faint)" }}>
                {g.category === "diagnostic"
                  ? `${passed}/${g.checks.length} · not scored`
                  : g.category === "capability" && tally.gateDetail != null
                    ? /* raw tally vs the score the gate forces — never conflated */
                      `${passed}/${g.checks.length} passed · scored 0/${g.checks.length}`
                    : `${passed}/${g.checks.length}`}{" "}
                · {meta.blurb}
              </span>
            </div>
            {g.checks.map((c) => (
              <CheckCard key={c.name} check={c} />
            ))}
          </div>
        );
      })}

      {groups.length === 0 && (
        <span style={{ ...mono, fontSize: 12, color: "var(--color-faint)" }}>
          no browser checks recorded for this build
        </span>
      )}
    </div>
  );
}

function ConsolePane({ lines }: { lines: ConsoleLine[] }) {
  return (
    <div
      style={{
        alignSelf: "stretch",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "auto",
        background: "var(--color-inset)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: 8,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      {lines.length === 0 && (
        <span style={{ ...mono, fontSize: 12, color: "var(--color-faint)" }}>
          no console output
        </span>
      )}
      {lines.map((l, i) => (
        <span
          key={i}
          style={{ ...mono, fontSize: 12, display: "flex", gap: 10, whiteSpace: "pre-wrap" }}
        >
          <span style={{ color: "var(--color-timestamp)", flex: "0 0 auto" }}>{l.t}</span>
          <span style={{ color: CONSOLE_COLORS[l.level] ?? "var(--color-muted)" }}>{l.msg}</span>
        </span>
      ))}
    </div>
  );
}

export function ArtifactViewer({
  data,
  initialEndpointId,
  annotations,
}: {
  data: ViewerData;
  initialEndpointId: string;
  /** Append-only human audit trail for the run — feeds the rating panel. */
  annotations: HumanAnnotation[];
}) {
  const initialIdx = Math.max(
    0,
    data.builds.findIndex((b) => b.endpointId === initialEndpointId),
  );
  const [sel, setSel] = useState(initialIdx);
  const [tab, setTab] = useState<TabId>("preview");
  const [vp, setVp] = useState<ViewportId>("desktop");
  // ⟳ / ⏻ bump this counter; the sandbox iframe key includes it, forcing a remount
  const [frameKey, setFrameKey] = useState(0);

  const build = data.builds[sel] ?? data.builds[0];
  if (!build) return null;

  const widthPx = VIEWPORTS.find((v) => v.id === vp)?.width ?? null;

  function select(i: number) {
    setSel(i);
    const next = data.builds[i];
    if (next) {
      // keep the address bar in sync without a server round-trip
      window.history.replaceState(
        null,
        "",
        `/runs/${data.runId}/artifacts/${encodeEndpointId(next.endpointId)}`,
      );
    }
  }

  function downloadArtifact() {
    if (!build) return;
    const blob = new Blob([build.artifact.source], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = build.artifact.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ flex: 1, display: "flex", flexWrap: "wrap", minHeight: 0 }}>
      {/* Builds rail */}
      <aside
        style={{
          flex: "0 1 230px",
          minWidth: 190,
          borderRight: "1px solid var(--color-border-subtle)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span style={{ display: "block", padding: "12px 14px 8px" }}>
          <SectionLabel>
            {data.packName} · n={data.samplesPerModel}
          </SectionLabel>
        </span>
        {data.builds.map((b, i) => {
          const selected = i === sel;
          return (
            <button
              key={b.endpointId}
              type="button"
              onClick={() => select(i)}
              aria-pressed={selected}
              className={selected ? undefined : "hover-row"}
              style={{
                display: "flex",
                gap: 9,
                alignItems: "center",
                width: "100%",
                boxSizing: "border-box",
                textAlign: "left",
                background: selected ? "var(--color-selected-row)" : "transparent",
                boxShadow: selected ? "inset 2px 0 0 var(--color-amber)" : undefined,
                border: "none",
                borderBottom: "1px solid var(--color-border-row)",
                padding: "10px 14px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--color-text)",
              }}
            >
              <ModelDot color={b.color} size={8} />
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {b.name}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--color-faint)" }}>{b.railMeta}</span>
              </span>
              <span
                aria-hidden
                style={{
                  fontSize: 12,
                  color: b.renderOk ? "var(--color-teal)" : "var(--color-red)",
                }}
              >
                {b.renderOk ? "▣" : "⚠"}
              </span>
            </button>
          );
        })}
        <span
          style={{
            display: "block",
            padding: "14px 14px 8px",
            borderTop: "1px solid var(--color-border-subtle)",
            marginTop: 8,
          }}
        >
          <SectionLabel>Generated files</SectionLabel>
        </span>
        <div
          style={{
            padding: "0 14px 14px",
            ...mono,
            fontSize: 11.5,
            color: "var(--color-muted)",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <span style={{ color: "var(--color-amber)" }}>
            ▸ {build.artifact.filename}{" "}
            <span style={{ color: "var(--color-faint)" }}>{build.artifact.sizeKb}kb</span>
          </span>
          <span style={{ paddingLeft: 12, color: "var(--color-faint)" }}>
            single-file contract — inline CSS/JS, no external deps
          </span>
        </div>
      </aside>

      {/* Center: tabs + stage */}
      <section
        style={{
          flex: "2 1 420px",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <div
          role="tablist"
          aria-label="Artifact panes"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "0 14px",
            borderBottom: "1px solid var(--color-border-subtle)",
            overflowX: "auto",
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-disabled={t.live ? undefined : true}
                onClick={t.live ? () => setTab(t.id) : undefined}
                className={t.live && !active ? "hover-text" : undefined}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${active ? "var(--color-amber)" : "transparent"}`,
                  color: active
                    ? "var(--color-text)"
                    : t.live
                      ? "var(--color-muted)"
                      : "var(--color-disabled)",
                  padding: "11px 10px",
                  cursor: t.live ? "pointer" : "default",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {t.live ? t.label : `${t.label} ·soon`}
              </button>
            );
          })}
          <span
            style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", padding: "6px 0" }}
          >
            {VIEWPORTS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={vp === v.id}
                onClick={() => setVp(v.id)}
                className="hover-text"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  ...mono,
                  color: vp === v.id ? "var(--color-amber)" : "var(--color-faint)",
                  whiteSpace: "nowrap",
                }}
              >
                {v.label}
              </button>
            ))}
            <button
              type="button"
              title="Reload artifact"
              aria-label="Reload artifact"
              onClick={() => setFrameKey((k) => k + 1)}
              className="hover-border"
              style={toolBtn}
            >
              ⟳
            </button>
            <button
              type="button"
              title="Restart isolated preview"
              aria-label="Restart isolated preview"
              onClick={() => setFrameKey((k) => k + 1)}
              className="hover-border"
              style={toolBtn}
            >
              ⏻
            </button>
            <button
              type="button"
              title="Download artifact"
              aria-label="Download artifact"
              onClick={downloadArtifact}
              className="hover-border"
              style={toolBtn}
            >
              ↓
            </button>
          </span>
        </div>

        <div
          style={{
            flex: 1,
            position: "relative",
            background: "var(--color-stage)",
            minHeight: 340,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          {tab === "preview" &&
            (build.renderOk ? (
              <ArtifactSandbox
                key={`${build.endpointId}:${frameKey}`}
                artifact={build.artifact}
                widthPx={widthPx}
              />
            ) : (
              <FailFrame
                widthPx={widthPx}
                lines={build.artifact.consoleLines}
                tail="The artifact loaded but rendered nothing. Failure preserved as evidence — see Browser Tests."
              />
            ))}
          {tab === "screenshot" && <ScreenshotPane build={build} widthPx={widthPx} />}
          {tab === "source" && (
            <pre
              style={{
                alignSelf: "stretch",
                flex: 1,
                margin: 0,
                ...mono,
                fontSize: 12,
                lineHeight: 1.7,
                color: "var(--color-text-secondary)",
                background: "var(--color-inset)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 8,
                padding: "14px 16px",
                overflow: "auto",
                minWidth: 0,
              }}
            >
              {build.artifact.source}
            </pre>
          )}
          {tab === "tests" && <ChecksPane checks={build.artifact.checks} />}
          {tab === "console" && <ConsolePane lines={build.artifact.consoleLines} />}
          <span
            style={{
              position: "absolute",
              right: 26,
              bottom: 22,
              ...mono,
              fontSize: 10.5,
              color: "var(--color-teal)",
              background: "rgba(10,8,14,0.8)",
              border: "1px solid rgba(70,183,140,0.35)",
              borderRadius: 3,
              padding: "3px 8px",
            }}
          >
            {build.sandboxBadgeLabel}
          </span>
        </div>
      </section>

      {/* Inspector */}
      <aside
        style={{
          flex: "1 1 280px",
          maxWidth: 420,
          borderLeft: "1px solid var(--color-border-subtle)",
          overflowY: "auto",
          background: "var(--color-rail)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "13px 15px",
            borderBottom: "1px solid var(--color-border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <ModelDot color={build.color} size={10} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ ...mono, fontSize: 13 }}>{build.name}</span>
            <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{build.provider}</span>
          </span>
        </div>
        <div
          style={{
            padding: "13px 15px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              ...mono,
              fontSize: 12,
            }}
          >
            <StatCard label="VISUAL (HUMAN)" value={build.visualStatLabel} />
            <StatCard label="CAPABILITY" value={build.testsLabel} color={build.testsColor} />
            <StatCard label="COST" value={build.costLabel} />
            <StatCard label="LATENCY" value={build.latencyLabel} />
          </div>
          {build.testsGateDetail != null && (
            <span
              style={{
                ...mono,
                fontSize: 11,
                color: "var(--color-red)",
                lineHeight: 1.5,
                marginTop: -6,
                overflowWrap: "anywhere",
              }}
            >
              gate failed · {build.testsGateDetail}
            </span>
          )}
          <div
            style={{
              borderTop: "1px solid var(--color-border-subtle)",
              borderBottom: "1px solid var(--color-border-subtle)",
              padding: "12px 0",
            }}
          >
            {/* key: reset slider/note/feedback when switching builds */}
            <RateBuildPanel
              key={`${build.endpointId}:${build.artifact.sampleIndex}`}
              runId={data.runId}
              endpointId={build.endpointId}
              sampleIndex={build.artifact.sampleIndex}
              annotations={annotations}
            />
          </div>
          <div>
            <SectionLabel>{data.judgeHeading}</SectionLabel>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--color-muted)" }}>
              {build.artifact.judgeCommentary ?? "No judge commentary recorded for this build."}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Link href="/compare" className="hover-amber-border" style={actionLink}>
              Compare with another model
            </Link>
            <Link href={`/share/${data.runId}`} className="hover-border" style={actionLink}>
              Export screenshot
            </Link>
            <Link
              href={`/runs/${data.runId}/samples`}
              className="hover-border"
              style={{ ...actionLink, background: "none", color: "var(--color-muted)" }}
            >
              View sample trace
            </Link>
          </div>
          <div
            style={{
              borderTop: "1px solid var(--color-border-subtle)",
              paddingTop: 10,
              ...mono,
              fontSize: 11,
              color: "var(--color-faint)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span>
              {data.runId} · sample {build.sampleLabel}
            </span>
            <span>
              prompt {data.promptHash} · seed {build.seedLabel}
            </span>
            <span style={{ overflowWrap: "anywhere" }}>{build.artifact.path}</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
