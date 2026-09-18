import { ShareTemplate } from "@model-lab/schemas";
import { TopBar } from "@/components/shell/TopBar";
import { ShareStudio } from "@/components/share/ShareStudio";
import type { ShareCardRow } from "@/components/share/ShareCard";
import { capabilityForModel } from "@/lib/checks";
import { fixtures, modelColor, modelIdOf } from "@/lib/data";
import { getRunView } from "@/lib/server/loaders";
import { modelScoreSource, scoreAxisLabel } from "@/lib/score-presentation";
import { usd } from "@/lib/format";

/** Reads the persistence store — must render per request. */
export const dynamic = "force-dynamic";

/** Default editorial copy — user-editable card content, not run metrics. */
const DEMO_TITLE = "One prompt. Four models. One raycaster.";
const DEMO_TAKEAWAY = "The best-looking build was not the most correct one.";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  const rawTemplate = Array.isArray(sp["template"]) ? sp["template"][0] : sp["template"];
  const parsedTemplate = ShareTemplate.safeParse(rawTemplate);

  const view = await getRunView(runId);
  const run = view.run;
  const config = view.configuration;
  const models = view.runModels;

  const defaultTitle =
    view.source === "fixtures"
      ? DEMO_TITLE
      : `One prompt. ${run.modelCount} model${run.modelCount === 1 ? "" : "s"}. ${view.packName}.`;
  const defaultTakeaway =
    view.source === "fixtures"
      ? DEMO_TAKEAWAY
      : "Same brief, identical configuration — here is how they compare.";

  /* Error excerpt for a failing model: first failed check of its failed sample. */
  const failureNoteFor = (endpointId: string): string | null => {
    const failed = view.samples.find((s) => s.endpointId === endpointId && s.status === "failed");
    const check = failed?.scorerTrace.find((c) => c.status === "failed");
    return check?.note ?? null;
  };

  const rubric = view.judge?.briefScores ?? {};

  const rows: ShareCardRow[] = models.map((rm) => {
    // Same headline number the Results page shows: capability checks only,
    // zeroed by a failed gate (see lib/checks.ts).
    const cap = capabilityForModel(
      view.artifacts.filter((a) => a.endpointId === rm.endpointId).map((a) => a.checks),
      { passed: rm.testsPassed, total: rm.testsTotal ?? view.capabilityTotal },
    );
    const scoreValue = rm.visualScore?.value ?? rubric[rm.endpointId] ?? null;
    const scoreSource =
      rm.visualScore != null
        ? modelScoreSource(rm)
        : rubric[rm.endpointId] != null
          ? ("rubric" as const)
          : modelScoreSource(rm);
    const visualN = rm.visualScore?.n ?? null;
    const partialSamples = visualN != null && visualN < config.samplesPerModel;
    return {
      id: modelIdOf(rm.endpointId),
      mocked: view.mockedEndpointIds.includes(rm.endpointId),
      color: modelColor(rm.endpointId),
      visual: scoreValue != null ? `${scoreValue.toFixed(1)}${partialSamples ? "*" : ""}` : "—",
      pct: scoreValue != null ? Math.round(scoreValue * 10) : 0,
      tests: cap.passed != null ? `${cap.passed}/${cap.total}` : "—",
      testsState:
        cap.gateName != null || rm.failedSampleCount > 0
          ? "warn"
          : cap.passed != null && cap.passed === cap.total
            ? "ok"
            : "partial",
      cost: usd(rm.costUsd),
      visualValue: scoreValue,
      scoreSource,
      visualN,
      costUsd: rm.costUsd,
      latencyMs: rm.totalLatencyMs,
      sampleCount: view.samples.filter((s) => s.endpointId === rm.endpointId).length,
      failedSamples: rm.failedSampleCount,
      failureNote: rm.failedSampleCount > 0 ? failureNoteFor(rm.endpointId) : null,
    };
  });

  const scoreLabel = scoreAxisLabel(
    rows.filter((row) => row.visualValue != null).map((row) => row.scoreSource),
  );
  const footnote = rows.some((row) => row.visualN != null && row.visualN < config.samplesPerModel)
    ? "* measured n is below the configured sample count; missing scores are not zero"
    : "Missing scores are not zero; compare only like scoring sources";
  // "raycaster-oneshot v1.3 · n=3/model · first-shot · temp 0.7 · scorers: …"
  const human = config.scorers.find((s) => s.type === "human" && s.enabled);
  const judge = config.scorers.find((s) => s.type === "llm-judge" && s.enabled);
  const scorerParts: string[] = [];
  if (config.scorers.some((s) => s.type === "browser" && s.enabled)) {
    // Two numbers, because they mean different things: the card's ratio is the
    // capability score, while the run actually executed the full check list
    // (gates + diagnostics are reported, not scored).
    scorerParts.push(`browser(${view.capabilityTotal} of ${view.checksTotal} scored)`);
  }
  if (config.scorers.some((s) => s.type === "objective" && s.enabled))
    scorerParts.push("objective");
  if (human) scorerParts.push(`human rubric ${human.rubricVersion ?? ""}`.trimEnd());
  if (judge) scorerParts.push(`judge${judge.orderSwapped ? " (order-swapped)" : ""}`);
  const methodology = [
    ...(view.source === "fixtures" ? ["ILLUSTRATIVE DEMO"] : []),
    ...(view.mockedEndpointIds.length > 0
      ? [
          `SYNTHETIC MOCK OUTPUTS (${view.mockedEndpointIds.length}/${models.length} endpoints; simulated costs)`,
        ]
      : []),
    `${run.pack.slug} ${run.pack.version}`,
    `planned n=${config.samplesPerModel}/model`,
    config.retryPolicy.generation === "none" ? "first-shot" : "retries allowed",
    `temp ${config.temperature}`,
    `scorers: ${scorerParts.join(" + ")}`,
  ].join(" · ");

  return (
    <>
      <TopBar title={`Share Studio — ${runId}`} />
      <main style={{ flex: 1, display: "flex", flexWrap: "wrap", minHeight: 0 }}>
        <ShareStudio
          runId={runId}
          manifest={view.manifest}
          rows={rows}
          defaultTitle={defaultTitle}
          defaultTakeaway={defaultTakeaway}
          date={view.manifest.date}
          methodology={methodology}
          footnote={footnote}
          runLink={`${run.id} · ${fixtures.workspaceSettings.repoUrl}`}
          scoreLabel={scoreLabel}
          initialTemplate={parsedTemplate.success ? parsedTemplate.data : undefined}
        />
      </main>
    </>
  );
}
