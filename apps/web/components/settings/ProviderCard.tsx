import type { Provider } from "@model-lab/schemas";
import { StatusDot } from "@/components/ui/primitives";

const mono = { fontFamily: "var(--font-mono)" } as const;

/**
 * Demo clock anchor for relative "last test" labels. The provider fixtures'
 * lastTestedAt values (14:30 / 14:28 / 14:14 / 14:31 UTC) are authored against
 * this moment so the cards read "2 min ago", "4 min ago", "18 min ago",
 * "1 min ago" exactly as in the prototype. Phase 2 swaps this for Date.now().
 */
const FIXTURE_NOW_ISO = "2026-07-31T14:32:00Z";

function minutesAgo(iso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.parse(FIXTURE_NOW_ISO) - Date.parse(iso)) / 60_000),
  );
  return mins === 0 ? "just now" : `${mins} min ago`;
}

/** Status → circle-dot color + status-text color (never model colors). */
const STATUS_META: Record<
  Provider["status"],
  { dot: string; text: string }
> = {
  connected: { dot: "var(--color-teal)", text: "var(--color-teal)" },
  "rate-limited": { dot: "var(--color-amber)", text: "var(--color-amber)" },
  disconnected: { dot: "var(--color-disabled)", text: "var(--color-faint)" },
};

function modelsLabel(p: Provider): string {
  if (p.modelsLoaded != null) return `${p.modelsLoaded} loaded`;
  if (p.modelsAvailable != null) return `${p.modelsAvailable} available`;
  return "—";
}

function lastTestLabel(p: Provider): string {
  if (!p.lastTestedAt) return "never";
  const rel = minutesAgo(p.lastTestedAt);
  if (p.isLocal && p.localEndpoint) return `${rel} · ${p.localEndpoint}`;
  if (p.healthLatencyMs != null) return `${rel} · ${p.healthLatencyMs}ms`;
  return rel;
}

function credentialLabel(p: Provider): string {
  return p.credentialStore === "keychain"
    ? `${p.credentialMasked} (keychain)`
    : p.credentialMasked;
}

const DISABLED_TITLE = "wired in Phase 2";

export function ProviderCard({ provider: p }: { provider: Provider }) {
  const meta = STATUS_META[p.status];
  const statusText =
    p.status === "connected" && p.isLocal ? "connected · local" : p.status;
  const contextAction = p.status === "disconnected" ? "Connect" : "Disable";

  return (
    <section
      className="panel"
      style={{
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 130,
      }}
    >
      {/* Header: status circle · name · status text */}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <StatusDot color={meta.dot} size={8} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
        <span
          style={{ ...mono, fontSize: 11, color: meta.text, marginLeft: "auto" }}
        >
          {statusText}
        </span>
      </div>

      {/* Metadata grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "3px 12px",
          ...mono,
          fontSize: 11.5,
          color: "var(--color-faint)",
        }}
      >
        <span>models</span>
        <span style={{ color: "var(--color-muted)" }}>{modelsLabel(p)}</span>
        <span>last test</span>
        <span style={{ color: "var(--color-muted)" }}>{lastTestLabel(p)}</span>
        <span>credential</span>
        <span style={{ color: "var(--color-muted)" }}>{credentialLabel(p)}</span>
      </div>

      {/* Rate-limit / degradation warning */}
      {p.warning && (
        <span
          style={{
            fontSize: 11.5,
            color: "var(--color-warning-text)",
            background: "var(--color-warning-bg)",
            border: "1px solid var(--color-warning-border)",
            borderRadius: 5,
            padding: "5px 9px",
          }}
        >
          <span aria-hidden>⚠ </span>
          {p.warning.message}
        </span>
      )}

      {/* Actions — pinned to card bottom */}
      <div style={{ display: "flex", gap: 7, marginTop: "auto", fontSize: 12 }}>
        <button
          type="button"
          disabled
          title={DISABLED_TITLE}
          className="hover-border"
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
            borderRadius: 5,
            padding: "5px 11px",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "not-allowed",
          }}
        >
          Test connection
        </button>
        <button
          type="button"
          disabled
          title={DISABLED_TITLE}
          className="hover-border hover-text"
          style={{
            background: "none",
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            borderRadius: 5,
            padding: "5px 11px",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "not-allowed",
          }}
        >
          Configure
        </button>
        <button
          type="button"
          disabled
          title={DISABLED_TITLE}
          className={contextAction === "Disable" ? "provider-danger-hover" : "hover-text"}
          style={{
            background: "none",
            border: "none",
            color: "var(--color-faint)",
            padding: "5px 6px",
            fontSize: 12,
            fontFamily: "inherit",
            marginLeft: "auto",
            cursor: "not-allowed",
          }}
        >
          {contextAction}
        </button>
      </div>
    </section>
  );
}
