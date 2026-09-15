import { TopBar } from "@/components/shell/TopBar";
import { Callout, SectionLabel } from "@/components/ui/primitives";
import { ProviderCard } from "@/components/settings/ProviderCard";
import { SettingsGrid } from "@/components/settings/SettingsGrid";
import { fixtures } from "@/lib/data";

export default function ProvidersPage() {
  const { providers } = fixtures;

  return (
    <>
      <TopBar title="Providers & Settings" />
      {/* Screen-scoped hover: destructive recolor on the "Disable" context
          action (globals.css has no red-hover helper; shared files untouched). */}
      <style>{`.provider-danger-hover:hover { color: var(--color-red) !important; }`}</style>
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          maxWidth: 1300,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <Callout variant="note" glyph="🔒">
          Provider keys live in the OS keychain or a server-side encrypted store. Only masked
          previews ever reach the browser — never the key, never in logs.
        </Callout>

        {/* Provider cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))",
            gap: 12,
          }}
        >
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>

        {/* Workspace settings (deep-linkable) */}
        <section id="settings" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Workspace settings</SectionLabel>
          <SettingsGrid />
        </section>
      </main>
    </>
  );
}
