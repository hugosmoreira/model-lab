"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Run, RunEvent, RunEventLevel, RunModel } from "@model-lab/schemas";
import {
  Callout,
  ModelDot,
  ProgressBar,
  SectionLabel,
  StatusDot,
} from "@/components/ui/primitives";
import { hhmmss, mmss, ttft, tokensK, usd } from "@/lib/format";

const mono = { fontFamily: "var(--font-mono)" } as const;

/** Event severity → text color (status colors, never model colors). */
const LEVEL_COLORS: Record<RunEventLevel, string> = {
  info: "var(--color-muted)",
  success: "var(--color-teal)",
  warn: "var(--color-amber)",
  error: "var(--color-red)",
};

export type LiveModelMeta = {
  modelId: string;
  providerLabel: string;
  color: string;
  excerpt: string;
};

export type LiveFailure = {
  endpointId: string;
  modelId: string;
  sampleIndex: number;
  samplesPerModel: number;
};

export type ConsoleLineVM = {
  t: string; // ISO timestamp
  level: RunEventLevel;
  text: string; // "type.padEnd(16) scope · detail" — pre-composed server-side
};

export type LiveRunScreenProps = {
  runId: string;
  run: Run;
  models: RunModel[];
  modelMeta: Record<string, LiveModelMeta>;
  events: RunEvent[];
  consoleLines: ConsoleLineVM[];
  overallPct: number;
  samplesDone: number;
  samplesTotal: number;
  liveSampleIndex: number;
  failure: LiveFailure | null;
};

const FALLBACK_META: LiveModelMeta = {
  modelId: "unknown",
  providerLabel: "",
  color: "var(--color-model-neutral)",
  excerpt: "",
};

/** Status label derivation — failure count outranks the phase label. */
function statusOf(rm: RunModel): { label: string; color: string; pulse: boolean } {
  if (rm.failedSampleCount > 0 && rm.status !== "completed") {
    return {
      label: `${rm.failedSampleCount} sample${rm.failedSampleCount === 1 ? "" : "s"} failed`,
      color: "var(--color-red)",
      pulse: false,
    };
  }
  switch (rm.status) {
    case "completed":
      return { label: "completed", color: "var(--color-teal)", pulse: false };
    case "queued":
      return { label: "queued", color: "var(--color-faint)", pulse: false };
    case "failed":
      return { label: "failed", color: "var(--color-red)", pulse: false };
    default:
      // generating / testing / scoring — active phases pulse amber
      return { label: rm.status, color: "var(--color-amber)", pulse: true };
  }
}

/** Solid semantic bar color: red while a sample failure exists, teal at 100%, amber otherwise. */
function barColorOf(rm: RunModel): string {
  if (rm.failedSampleCount > 0 && rm.status !== "completed") return "var(--color-red)";
  if (rm.progressPct >= 100) return "var(--color-teal)";
  return "var(--color-amber)";
}

function StripStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{ ...mono, fontSize: 12, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
      {label} {children}
    </span>
  );
}

function ModelCard({
  rm,
  meta,
  events,
  open,
  onToggle,
  liveSampleIndex,
}: {
  rm: RunModel;
  meta: LiveModelMeta;
  events: RunEvent[];
  open: boolean;
  onToggle: () => void;
  liveSampleIndex: number;
}) {
  const status = statusOf(rm);
  const failedBorder = rm.failedSampleCount > 0;
  const streaming = rm.status !== "completed" && rm.status !== "failed";
  const panelId = `live-log-${rm.endpointId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <section
      aria-label={meta.modelId}
      style={{
        background: "var(--color-panel)",
        border: `1px solid ${failedBorder ? "var(--color-danger-border)" : "var(--color-border)"}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 16px",
          alignItems: "center",
          padding: "12px 16px",
        }}
      >
        {/* Identity cell */}
        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 170, flex: "0 1 200px" }}>
          <ModelDot color={meta.color} size={9} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                ...mono,
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {meta.modelId}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{meta.providerLabel}</span>
          </span>
        </span>

        {/* Status label */}
        <span
          className={status.pulse ? "ml-pulse" : undefined}
          style={{ ...mono, fontSize: 11.5, color: status.color, whiteSpace: "nowrap" }}
        >
          {status.label}
        </span>

        {/* Progress + task caption */}
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 150, flex: "1 1 180px" }}>
          <ProgressBar pct={rm.progressPct} color={barColorOf(rm)} />
          <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
            {rm.currentTask ?? "—"}
          </span>
        </span>

        {/* Metric stat trio */}
        <span style={{ ...mono, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {tokensK(rm.tokensOut)}
          <br />
          <span style={{ color: "var(--color-faint)" }}>tokens</span>
        </span>
        <span style={{ ...mono, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {rm.ttftMs != null ? ttft(rm.ttftMs) : "—"}
          <br />
          <span style={{ color: "var(--color-faint)" }}>TTFT</span>
        </span>
        <span style={{ ...mono, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {usd(rm.costUsd)}
          <br />
          <span style={{ color: "var(--color-faint)" }}>cost</span>
        </span>

        {/* Log disclosure */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="hover-border hover-text"
          style={{
            ...mono,
            background: "none",
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            borderRadius: 5,
            padding: "4px 8px",
            fontSize: 12,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          {open ? "▾ log" : "▸ log"}
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
          }}
        >
          <div style={{ padding: "12px 16px", borderRight: "1px solid var(--color-border-subtle)", minWidth: 0 }}>
            <SectionLabel>
              live output · sample {liveSampleIndex}
            </SectionLabel>
            <pre
              style={{
                margin: "8px 0 0",
                ...mono,
                fontSize: 11.5,
                lineHeight: 1.6,
                color: "var(--color-code-green)",
                whiteSpace: "pre-wrap",
                background: "var(--color-inset)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 6,
                padding: "10px 12px",
                maxHeight: 120,
                overflow: "hidden",
              }}
            >
              {meta.excerpt}
              {streaming && <span aria-hidden>▊</span>}
            </pre>
          </div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <SectionLabel>event log</SectionLabel>
            {events.length === 0 ? (
              <span style={{ ...mono, fontSize: 11.5, color: "var(--color-faint)" }}>no events yet</span>
            ) : (
              events.map((e, i) => (
                <span key={`${e.t}-${e.type}-${i}`} style={{ ...mono, fontSize: 11.5, display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--color-faint)", flex: "0 0 auto" }}>{hhmmss(e.t)}</span>
                  <span style={{ color: LEVEL_COLORS[e.level], minWidth: 0 }}>
                    {e.type} — {e.message}
                  </span>
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RunConsole({ lines }: { lines: ConsoleLineVM[] }) {
  const ref = useRef<HTMLDivElement>(null);

  // Newest-last tail: keep the console pinned to the bottom as lines append
  // (Phase 1 streaming will grow `lines` in place).
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Run console"
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-inset)",
        maxHeight: 150,
        overflowY: "auto",
        padding: "10px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        flex: "0 0 auto",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <SectionLabel>run console</SectionLabel>
        <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          events stream · newest last · n={lines.length}
        </span>
      </span>
      {lines.map((l, i) => (
        <span key={`${l.t}-${i}`} style={{ ...mono, fontSize: 11.5, display: "flex", gap: 10 }}>
          <span style={{ color: "var(--color-timestamp)", flex: "0 0 auto" }}>{hhmmss(l.t)}</span>
          <span style={{ color: LEVEL_COLORS[l.level], whiteSpace: "pre-wrap", minWidth: 0 }}>{l.text}</span>
        </span>
      ))}
    </div>
  );
}

export function LiveRunScreen({
  runId,
  run,
  models,
  modelMeta,
  events,
  consoleLines,
  overallPct,
  samplesDone,
  samplesTotal,
  liveSampleIndex,
  failure,
}: LiveRunScreenProps) {
  // Multiple cards can be open at once; models with a failed sample start open
  // (the qwen card in the live fixture).
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      models.filter((m) => m.failedSampleCount > 0).map((m) => [m.endpointId, true] as const),
    ),
  );

  const toggle = (endpointId: string) =>
    setOpen((prev) => ({ ...prev, [endpointId]: !prev[endpointId] }));

  const disabledBtn = {
    fontSize: 13,
    fontFamily: "inherit",
    borderRadius: 6,
    padding: "6px 14px",
    opacity: 0.55,
    cursor: "not-allowed",
  } as const;

  return (
    <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* (1) Run status strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-rail)",
          flexWrap: "wrap",
          flex: "0 0 auto",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <StatusDot color="var(--color-teal)" size={8} glow pulse />
          <span style={{ ...mono, fontSize: 12, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
            {run.id} · {run.mode} · {run.pack.slug} {run.pack.version}
          </span>
        </span>

        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160 }}>
          <span
            style={{
              display: "flex",
              justifyContent: "space-between",
              ...mono,
              fontSize: 11,
              color: "var(--color-muted)",
            }}
          >
            <span>overall</span>
            <span style={{ color: "var(--color-text)" }}>{overallPct}%</span>
          </span>
          <ProgressBar pct={overallPct} gradient />
        </span>

        <StripStat label="elapsed">
          <span style={{ color: "var(--color-text)" }}>{mmss(run.elapsedSec ?? 0)}</span>
        </StripStat>
        <StripStat label="samples">
          <span style={{ color: "var(--color-text)" }}>
            {samplesDone}/{samplesTotal}
          </span>
        </StripStat>
        <StripStat label="cost">
          <span style={{ color: "var(--color-amber)" }}>{usd(run.costSpentUsd)}</span>
          {" / "}
          {usd(run.budgetCeilingUsd)}
        </StripStat>

        <span style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            disabled
            title="wired in Phase 1"
            style={{
              ...disabledBtn,
              background: "var(--color-raised)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            Pause
          </button>
          <button
            type="button"
            disabled
            title="wired in Phase 1"
            style={{
              ...disabledBtn,
              background: "none",
              border: "1px solid var(--color-danger-border)",
              color: "var(--color-red)",
            }}
          >
            Cancel run
          </button>
        </span>
      </div>

      {/* (2) Partial-failure banner — full-width, squared */}
      {failure && (
        <Callout
          variant="danger"
          glyph="⚠"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            alignItems: "center",
            borderRadius: 0,
            border: "none",
            borderBottom: "1px solid var(--color-danger-border)",
            padding: "9px 20px",
            fontSize: 13,
            flex: "0 0 auto",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 260px", minWidth: 0 }}>
              <strong style={{ color: "var(--color-red)" }}>{failure.modelId}</strong> — sample{" "}
              {failure.sampleIndex}/{failure.samplesPerModel} failed to render (uncaught console
              error). The run continues; the failure is preserved as evidence.
            </span>
            <button
              type="button"
              disabled
              title="wired in Phase 1"
              style={{
                background: "none",
                border: "1px solid var(--color-danger-border)",
                color: "var(--color-danger-text)",
                borderRadius: 5,
                padding: "4px 12px",
                fontSize: 12,
                fontFamily: "inherit",
                opacity: 0.55,
                cursor: "not-allowed",
                flex: "0 0 auto",
              }}
            >
              Retry failed sample
            </button>
            <Link
              href={`/runs/${runId}/samples`}
              style={{ fontSize: 12, color: "var(--color-magenta)", flex: "0 0 auto" }}
            >
              Inspect →
            </Link>
          </span>
        </Callout>
      )}

      {/* (3) Scrollable model card list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {models.map((rm) => (
          <ModelCard
            key={rm.endpointId}
            rm={rm}
            meta={modelMeta[rm.endpointId] ?? FALLBACK_META}
            events={events.filter((e) => e.endpointId === rm.endpointId)}
            open={open[rm.endpointId] ?? false}
            onToggle={() => toggle(rm.endpointId)}
            liveSampleIndex={liveSampleIndex}
          />
        ))}
      </div>

      {/* (4) Run console pinned at the bottom */}
      <RunConsole lines={consoleLines} />
    </main>
  );
}
