import Link from "next/link";
import { TopBar } from "@/components/shell/TopBar";
import {
  Callout,
  EmptyState,
  ModeBadge,
  Panel,
  PanelHeader,
  RUN_STATUS_COLORS,
} from "@/components/ui/primitives";
import { listAllRuns } from "@/lib/server/loaders";
import { usd } from "@/lib/format";
import { isReadOnly } from "@/lib/server/read-only";

export const dynamic = "force-dynamic";
const mono = { fontFamily: "var(--font-mono)" } as const;

export default async function MissionControl() {
  const runs = await listAllRuns();
  const recorded = runs.filter((run) => run.source === "store");
  const active = recorded.filter((run) => run.status === "running" || run.status === "queued");
  const readOnly = isReadOnly();
  const stats = [
    {
      label: "Recorded runs",
      value: String(recorded.length),
      caption: "Excludes illustrative demo data",
    },
    {
      label: "Active runs",
      value: String(active.length),
      caption: "Recorded as queued or running",
    },
    {
      label: "Recorded cost",
      value: usd(recorded.reduce((sum, run) => sum + run.costUsd, 0)),
      caption: "Includes estimates and simulated mock costs; not provider billing",
    },
  ];
  return (
    <>
      <TopBar title="Mission Control" />
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
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Workspace overview</h1>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
            gap: 12,
          }}
        >
          {stats.map((stat) => (
            <Panel
              key={stat.label}
              style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}
            >
              <span style={{ color: "var(--color-muted)" }}>{stat.label}</span>
              <strong style={{ ...mono, fontSize: 25 }}>{stat.value}</strong>
              <span style={{ color: "var(--color-faint)", fontSize: 12 }}>{stat.caption}</span>
            </Panel>
          ))}
        </div>
        {runs.some((run) => run.source === "fixtures") && (
          <Callout variant="insight">
            The seeded demo is an illustrative example. Its scores, costs and findings are excluded
            from workspace totals and are labelled on the run.
          </Callout>
        )}
        {active.length > 0 && (
          <Panel>
            <PanelHeader title="Active runs" caption="Open a run to inspect its event stream" />
            {active.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}/live`}
                className="hover-row"
                style={{ display: "block", padding: "12px 16px" }}
              >
                {run.name} · {run.status} →
              </Link>
            ))}
          </Panel>
        )}
        <Panel>
          <PanelHeader
            title="Recent runs"
            caption="Recorded in the selected store"
            action={
              <Link href="/runs" style={{ color: "var(--color-amber)" }}>
                View all →
              </Link>
            }
          />
          {runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              hint={
                readOnly
                  ? "This read-only instance has no published runs."
                  : "Configure a provider, then create your first benchmark run."
              }
            />
          ) : (
            runs.slice(0, 8).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}/${run.status === "running" || run.status === "queued" ? "live" : "results"}`}
                className="hover-row"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border-row)",
                }}
              >
                <span style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <strong>{run.name}</strong>
                  <span
                    style={{ ...mono, display: "block", color: "var(--color-faint)", fontSize: 11 }}
                  >
                    {run.source === "fixtures" ? "ILLUSTRATIVE DEMO · " : ""}
                    {run.id} · {run.modelCount} models · planned n={run.samplesPerModel}
                  </span>
                </span>
                <ModeBadge mode={run.mode} />
                <span style={{ ...mono, color: RUN_STATUS_COLORS[run.status] }}>{run.status}</span>
                <span style={mono}>{usd(run.costUsd)}</span>
                <span style={{ ...mono, color: "var(--color-faint)" }}>{run.when}</span>
              </Link>
            ))
          )}
        </Panel>
        <Panel style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 18 }}>
          <Link href="/settings/providers" style={{ color: "var(--color-amber)" }}>
            Check provider connections →
          </Link>
          <Link href="/benchmarks">Browse benchmark packs →</Link>
          {!readOnly && <Link href="/runs/new">Create a run →</Link>}
          <span style={{ color: "var(--color-muted)" }}>
            Open a run to inspect samples, compare artifacts or export results.
          </span>
        </Panel>
      </main>
    </>
  );
}
