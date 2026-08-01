import Link from "next/link";
import { TopBar } from "@/components/shell/TopBar";
import {
  EmptyState,
  ModeBadge,
  Panel,
  PanelHeader,
  RUN_STATUS_COLORS,
} from "@/components/ui/primitives";
import { listAllRuns } from "@/lib/server/loaders";
import { usd } from "@/lib/format";

/** Reads the persistence store + in-process registry — render per request. */
export const dynamic = "force-dynamic";

const mono = { fontFamily: "var(--font-mono)" } as const;

/** Shared grid template for header + rows (audit: Mission Control recent-runs list). */
const ROW_GRID = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) 92px 76px 64px 70px",
  gap: 10,
  alignItems: "center",
} as const;

const COLUMN_LABEL = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-faint)",
} as const;

export default async function RunsIndex() {
  const recentRuns = await listAllRuns();

  return (
    <>
      <TopBar title="Runs" />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: 1400,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <Panel>
          <PanelHeader
            title="All runs"
            caption={`${recentRuns.length} runs · store + demo data`}
            action={
              <Link
                href="/runs/new"
                className="hover-amber"
                style={{ color: "var(--color-amber)", fontSize: 12.5, fontWeight: 600 }}
              >
                New Run →
              </Link>
            }
          />

          {recentRuns.length === 0 ? (
            <EmptyState
              title="No runs yet"
              hint="Start a benchmark from New Run — results will land here."
            />
          ) : (
            <div>
              {/* Column labels */}
              <div
                aria-hidden
                style={{
                  ...ROW_GRID,
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                <span style={COLUMN_LABEL}>Run</span>
                <span style={COLUMN_LABEL}>Mode</span>
                <span style={COLUMN_LABEL}>Status</span>
                <span style={{ ...COLUMN_LABEL, textAlign: "right" }}>Cost</span>
                <span style={{ ...COLUMN_LABEL, textAlign: "right" }}>When</span>
              </div>

              {recentRuns.map((r) => (
                <Link
                  key={r.id}
                  href={
                    r.status === "running" || r.status === "queued"
                      ? `/runs/${r.id}/live`
                      : `/runs/${r.id}/results`
                  }
                  className="hover-row"
                  style={{
                    ...ROW_GRID,
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--color-border-row)",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--color-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.name}
                    </span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                      {r.id} · {r.modelCount} models · n={r.samplesPerModel}
                    </span>
                  </span>
                  <ModeBadge mode={r.mode} />
                  <span
                    style={{
                      ...mono,
                      fontSize: 11,
                      color: RUN_STATUS_COLORS[r.status] ?? "var(--color-muted)",
                    }}
                  >
                    {r.status}
                  </span>
                  <span style={{ ...mono, fontSize: 12, color: "var(--color-muted)", textAlign: "right" }}>
                    {usd(r.costUsd)}
                  </span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)", textAlign: "right" }}>
                    {r.when}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
