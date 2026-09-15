"use client";

/**
 * "RATE THIS BUILD" — human visual scoring in the Artifact inspector.
 *
 * Saves a HumanAnnotation with scoreOverride (0–10, 0.5 steps) for the build's
 * shown sample via the annotations API, then refreshes the server view so the
 * derived VISUAL (HUMAN) stat lights up. Append-only: re-rating adds a new
 * annotation; the loader derives "latest per sample wins".
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HumanAnnotation } from "@model-lab/schemas";
import { SectionLabel } from "@/components/ui/primitives";
import { humanVisualByEndpoint } from "@/lib/human-score";

const mono = { fontFamily: "var(--font-mono)" } as const;

type SaveState = { kind: "idle" } | { kind: "saved"; msg: string } | { kind: "error"; msg: string };

export function RateBuildPanel({
  runId,
  endpointId,
  sampleIndex,
  annotations,
}: {
  runId: string;
  endpointId: string;
  sampleIndex: number;
  /** The whole run's annotation trail — panel derives this endpoint's rating. */
  annotations: HumanAnnotation[];
}) {
  const router = useRouter();
  const [score, setScore] = useState(7.5);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  const derived = humanVisualByEndpoint(annotations).get(endpointId) ?? null;

  async function save() {
    if (busy) return;
    setBusy(true);
    setState({ kind: "idle" });
    const saved = score; // capture — slider may move while the POST is in flight
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointId,
          sampleIndex,
          note: note.trim() === "" ? "visual rating" : note.trim(),
          scoreOverride: saved,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNote("");
      setState({
        kind: "saved",
        msg: `Saved ${saved.toFixed(1)}/10 — appended to the audit trail.`,
      });
      router.refresh();
    } catch {
      setState({
        kind: "error",
        msg: "Score could not be saved — ratings need a store-backed run.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <SectionLabel>Rate this build</SectionLabel>
        <span style={{ ...mono, fontSize: 10.5, color: "var(--color-faint)", marginLeft: "auto" }}>
          {derived != null
            ? `your rating: ${derived.value.toFixed(1)} · n=${derived.n}`
            : "no human rating yet"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          aria-label={`Visual score for sample ${sampleIndex}, 0 to 10`}
          style={{ flex: 1, minWidth: 0, accentColor: "var(--color-amber)" }}
        />
        <span
          aria-hidden
          style={{
            ...mono,
            fontSize: 17,
            color: "var(--color-amber)",
            minWidth: 52,
            textAlign: "right",
          }}
        >
          {score.toFixed(1)}/10
        </span>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder='Optional note — defaults to "visual rating"'
        aria-label="Rating note (optional)"
        maxLength={4000}
        style={{
          background: "var(--color-inset)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          padding: "7px 9px",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--color-text)",
        }}
      />
      <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className={busy ? undefined : "hover-amber-border"}
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            fontFamily: "inherit",
            color: busy ? "var(--color-disabled)" : "var(--color-text-secondary)",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Save score"}
        </button>
        <span
          role="status"
          aria-live="polite"
          style={{
            fontSize: 11,
            color: state.kind === "error" ? "var(--color-red)" : "var(--color-teal)",
            minWidth: 0,
          }}
        >
          {state.kind === "idle" ? "" : state.msg}
        </span>
      </span>
      <span style={{ fontSize: 10.5, color: "var(--color-faint)" }}>
        Appended to the audit trail — recorded scores stay untouched.
      </span>
    </div>
  );
}
