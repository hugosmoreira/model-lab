import { resolveBackend } from "@model-lab/store";
import { isReadOnly } from "@/lib/server/read-only";

const mono = { fontFamily: "var(--font-mono)" } as const;

interface SettingRow {
  name: string;
  sub: string;
  value: string;
}

/** Only implemented settings; secrets and local filesystem paths are not exposed. */
function settingRows(): SettingRow[] {
  return [
    { name: "Persistence", sub: "selected server store", value: resolveBackend() },
    {
      name: "Write access",
      sub: "new runs, votes and annotations",
      value: isReadOnly() ? "Read-only" : "Enabled",
    },
    {
      name: "Budget and concurrency",
      sub: "configured for each benchmark",
      value: "Set in New Run",
    },
    { name: "Data retention", sub: "no automatic deletion policy", value: "Operator managed" },
    {
      name: "Artifacts",
      sub: "generated source is not executed by the viewer",
      value: "Captured previews",
    },
    { name: "Scoring", sub: "source and measured n accompany each score", value: "Per run" },
    {
      name: "Reduced motion",
      sub: "uses your device accessibility preference",
      value: "Respected",
    },
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
              overflowWrap: "anywhere",
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
