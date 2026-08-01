import Link from "next/link";
import { TopBar } from "@/components/shell/TopBar";
import { SectionLabel } from "@/components/ui/primitives";
import { SettingsGrid } from "@/components/settings/SettingsGrid";

export default function SettingsPage() {
  return (
    <>
      <TopBar title="Settings" />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 1300,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <SectionLabel>Workspace settings</SectionLabel>
          <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>
            read-only this phase — editing arrives in Phase 3+
          </span>
          <Link
            href="/settings/providers"
            className="hover-border"
            style={{
              marginLeft: "auto",
              background: "var(--color-raised)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
              borderRadius: 5,
              padding: "5px 11px",
              fontSize: 12,
            }}
          >
            Provider connections →
          </Link>
        </div>
        <SettingsGrid />
      </main>
    </>
  );
}
