import Link from "next/link";
import { TopBar } from "@/components/shell/TopBar";
import {
  Callout,
  ModeBadge,
  ModelDot,
  Panel,
  PanelHeader,
  ProgressBar,
  RUN_STATUS_COLORS,
  StatusDot,
} from "@/components/ui/primitives";
import { CostQualityScatter } from "@/components/charts/CostQualityScatter";
import {
  endpointProviderLabel,
  fixtures,
  modelColor,
  modelIdOf,
  shortNameOf,
} from "@/lib/data";
import { hhmm, usd } from "@/lib/format";

const mono = { fontFamily: "var(--font-mono)" } as const;

const RUN_MODEL_STATUS: Record<string, { label: string; color: string; pulse?: boolean }> = {
  scoring: { label: "scoring", color: "var(--color-amber)", pulse: true },
  testing: { label: "testing", color: "var(--color-amber)", pulse: true },
  generating: { label: "generating", color: "var(--color-amber)", pulse: true },
  completed: { label: "completed", color: "var(--color-teal)" },
  queued: { label: "queued", color: "var(--color-faint)" },
  failed: { label: "failed", color: "var(--color-red)" },
};

function KpiCard({
  label,
  value,
  unit,
  caption,
  dotColor,
}: {
  label: string;
  value: string;
  unit?: string;
  caption: string;
  dotColor?: string;
}) {
  return (
    <Panel style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-muted)",
        }}
      >
        {label}
      </span>
      <span style={{ ...mono, fontSize: 25, fontWeight: 600, lineHeight: 1.1 }}>
        {value}
        {unit && <span style={{ fontSize: 13, color: "var(--color-faint)", fontWeight: 400 }}> {unit}</span>}
      </span>
      <span style={{ fontSize: 12, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: 6 }}>
        {dotColor && <ModelDot color={dotColor} size={8} />}
        {caption}
      </span>
    </Panel>
  );
}

export default function MissionControl() {
  const {
    workspaceStats: stats,
    recentRuns,
    notableFinding,
    recentExports,
    activityFeed,
    runLive,
    providers,
    artifacts,
  } = fixtures;
  const runModels = fixtures.getRunModels("live");
  const completedModels = fixtures.getRunModels("completed");

  const scatterPoints = completedModels.map((rm) => ({
    label:
      rm.endpointId === "ollama/qwen3-coder-32b@q4_K_M"
        ? `${shortNameOf(rm.endpointId)} (1 fail)`
        : `${shortNameOf(rm.endpointId)} ${rm.visualScore?.value ?? ""}`,
    color: modelColor(rm.endpointId),
    costUsd: rm.costUsd,
    score: rm.visualScore?.value ?? 0,
    failed: rm.failedSampleCount > 0,
  }));

  const healthProviders = providers.filter((p) =>
    ["anthropic", "openai", "google", "openrouter", "ollama"].includes(p.id),
  );

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
        {/* KPI row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
            gap: 12,
          }}
        >
          <KpiCard
            label="Quality leader · 7d"
            value={stats.qualityLeader7d.score.toFixed(1)}
            unit={`/${stats.qualityLeader7d.max}`}
            caption={`${modelIdOf(stats.qualityLeader7d.endpointId)} · ${stats.qualityLeader7d.dimension} · n=${stats.qualityLeader7d.n}`}
            dotColor={modelColor(stats.qualityLeader7d.endpointId)}
          />
          <KpiCard
            label="Cheapest passing run"
            value={usd(stats.cheapestPassingRun.costUsd)}
            caption={`${modelIdOf(stats.cheapestPassingRun.endpointId)} · ${stats.cheapestPassingRun.tests} tests`}
            dotColor={modelColor(stats.cheapestPassingRun.endpointId)}
          />
          <KpiCard
            label="Reliability · 7d"
            value={`${stats.reliability7d.pct}%`}
            caption={stats.reliability7d.detail}
          />
          <KpiCard
            label="Spend this week"
            value={usd(stats.spendThisWeek.usd)}
            caption={`${stats.spendThisWeek.runs} runs · budget ${usd(stats.spendThisWeek.budgetUsd)}`}
          />
        </div>

        {/* Two-column body */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          {/* Left column */}
          <div style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Active run */}
            <Panel>
              <PanelHeader
                title={
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusDot color="var(--color-teal)" glow pulse />
                    {runLive.name}
                  </span>
                }
                caption={`${runLive.id} · ${runLive.mode}`}
                action={
                  <Link href={`/runs/${runLive.id}/live`} className="hover-amber" style={{ color: "var(--color-amber)", fontSize: 12.5, fontWeight: 600 }}>
                    Open Live Run →
                  </Link>
                }
              />
              <div style={{ padding: "6px 0" }}>
                {runModels.map((rm) => {
                  const status =
                    rm.failedSampleCount > 0 && rm.status !== "completed"
                      ? { label: `${rm.failedSampleCount} sample failed`, color: "var(--color-red)" }
                      : RUN_MODEL_STATUS[rm.status] ?? { label: rm.status, color: "var(--color-muted)" };
                  const barColor =
                    rm.failedSampleCount > 0 && rm.status !== "completed"
                      ? "var(--color-red)"
                      : rm.status === "completed"
                        ? "var(--color-teal)"
                        : "var(--color-amber)";
                  return (
                    <div
                      key={rm.endpointId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(140px,200px) minmax(120px,1fr) 90px 70px",
                        gap: 12,
                        alignItems: "center",
                        padding: "9px 16px",
                        borderBottom: "1px solid var(--color-border-row)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <ModelDot color={modelColor(rm.endpointId)} size={8} />
                        <span
                          style={{
                            ...mono,
                            fontSize: 12,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {modelIdOf(rm.endpointId)}
                          {rm.endpointId.startsWith("ollama/") ? " (local)" : ""}
                        </span>
                      </span>
                      <ProgressBar pct={rm.progressPct} color={barColor} />
                      <span
                        className={RUN_MODEL_STATUS[rm.status]?.pulse ? "ml-pulse" : undefined}
                        style={{ ...mono, fontSize: 11, color: status.color }}
                      >
                        {status.label}
                      </span>
                      <span style={{ ...mono, fontSize: 12, color: "var(--color-muted)", textAlign: "right" }}>
                        {usd(rm.costUsd)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Chart + Notable finding */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
              <Panel style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Cost vs quality</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>last run · n=3</span>
                </div>
                <CostQualityScatter points={scatterPoints} />
              </Panel>

              <Callout variant="insight" style={{ padding: "14px 18px", flexDirection: "column", display: "flex" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                    <span style={{ color: "var(--color-magenta)" }}>◆</span> Notable finding
                  </span>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{notableFinding.body}</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-muted)" }}>
                    {notableFinding.note}{" "}
                    <Link href={notableFinding.reviewHref} style={{ color: "var(--color-magenta)" }}>
                      review in Head-to-Head
                    </Link>
                  </p>
                  <span style={{ display: "flex", gap: 14, marginTop: 2 }}>
                    <Link href={notableFinding.investigateHref} className="hover-amber" style={{ color: "var(--color-amber)", fontSize: 12, fontWeight: 600 }}>
                      Investigate →
                    </Link>
                    <Link href={notableFinding.shareHref} className="hover-text" style={{ color: "var(--color-muted)", fontSize: 12 }}>
                      Create share card
                    </Link>
                  </span>
                </div>
              </Callout>
            </div>

            {/* Recent runs */}
            <Panel>
              <PanelHeader
                title="Recent runs"
                action={
                  <Link href="/runs" className="hover-text" style={{ color: "var(--color-muted)", fontSize: 12.5 }}>
                    View all →
                  </Link>
                }
              />
              <div>
                {recentRuns.map((r) => (
                  <Link
                    key={r.id}
                    href={r.status === "running" ? `/runs/${r.id}/live` : `/runs/${r.id}/results`}
                    className="hover-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1.6fr) 92px 76px 64px 70px",
                      gap: 10,
                      alignItems: "center",
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
                    <span style={{ ...mono, fontSize: 11, color: RUN_STATUS_COLORS[r.status] }}>{r.status}</span>
                    <span style={{ ...mono, fontSize: 12, color: "var(--color-muted)", textAlign: "right" }}>
                      {usd(r.costUsd)}
                    </span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)", textAlign: "right" }}>
                      {r.when}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          </div>

          {/* Right column */}
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Latest artifacts */}
            <Panel>
              <PanelHeader
                title="Latest artifacts"
                action={
                  <Link href="/arena" className="hover-amber" style={{ color: "var(--color-amber)", fontSize: 12.5 }}>
                    Arena →
                  </Link>
                }
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "12px 16px" }}>
                {artifacts.map((a) => (
                  <Link
                    key={a.endpointId}
                    href={`/runs/${a.runId}/artifacts/${a.endpointId.replace(/\//g, "~")}`}
                    style={{
                      position: "relative",
                      height: 88,
                      borderRadius: 6,
                      overflow: "hidden",
                      border: a.renderOk ? "1px solid var(--color-border)" : "1px solid #3c2530",
                      background: a.renderOk
                        ? `linear-gradient(${modelColor(a.endpointId)}22 0 52%, var(--color-stage) 52% 100%)`
                        : "var(--color-void)",
                      display: "block",
                    }}
                  >
                    {!a.renderOk && (
                      <span
                        style={{
                          position: "absolute",
                          left: 8,
                          top: 8,
                          right: 8,
                          ...mono,
                          fontSize: 9.5,
                          color: "var(--color-red)",
                          lineHeight: 1.5,
                        }}
                      >
                        Uncaught TypeError: ctx is null
                      </span>
                    )}
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "var(--color-void)",
                        padding: "3px 7px",
                        ...mono,
                        fontSize: 10,
                        color: a.renderOk ? modelColor(a.endpointId) : "var(--color-model-qwen)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {shortNameOf(a.endpointId)} ·{" "}
                      {a.renderOk
                        ? fixtures
                            .getRunModels("completed")
                            .find((rm) => rm.endpointId === a.endpointId)
                            ?.visualScore?.value.toFixed(1)
                        : "render fail"}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>

            {/* Provider health */}
            <Panel>
              <PanelHeader title="Provider health" />
              <div style={{ padding: "4px 0" }}>
                {healthProviders.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 16px",
                      borderBottom: "1px solid var(--color-border-row)",
                    }}
                  >
                    <StatusDot
                      color={p.status === "connected" ? "var(--color-teal)" : "var(--color-amber)"}
                    />
                    <span style={{ fontSize: 13, flex: 1 }}>
                      {p.name}
                      {p.localHardware ? ` · ${p.localHardware}` : ""}
                    </span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                      {p.status === "rate-limited"
                        ? "rate-limited"
                        : p.isLocal
                          ? "qwen3-32b loaded"
                          : p.healthLatencyMs != null
                            ? `${p.healthLatencyMs}ms`
                            : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 16px" }}>
                <Link href="/settings/providers" className="hover-text" style={{ color: "var(--color-muted)", fontSize: 12.5 }}>
                  Manage providers →
                </Link>
              </div>
            </Panel>

            {/* Recent exports */}
            <Panel>
              <PanelHeader title="Recent exports" />
              <div style={{ padding: "4px 0" }}>
                {recentExports.map((e) => (
                  <Link
                    key={e.filename}
                    href={`/share/${e.runId}`}
                    className="hover-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 16px",
                      borderBottom: "1px solid var(--color-border-row)",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: e.aspect === "16:9" ? 28 : 18,
                        height: 18,
                        borderRadius: 3,
                        border: "1px solid var(--color-border)",
                        background: "linear-gradient(135deg,#e8a33d33,#d16ba033)",
                        flex: "0 0 auto",
                      }}
                    />
                    <span style={{ fontSize: 13, flex: 1, color: "var(--color-text)" }}>{e.filename}</span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>{e.aspect}</span>
                  </Link>
                ))}
              </div>
            </Panel>

            {/* Activity */}
            <Panel>
              <PanelHeader title="Activity" />
              <div style={{ padding: "4px 0" }}>
                {activityFeed.map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "8px 16px",
                      borderBottom: "1px solid var(--color-border-row)",
                    }}
                  >
                    <span style={{ flex: "0 0 44px", ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                      {hhmm(ev.t)}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)", minWidth: 0 }}>
                      <span style={{ ...mono, fontSize: 11.5 }}>{ev.type}</span> — {ev.message}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </main>
    </>
  );
}
