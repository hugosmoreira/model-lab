"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ModelDefinition, ModelEndpoint, Provider } from "@model-lab/schemas";
import { Callout, EmptyState, ModelDot, Panel } from "@/components/ui/primitives";

const mono = { fontFamily: "var(--font-mono)" } as const;

/** Audit: grid-template-columns 1.6fr 110px 90px 100px 130px 90px 90px 100px 90px, gap 10. */
const GRID = {
  display: "grid",
  gridTemplateColumns: "1.6fr 110px 90px 100px 130px 90px 90px 100px 90px",
  gap: 10,
} as const;

type EndpointStatus = ModelEndpoint["status"];

/** Status is health/load state — never the model identity color. */
const STATUS_META: Record<EndpointStatus, { label: string; color: string }> = {
  healthy: { label: "healthy", color: "var(--color-teal)" },
  loaded: { label: "loaded", color: "var(--color-teal)" },
  "rate-limited": { label: "rate-limited", color: "var(--color-amber)" },
  "not-loaded": { label: "not loaded", color: "var(--color-faint)" },
};

/**
 * Resolved audit ambiguity: the prototype renders 84% red and 95%/100% teal
 * without naming a cutoff. We standardize on reliabilityPct >= 95 ⇒ teal
 * (pass), < 95 ⇒ red (fail); null ⇒ faint "—" (never measured). 95 is the
 * lowest value the prototype shows in teal, so it is the tightest threshold
 * consistent with the design.
 */
const RELIABILITY_PASS_THRESHOLD = 95;

/** "400k" / "1M" / "10M" from a raw context-window token count. */
function ctxLabel(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/** "$3 / $15" (in/out per Mtok); local endpoints have null prices ⇒ "$0 (local)". */
function priceLabel(ep: ModelEndpoint): string {
  if (ep.priceInPerMtokUsd == null || ep.priceOutPerMtokUsd == null) return "$0 (local)";
  return `$${ep.priceInPerMtokUsd} / $${ep.priceOutPerMtokUsd}`;
}

/** "local" / "cloud" as-is; "aggregator" reads as "hosted" (matches endpointProviderLabel). */
function deploymentLabel(ep: ModelEndpoint): string {
  return ep.deployment === "aggregator" ? "hosted" : ep.deployment;
}

/**
 * Relative recency ("today" / "5d ago" / "1w ago" / "1mo ago") measured
 * against the dataset's newest lastTestedAt — the fixtures' notion of "now" —
 * so the demo data never rots as wall-clock time moves on.
 */
function relativeDay(iso: string, anchorIso: string): string {
  const days = Math.round((Date.parse(anchorIso) - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return iso;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const HEADERS = [
  "Model",
  "Status",
  "Ctx",
  "Price per Mtok",
  "Capabilities",
  "Runs",
  "Reliability",
  "Avg visual",
  "Last tested",
] as const;

export function ModelsRegistry({
  endpoints,
  modelDefinitions,
  providers,
  resultsRunId,
}: {
  endpoints: ModelEndpoint[];
  modelDefinitions: ModelDefinition[];
  providers: Provider[];
  resultsRunId: string;
}) {
  const [query, setQuery] = useState("");

  const modelById = useMemo(
    () => new Map(modelDefinitions.map((m) => [m.id, m])),
    [modelDefinitions],
  );
  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

  /** Newest lastTestedAt across the registry = the fixture dataset's "today". */
  const anchorIso = useMemo(() => {
    let max = "";
    for (const ep of endpoints) {
      if (ep.lastTestedAt && ep.lastTestedAt > max) max = ep.lastTestedAt;
    }
    return max;
  }, [endpoints]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return endpoints;
    return endpoints.filter((ep) => {
      const model = modelById.get(ep.modelId);
      const provider = providerById.get(ep.providerId);
      const haystack = [
        ep.id,
        ep.modelId,
        model?.family ?? "",
        model?.shortName ?? "",
        ep.providerId,
        provider?.name ?? "",
        deploymentLabel(ep),
        ep.quantization ?? "",
        ...(model?.capabilities ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [endpoints, query, modelById, providerById]);

  /** First model id served by more than one endpoint — drives the footer callout. */
  const duplicate = useMemo(() => {
    const byModel = new Map<string, ModelEndpoint[]>();
    for (const ep of endpoints) {
      const list = byModel.get(ep.modelId) ?? [];
      list.push(ep);
      byModel.set(ep.modelId, list);
    }
    for (const [modelId, list] of byModel) {
      if (list.length > 1) return { modelId, list };
    }
    return null;
  }, [endpoints]);

  return (
    <main
      style={{
        flex: 1,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxWidth: 1360,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 220px",
            maxWidth: 360,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--color-input)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          <span aria-hidden style={{ fontSize: 12, color: "var(--color-faint)" }}>
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model registry…"
            aria-label="Search model registry by model id, family, provider, or capability"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--color-text)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: "var(--color-faint)" }}>
          Same model on different providers = separate endpoints — never merged.
        </span>
        <span role="status" style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          {filtered.length}/{endpoints.length} endpoints
        </span>
        <button
          type="button"
          disabled
          title="registration lands with the runner — Phase 2"
          style={{
            marginLeft: "auto",
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-disabled)",
            borderRadius: 6,
            padding: "7px 14px",
            fontSize: 13,
            fontFamily: "inherit",
            cursor: "not-allowed",
          }}
        >
          Register model
        </button>
      </div>

      {/* Registry table */}
      <Panel style={{ overflow: "auto" }}>
        <div style={{ minWidth: 1080 }}>
          <div
            style={{
              ...GRID,
              padding: "9px 16px",
              borderBottom: "1px solid var(--color-border-subtle)",
              fontSize: 10.5,
              color: "var(--color-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {HEADERS.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>

          {filtered.map((ep) => {
            const model = modelById.get(ep.modelId);
            const status = STATUS_META[ep.status];
            const identityLine = [
              model?.family ?? ep.modelId,
              ep.providerId,
              deploymentLabel(ep),
              ...(ep.quantization ? [ep.quantization] : []),
            ].join(" · ");
            return (
              <div
                key={ep.id} /* endpoint id — model ids repeat across providers */
                className="hover-row"
                style={{
                  ...GRID,
                  alignItems: "center",
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--color-border-row)",
                  fontSize: 13,
                }}
              >
                {/* Identity */}
                <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <ModelDot color={model?.identityColor ?? "var(--color-model-neutral)"} size={9} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span
                      style={{
                        ...mono,
                        fontSize: 12.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ep.modelId}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-faint)" }}>
                      {identityLine}
                    </span>
                  </span>
                </span>

                {/* Status */}
                <span style={{ ...mono, fontSize: 11, color: status.color }}>{status.label}</span>

                {/* Ctx */}
                <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
                  {model ? ctxLabel(model.contextWindowTokens) : "—"}
                </span>

                {/* Price per Mtok */}
                <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
                  {priceLabel(ep)}
                </span>

                {/* Capabilities */}
                <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>
                  {(model?.capabilities ?? []).join(" · ")}
                </span>

                {/* Runs */}
                <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
                  {ep.runsCount}
                </span>

                {/* Reliability */}
                {ep.reliabilityPct == null ? (
                  <span
                    title="not yet measured"
                    style={{ ...mono, fontSize: 11.5, color: "var(--color-faint)" }}
                  >
                    —
                  </span>
                ) : (
                  <span
                    style={{
                      ...mono,
                      fontSize: 11.5,
                      color:
                        ep.reliabilityPct >= RELIABILITY_PASS_THRESHOLD
                          ? "var(--color-teal)"
                          : "var(--color-red)",
                    }}
                  >
                    {ep.reliabilityPct}%
                  </span>
                )}

                {/* Avg visual */}
                <span
                  style={{
                    ...mono,
                    fontSize: 11.5,
                    color: ep.avgVisualScore == null ? "var(--color-faint)" : "var(--color-muted)",
                  }}
                >
                  {ep.avgVisualScore == null ? "— n/a" : `${ep.avgVisualScore.toFixed(1)} avg`}
                </span>

                {/* Last tested */}
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                    {ep.lastTestedAt ? relativeDay(ep.lastTestedAt, anchorIso) : "never"}
                  </span>
                  <Link
                    href={`/runs/${resultsRunId}/results`}
                    className="hover-amber"
                    style={{ fontSize: 11, color: "var(--color-amber)" }}
                  >
                    results →
                  </Link>
                </span>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <EmptyState
              title="No endpoints match"
              hint={`"${query.trim()}" matched no model id, family, provider, or capability`}
            />
          )}
        </div>
      </Panel>

      {/* Duplicate-endpoint policy */}
      {duplicate && (
        <Callout variant="note" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span aria-hidden style={{ color: "var(--color-amber)" }}>
              ◆
            </span>
            <span>
              <strong style={{ color: "var(--color-text-secondary)" }}>
                {duplicate.modelId} appears{" "}
                {duplicate.list.length === 2 ? "twice" : `${duplicate.list.length} times`}
              </strong>{" "}
              — tracked via{" "}
              {duplicate.list
                .map(
                  (d) =>
                    `${d.providerId} (${[deploymentLabel(d), d.quantization, d.hardware]
                      .filter(Boolean)
                      .join(", ")})`,
                )
                .join(" vs ")}
              . Quality, latency and reliability are recorded per endpoint — the registry never
              merges them into one number.
            </span>
          </div>
        </Callout>
      )}
    </main>
  );
}
