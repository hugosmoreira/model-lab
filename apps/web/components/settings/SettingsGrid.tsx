import { fixtures } from "@/lib/data";
import { usd } from "@/lib/format";

const mono = { fontFamily: "var(--font-mono)" } as const;

interface SettingRow {
  name: string;
  sub: string;
  value: string;
}

/** The ten workspace settings, derived from fixtures.workspaceSettings. */
function settingRows(): SettingRow[] {
  const s = fixtures.workspaceSettings;
  return [
    { name: "Default run budget", sub: "hard ceiling per run", value: usd(s.defaultRunBudgetUsd) },
    {
      name: "Default concurrency",
      sub: "parallel requests per run",
      value: String(s.defaultConcurrency),
    },
    { name: "Data retention", sub: "raw responses + artifacts", value: s.dataRetention },
    { name: "Artifact directory", sub: "local-first storage", value: s.artifactDirectory },
    {
      name: "Local hardware profile",
      sub: "recorded with local runs",
      value: s.localHardwareProfile ?? "—",
    },
    { name: "Telemetry", sub: "fully local by default", value: s.telemetry },
    { name: "Artifact network policy", sub: "sandbox default", value: s.artifactNetworkPolicy },
    {
      name: "Default scoring policy",
      sub: "objective before judges",
      value: s.defaultScoringPolicy,
    },
    { name: "Export branding", sub: "footer on share cards", value: s.exportBranding },
    { name: "Theme & accessibility", sub: "reduced motion respected", value: s.themeAccessibility },
  ];
}

/** Read-only workspace-settings grid (pills become editors in Phase 3+). */
export function SettingsGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
        gap: 10,
      }}
    >
      {settingRows().map((row) => (
        <div
          key={row.name}
          className="panel"
          style={{
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{row.name}</span>
            <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>{row.sub}</span>
          </span>
          <span
            style={{
              ...mono,
              fontSize: 12,
              color: "var(--color-text-secondary)",
              background: "var(--color-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: 5,
              padding: "4px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
