"use client";

import { useEffect, useRef, useState } from "react";
import type { RunManifest } from "@model-lab/schemas";

function Field({ k, v }: { k: string; v: string }) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "0 14px",
        borderRight: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-faint)",
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        {v}
      </span>
    </span>
  );
}

export function ReproStrip({ manifest }: { manifest: RunManifest }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — leave the label unchanged
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--color-inset-alt)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "8px 12px",
        overflowX: "auto",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      <Field k="fingerprint" v={manifest.fingerprint} />
      <Field k="run" v={manifest.runId} />
      <Field k="benchmark" v={manifest.benchmark} />
      <Field k="prompt hash" v={manifest.promptHash} />
      <Field k="runner" v={manifest.runnerVersion} />
      <Field k="date" v={manifest.date} />
      <Field k="samples" v={`n=${manifest.samplesPerModel} × ${manifest.modelCount} models`} />
      <Field k="scorers" v={manifest.scorers.join(" + ")} />
      <span style={{ marginLeft: "auto", paddingLeft: 14, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={copyManifest}
          aria-live="polite"
          className="hover-amber-border"
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
            borderRadius: 5,
            padding: "5px 10px",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          {copied ? "Copied ✓" : "Copy Manifest"}
        </button>
        <button
          type="button"
          className="hover-border"
          style={{
            background: "none",
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            borderRadius: 5,
            padding: "5px 10px",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          View Methodology
        </button>
      </span>
    </div>
  );
}
