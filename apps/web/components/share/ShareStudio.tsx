"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { toPng, toSvg } from "html-to-image";
import { ShareAspect, ShareTemplate } from "@model-lab/schemas";
import type { RunManifest } from "@model-lab/schemas";
import { Callout, EmptyState, SectionLabel } from "@/components/ui/primitives";
import { buildAltText, buildCsv, buildJson, buildPostDraft } from "@/lib/share/export-data";
import {
  assertMethodologyRendered,
  copyText,
  downloadDataUrl,
  downloadText,
} from "@/lib/share/download";
import { ShareCard, isShareCardTemplate } from "./ShareCard";
import type { ShareCardContent, ShareCardRow, ShareCardTheme } from "./ShareCard";

const TEMPLATE_LABELS: Record<ShareTemplate, string> = {
  "new-model-scorecard": "New Model Scorecard",
  "head-to-head-winner": "Head-to-Head Winner",
  "cost-vs-quality": "Cost vs Quality",
  "category-breakdown": "Category Breakdown",
  "wtl-matrix": "Win/Tie/Loss Matrix",
  "artifact-montage": "Artifact Montage",
  "surprise-failure": "Surprise Failure",
  "local-vs-cloud": "Local vs Cloud",
  "judge-disagreement": "Judge Disagreement",
  "methodology-card": "Methodology Card",
};

const CARD_THEMES: readonly ShareCardTheme[] = ["dark", "light"];

const TITLE_MAX = 80;
const TAKEAWAY_MAX = 120;

const TEMPLATE_PENDING = "template design pending — future phase";
const EXPORT_BLOCKED = "switch to an enabled template to export";
const METHODOLOGY_LOCKED = "always on for exports — integrity rule";

type ExportKind = "png" | "svg" | "data" | "alt" | "post";
type CopiedKind = "alt" | "post";

const mono = { fontFamily: "var(--font-mono)" } as const;

function selectableStyle(on: boolean): CSSProperties {
  return {
    background: on ? "var(--color-selected)" : "none",
    border: `1px solid ${on ? "var(--color-border-hover)" : "var(--color-border)"}`,
    color: on ? "var(--color-text)" : "var(--color-muted)",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-input)",
  border: "1px solid var(--color-border)",
  borderRadius: 5,
  color: "var(--color-text)",
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: "inherit",
};

const toggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "var(--color-muted)",
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const smallButtonStyle: CSSProperties = {
  flex: 1,
  background: "var(--color-raised)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  borderRadius: 6,
  padding: 7,
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};

const ghostStyle: CSSProperties = {
  background: "none",
  border: "1px solid var(--color-border)",
  color: "var(--color-muted)",
  borderRadius: 6,
  padding: 7,
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "center",
  textDecoration: "none",
  display: "block",
};

function TogglePill({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 26,
        height: 14,
        borderRadius: 7,
        background: on ? "var(--color-teal)" : "var(--color-border)",
        position: "relative",
        display: "inline-block",
        flex: "0 0 26px",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: on ? "#fff" : "var(--color-muted)",
          ...(on ? { right: 2 } : { left: 2 }),
        }}
      />
    </span>
  );
}

function LabeledInput({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontSize: 11.5,
        color: "var(--color-muted)",
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline" }}>
        {label}
        <span style={{ marginLeft: "auto", ...mono, fontSize: 10, color: "var(--color-faint)" }}>
          {value.length}/{maxLength}
        </span>
      </span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

export interface ShareStudioProps {
  /** route run id — export filenames + the bundle download link */
  runId: string;
  /** provenance manifest embedded in the JSON export */
  manifest: RunManifest;
  rows: ShareCardRow[];
  defaultTitle: string;
  defaultTakeaway: string;
  /** ISO run date for the card header */
  date: string;
  /** derived provenance line (never hidden on the card) */
  methodology: string;
  /** e.g. "* mean of n=2 — one sample failed" */
  footnote: string | null;
  /** "run_8f3ac21e · github.com/hugosmoreira/model-lab" */
  runLink: string;
  /** ?template= deep-link preselect (validated by the page) */
  initialTemplate?: ShareTemplate;
}

export function ShareStudio({
  runId,
  manifest,
  rows,
  defaultTitle,
  defaultTakeaway,
  date,
  methodology,
  footnote,
  runLink,
  initialTemplate,
}: ShareStudioProps) {
  const [template, setTemplate] = useState<ShareTemplate>(initialTemplate ?? "new-model-scorecard");
  const [aspect, setAspect] = useState<ShareAspect>("16:9");
  const [theme, setTheme] = useState<ShareCardTheme>("dark");
  const [title, setTitle] = useState(defaultTitle);
  const [takeaway, setTakeaway] = useState(defaultTakeaway);
  const [showRepoLink, setShowRepoLink] = useState(true);

  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopiedKind | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /* showMethodology is locked true (integrity rule) — content always carries it. */
  const content: ShareCardContent = {
    title,
    takeaway,
    date,
    methodology,
    footnote,
    runLink,
    showRepoLink,
  };

  const templateReady = isShareCardTemplate(template);
  const exportsDisabled = busy !== null || !templateReady;
  const exportTitle = templateReady ? undefined : EXPORT_BLOCKED;

  function flashCopied(kind: CopiedKind): void {
    setCopied(kind);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1600);
  }

  /** The ShareCard DOM node — the exact tree the raster exports capture. */
  function cardNode(): HTMLElement {
    const node = stageRef.current?.firstElementChild;
    if (!(node instanceof HTMLElement)) {
      throw new Error("card is not on the canvas — select an enabled template first");
    }
    return node;
  }

  function runExport(kind: ExportKind, fn: () => Promise<void>): void {
    if (busy !== null) return;
    setBusy(kind);
    setError(null);
    void fn()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "export failed");
      })
      .finally(() => setBusy(null));
  }

  const exportPng = () =>
    runExport("png", async () => {
      const node = cardNode();
      assertMethodologyRendered(node, methodology);
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
      downloadDataUrl(dataUrl, `${template}-${runId}.png`);
    });

  const exportSvg = () =>
    runExport("svg", async () => {
      const node = cardNode();
      assertMethodologyRendered(node, methodology);
      const dataUrl = await toSvg(node, { cacheBust: true });
      downloadDataUrl(dataUrl, `${template}-${runId}.svg`);
    });

  const exportData = () =>
    runExport("data", async () => {
      downloadText(buildCsv(rows), `${template}-${runId}.csv`, "text/csv");
      downloadText(
        buildJson(manifest, rows, content),
        `${template}-${runId}.json`,
        "application/json",
      );
    });

  const copyAlt = () =>
    runExport("alt", async () => {
      await copyText(buildAltText(TEMPLATE_LABELS[template], rows, content));
      flashCopied("alt");
    });

  const copyPost = () =>
    runExport("post", async () => {
      await copyText(buildPostDraft(rows, content));
      flashCopied("post");
    });

  return (
    <>
      {/* Controls */}
      <aside
        style={{
          flex: "0 1 260px",
          minWidth: 220,
          boxSizing: "border-box",
          borderRight: "1px solid var(--color-border-subtle)",
          overflowY: "auto",
          padding: "16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Template */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel>Template</SectionLabel>
          {ShareTemplate.options.map((tpl) => {
            const enabled = isShareCardTemplate(tpl);
            return (
              <button
                key={tpl}
                type="button"
                disabled={!enabled}
                aria-pressed={template === tpl}
                onClick={() => setTemplate(tpl)}
                title={enabled ? undefined : TEMPLATE_PENDING}
                className={enabled ? "hover-border" : undefined}
                style={{
                  ...selectableStyle(template === tpl),
                  textAlign: "left",
                  padding: "7px 10px",
                  fontSize: 12.5,
                  ...(enabled ? {} : { opacity: 0.5, cursor: "not-allowed" }),
                }}
              >
                {TEMPLATE_LABELS[tpl]}
                {!enabled && (
                  <span
                    style={{ ...mono, fontSize: 9.5, color: "var(--color-faint)", marginLeft: 6 }}
                  >
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Layout */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel>Layout</SectionLabel>
          <div role="group" aria-label="Aspect ratio" style={{ display: "flex", gap: 6 }}>
            {ShareAspect.options.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={aspect === a}
                onClick={() => setAspect(a)}
                className="hover-border"
                style={{ ...selectableStyle(aspect === a), flex: 1, padding: 6, fontSize: 12 }}
              >
                {a}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Card theme" style={{ display: "flex", gap: 6 }}>
            {CARD_THEMES.map((th) => (
              <button
                key={th}
                type="button"
                aria-pressed={theme === th}
                onClick={() => setTheme(th)}
                className="hover-border"
                style={{ ...selectableStyle(theme === th), flex: 1, padding: 6, fontSize: 12 }}
              >
                {th}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel>Content</SectionLabel>
          <LabeledInput label="Title" value={title} maxLength={TITLE_MAX} onChange={setTitle} />
          <LabeledInput
            label="Takeaway"
            value={takeaway}
            maxLength={TAKEAWAY_MAX}
            onChange={setTakeaway}
          />
          <button
            type="button"
            disabled
            aria-pressed
            title={METHODOLOGY_LOCKED}
            style={{ ...toggleRowStyle, marginTop: 4, cursor: "not-allowed" }}
          >
            <TogglePill on />
            Methodology footer{" "}
            <span style={{ fontSize: 10, color: "var(--color-faint)" }}>
              (always on for exports)
            </span>
          </button>
          <button
            type="button"
            aria-pressed={showRepoLink}
            onClick={() => setShowRepoLink((v) => !v)}
            style={toggleRowStyle}
          >
            <TogglePill on={showRepoLink} />
            Repo + run link
          </button>
        </div>

        {/* Export block — pinned to the bottom */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
          {error !== null && (
            <Callout variant="danger" style={{ padding: "8px 11px", fontSize: 11.5 }}>
              {error}
            </Callout>
          )}
          <button
            type="button"
            disabled={exportsDisabled}
            aria-busy={busy === "png"}
            title={exportTitle}
            onClick={exportPng}
            style={{
              background: "var(--color-amber)",
              border: "none",
              color: "var(--color-on-accent)",
              fontWeight: 600,
              borderRadius: 6,
              padding: 9,
              fontSize: 13,
              fontFamily: "inherit",
              cursor: exportsDisabled ? "not-allowed" : "pointer",
              opacity: exportsDisabled ? 0.65 : 1,
            }}
          >
            {busy === "png" ? "Exporting…" : "Export PNG"}
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={exportsDisabled}
              aria-busy={busy === "svg"}
              title={exportTitle}
              onClick={exportSvg}
              className="hover-border"
              style={{
                ...smallButtonStyle,
                ...(exportsDisabled ? { cursor: "not-allowed", opacity: 0.65 } : {}),
              }}
            >
              {busy === "svg" ? "…" : "SVG"}
            </button>
            <button
              type="button"
              disabled={exportsDisabled}
              aria-busy={busy === "data"}
              title={exportTitle}
              onClick={exportData}
              className="hover-border"
              style={{
                ...smallButtonStyle,
                ...(exportsDisabled ? { cursor: "not-allowed", opacity: 0.65 } : {}),
              }}
            >
              {busy === "data" ? "…" : "CSV/JSON"}
            </button>
            <button
              type="button"
              disabled={exportsDisabled}
              title={exportTitle}
              onClick={copyAlt}
              className="hover-border"
              style={{
                ...smallButtonStyle,
                ...(copied === "alt" ? { color: "var(--color-teal)" } : {}),
                ...(exportsDisabled ? { cursor: "not-allowed", opacity: 0.65 } : {}),
              }}
            >
              {copied === "alt" ? "Copied ✓" : "Alt text"}
            </button>
          </div>
          <button
            type="button"
            disabled={exportsDisabled}
            title={exportTitle}
            onClick={copyPost}
            className="hover-border"
            style={{
              ...ghostStyle,
              width: "100%",
              ...(copied === "post" ? { color: "var(--color-teal)" } : {}),
              ...(exportsDisabled ? { cursor: "not-allowed", opacity: 0.65 } : {}),
            }}
          >
            {copied === "post" ? "Copied ✓" : "Copy post draft"}
          </button>
          <a
            href={`/api/runs/${encodeURIComponent(runId)}/bundle`}
            className="hover-border"
            style={ghostStyle}
          >
            Download run bundle{" "}
            <span style={{ ...mono, fontSize: 10, color: "var(--color-faint)" }}>.zip</span>
          </a>
          <span style={{ fontSize: 10.5, color: "var(--color-faint)", lineHeight: 1.5 }}>
            Publish read-only permalink — <span style={mono}>soon</span>
          </span>
        </div>
      </aside>

      {/* Canvas stage */}
      <section
        style={{
          flex: "1 1 480px",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
          background: "var(--color-stage)",
          overflow: "auto",
        }}
      >
        {isShareCardTemplate(template) ? (
          <div ref={stageRef} style={{ display: "flex", maxWidth: "100%" }}>
            <ShareCard
              template={template}
              rows={rows}
              content={content}
              theme={theme}
              aspect={aspect}
            />
          </div>
        ) : (
          <div className="panel" style={{ width: "min(420px, 100%)" }}>
            <EmptyState
              title={`${TEMPLATE_LABELS[template]} — template design pending`}
              hint="Scorecard, Cost vs Quality, and Surprise Failure export today; seven more land later"
            />
          </div>
        )}
      </section>
    </>
  );
}
