"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { ShareAspect, ShareTemplate } from "@model-lab/schemas";
import { EmptyState, SectionLabel } from "@/components/ui/primitives";
import { ShareCard } from "./ShareCard";
import type { ShareCardRow, ShareCardTheme } from "./ShareCard";

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

const PHASE4_EXPORT = "export pipeline lands in Phase 4";
const METHODOLOGY_LOCKED = "always on for exports — integrity rule";

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
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--color-muted)" }}>
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
  rows: ShareCardRow[];
  defaultTitle: string;
  defaultTakeaway: string;
  /** ISO run date for the card header */
  date: string;
  /** derived provenance line (never hidden on the card) */
  methodology: string;
  /** e.g. "* mean of n=2 — one sample failed" */
  footnote: string | null;
  /** "run_8f3ac21e · github.com/hugom/model-lab" */
  runLink: string;
}

export function ShareStudio({
  rows,
  defaultTitle,
  defaultTakeaway,
  date,
  methodology,
  footnote,
  runLink,
}: ShareStudioProps) {
  const [template, setTemplate] = useState<ShareTemplate>("new-model-scorecard");
  const [aspect, setAspect] = useState<ShareAspect>("16:9");
  const [theme, setTheme] = useState<ShareCardTheme>("dark");
  const [title, setTitle] = useState(defaultTitle);
  const [takeaway, setTakeaway] = useState(defaultTakeaway);
  const [showRepoLink, setShowRepoLink] = useState(true);

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
          {ShareTemplate.options.map((tpl) => (
            <button
              key={tpl}
              type="button"
              aria-pressed={template === tpl}
              onClick={() => setTemplate(tpl)}
              className="hover-border"
              style={{
                ...selectableStyle(template === tpl),
                textAlign: "left",
                padding: "7px 10px",
                fontSize: 12.5,
              }}
            >
              {TEMPLATE_LABELS[tpl]}
            </button>
          ))}
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
            <span style={{ fontSize: 10, color: "var(--color-faint)" }}>(always on for exports)</span>
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
          <button
            type="button"
            disabled
            title={PHASE4_EXPORT}
            style={{
              background: "var(--color-amber)",
              border: "none",
              color: "var(--color-on-accent)",
              fontWeight: 600,
              borderRadius: 6,
              padding: 9,
              fontSize: 13,
              fontFamily: "inherit",
              cursor: "not-allowed",
              opacity: 0.65,
            }}
          >
            Export PNG
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            {["SVG", "CSV/JSON", "Alt text"].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                title={PHASE4_EXPORT}
                style={{
                  flex: 1,
                  background: "var(--color-raised)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                  borderRadius: 6,
                  padding: 7,
                  fontSize: 12,
                  fontFamily: "inherit",
                  cursor: "not-allowed",
                  opacity: 0.65,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled
            title={PHASE4_EXPORT}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
              borderRadius: 6,
              padding: 7,
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "not-allowed",
              opacity: 0.65,
            }}
          >
            Copy post draft
          </button>
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
        {template === "new-model-scorecard" ? (
          <ShareCard
            rows={rows}
            content={{ title, takeaway, date, methodology, footnote, runLink, showRepoLink }}
            theme={theme}
            aspect={aspect}
          />
        ) : (
          <div className="panel" style={{ width: "min(420px, 100%)" }}>
            <EmptyState
              title={`${TEMPLATE_LABELS[template]} — template design pending`}
              hint="Phase 4 ships Cost vs Quality and Surprise Failure next"
            />
          </div>
        )}
      </section>
    </>
  );
}
