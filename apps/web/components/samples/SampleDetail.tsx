"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { BrowserTestResult, HumanAnnotation } from "@model-lab/schemas";
import { EmptyState, ModelDot, SectionLabel } from "@/components/ui/primitives";
import { hhmmss, tokensK, ttft } from "@/lib/format";
import { encodeEndpointId, isFailed, scoreText, type SampleRowData } from "./shared";

const mono = { fontFamily: "var(--font-mono)" } as const;

/** Check-status glyphs: ✓ pass / ✗ fail / – skipped (all carry the note text). */
const TRACE_MARKS: Record<BrowserTestResult["status"], { mark: string; color: string }> = {
  passed: { mark: "✓", color: "var(--color-teal)" },
  failed: { mark: "✗", color: "var(--color-red)" },
  skipped: { mark: "–", color: "var(--color-faint)" },
  warn: { mark: "!", color: "var(--color-amber)" },
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        margin: "6px 0 0",
        ...mono,
        fontSize: 11.5,
        lineHeight: 1.6,
        color: "var(--color-text-secondary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        background: "var(--color-inset)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: 6,
        padding: "9px 11px",
        overflow: "hidden",
      }}
    >
      {children}
    </pre>
  );
}

function Section({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <SectionLabel>{label}</SectionLabel>
        {caption && (
          <span style={{ ...mono, fontSize: 10.5, color: "var(--color-faint)" }}>{caption}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Small client form: POSTs an annotation (optionally carrying a visual score
 * override, 0–10 in 0.5 steps), then refreshes the server data.
 */
function AddNoteForm({
  runId,
  endpointId,
  sampleIndex,
}: {
  runId: string;
  endpointId: string;
  sampleIndex: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [withScore, setWithScore] = useState(false);
  const [score, setScore] = useState(7.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A score-only save is valid — the note defaults to "visual rating".
  const canSubmit = !busy && (note.trim() !== "" || withScore);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointId,
          sampleIndex,
          note: note.trim() === "" ? "visual rating" : note.trim(),
          ...(withScore ? { scoreOverride: score } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNote("");
      setWithScore(false);
      router.refresh();
    } catch {
      setError("Note could not be saved — annotations need a store-backed run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add note — appended to the audit trail, never mutates scores"
        rows={2}
        aria-label="Add annotation note"
        style={{
          resize: "vertical",
          background: "var(--color-inset)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          padding: "7px 9px",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--color-text)",
          minHeight: 40,
        }}
      />
      <label
        style={{
          display: "flex",
          gap: 7,
          alignItems: "center",
          fontSize: 12,
          color: "var(--color-muted)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={withScore}
          onChange={(e) => setWithScore(e.target.checked)}
          style={{ accentColor: "var(--color-amber)" }}
        />
        attach visual score (0–10)
      </label>
      {withScore && (
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            aria-label="Visual score override, 0 to 10"
            style={{ flex: 1, minWidth: 0, accentColor: "var(--color-amber)" }}
          />
          <span
            aria-hidden
            style={{
              ...mono,
              fontSize: 14,
              color: "var(--color-amber)",
              minWidth: 44,
              textAlign: "right",
            }}
          >
            {score.toFixed(1)}
          </span>
        </span>
      )}
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className={canSubmit ? "hover-amber-border" : undefined}
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            fontFamily: "inherit",
            color: canSubmit ? "var(--color-text-secondary)" : "var(--color-disabled)",
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Saving…" : withScore ? "Add note + score" : "Add note"}
        </button>
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--color-red)" }}>
          {error ?? ""}
        </span>
      </span>
    </div>
  );
}

export function SampleDetail({
  runId,
  row,
  taskLabel,
  challengePrompt,
  promptHash,
  samplesPerModel,
  annotations,
}: {
  runId: string;
  row: SampleRowData | null;
  taskLabel: string;
  challengePrompt: string;
  promptHash: string;
  samplesPerModel: number;
  /** Append-only human audit trail for the whole run. */
  annotations: HumanAnnotation[];
}) {
  return (
    <aside
      style={{
        flex: "1 1 320px",
        maxWidth: 480,
        minWidth: 0,
        overflowY: "auto",
        background: "var(--color-rail)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {row == null ? (
        <EmptyState
          title="No sample selected"
          hint="Pick a row from the table to inspect its prompt, response, and scorer trace."
        />
      ) : (
        (() => {
          const s = row.sample;
          const failed = isFailed(s);
          return (
            <>
              {/* Header */}
              <div
                style={{
                  padding: "14px 16px",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <ModelDot color={row.color} size={9} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ ...mono, fontSize: 13 }}>{row.modelId}</span>
                  <span style={{ fontSize: 11, color: "var(--color-faint)" }}>
                    {row.providerLabel} · {taskLabel} · sample {s.sampleIndex}/{samplesPerModel} ·{" "}
                    {s.runId}
                  </span>
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    ...mono,
                    fontSize: 10.5,
                    borderRadius: 3,
                    padding: "3px 8px",
                    whiteSpace: "nowrap",
                    border: `1px solid ${failed ? "var(--color-danger-border)" : "var(--color-border-success)"}`,
                    color: failed ? "var(--color-red)" : "var(--color-teal)",
                  }}
                >
                  {failed ? "render failed" : `scored ${scoreText(s)}`}
                </span>
              </div>

              {/* Body */}
              <div
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  fontSize: 13,
                }}
              >
                <Section label="Prompt" caption={`shared · hash ${promptHash}`}>
                  <CodeBlock>{challengePrompt}</CodeBlock>
                </Section>

                <Section label="Raw response · excerpt">
                  <CodeBlock>{s.rawExcerpt}</CodeBlock>
                </Section>

                <Section label="Scorer trace">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    {s.scorerTrace.map((t) => {
                      const m = TRACE_MARKS[t.status];
                      return (
                        <span
                          key={t.name}
                          style={{ ...mono, fontSize: 11.5, display: "flex", gap: 8 }}
                        >
                          <span style={{ color: m.color, flex: "0 0 auto" }}>{m.mark}</span>
                          <span style={{ color: "var(--color-muted)", minWidth: 0 }}>
                            {t.name}
                            {t.note ? ` — ${t.note}` : ""}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </Section>

                <Section label="Metadata">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr",
                      gap: "4px 10px",
                      marginTop: 6,
                      ...mono,
                      fontSize: 11.5,
                      color: "var(--color-muted)",
                    }}
                  >
                    <span style={{ color: "var(--color-faint)" }}>tokens</span>
                    <span>{s.tokensOut != null ? `≈${tokensK(s.tokensOut)} out` : "—"}</span>
                    <span style={{ color: "var(--color-faint)" }}>ttft</span>
                    <span>{s.ttftMs != null ? ttft(s.ttftMs) : "—"}</span>
                    <span style={{ color: "var(--color-faint)" }}>seed</span>
                    <span>{s.seed != null ? String(s.seed) : "unseeded (unsupported)"}</span>
                    <span style={{ color: "var(--color-faint)" }}>endpoint</span>
                    <span>{row.endpointLabel}</span>
                  </div>
                </Section>

                <Section label="Human notes & override">
                  <div
                    style={{
                      marginTop: 6,
                      background: "var(--color-panel)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      padding: "9px 11px",
                      fontSize: 12.5,
                      color: "var(--color-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {s.humanNote ?? "No override — score as recorded."}
                  </div>

                  {/* Append-only annotations for THIS sample */}
                  {(() => {
                    const own = annotations.filter(
                      (a) => a.endpointId === s.endpointId && a.sampleIndex === s.sampleIndex,
                    );
                    if (own.length === 0) return null;
                    return (
                      <div
                        style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}
                      >
                        {own.map((a, i) => (
                          <div
                            key={`${a.at}-${i}`}
                            style={{
                              background: "var(--color-inset-alt)",
                              border: "1px solid var(--color-border-subtle)",
                              borderRadius: 6,
                              padding: "8px 10px",
                            }}
                          >
                            <p
                              style={{
                                margin: 0,
                                fontSize: 12.5,
                                lineHeight: 1.5,
                                color: "var(--color-text-secondary)",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {a.note}
                            </p>
                            <span
                              style={{
                                ...mono,
                                fontSize: 10.5,
                                color: "var(--color-faint)",
                                display: "block",
                                marginTop: 4,
                              }}
                            >
                              {a.author} · {a.at.slice(0, 10)} {hhmmss(a.at)}
                              {a.scoreOverride != null ? (
                                <>
                                  {" · "}
                                  <span style={{ color: "var(--color-amber)" }}>
                                    score {a.scoreOverride.toFixed(1)}
                                  </span>{" "}
                                  (recorded score untouched)
                                </>
                              ) : (
                                ""
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <AddNoteForm runId={runId} endpointId={s.endpointId} sampleIndex={s.sampleIndex} />

                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-faint)",
                      display: "block",
                      marginTop: 4,
                    }}
                  >
                    Audit: {annotations.length} annotation{annotations.length === 1 ? "" : "s"} ·
                    overrides never mutate recorded scores
                  </span>
                </Section>

                <div style={{ display: "flex", gap: 8 }}>
                  {s.hasArtifact && (
                    <Link
                      href={`/runs/${runId}/artifacts/${encodeEndpointId(s.endpointId)}`}
                      className="hover-amber-border"
                      style={{
                        background: "var(--color-raised)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Open artifact
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled
                    title="Phase 6"
                    style={{
                      background: "none",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-disabled)",
                      borderRadius: 6,
                      padding: "6px 12px",
                      cursor: "not-allowed",
                      fontSize: 12,
                      fontFamily: "inherit",
                    }}
                  >
                    Compare across models
                  </button>
                </div>
              </div>
            </>
          );
        })()
      )}
    </aside>
  );
}
