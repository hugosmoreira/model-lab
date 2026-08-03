import { ShareTemplate } from "@model-lab/schemas";
import { TopBar } from "@/components/shell/TopBar";
import { ShareStudio } from "@/components/share/ShareStudio";
import type { ShareCardRow } from "@/components/share/ShareCard";
import { capabilityForModel } from "@/lib/checks";
import { fixtures, modelColor, modelIdOf } from "@/lib/data";
import { DEMO_RUN_ID, getRunView } from "@/lib/server/loaders";
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
    runId === DEMO_RUN_ID
      ? DEMO_TITLE
      : `One prompt. ${run.modelCount} model${run.modelCount === 1 ? "" : "s"}. ${view.packName}.`;
  const defaultTakeaway =
    runId === DEMO_RUN_ID
      ? DEMO_TAKEAWAY
      : "Same brief, identical configuration — here is how they compare.";

  /* Error excerpt for a failing model: first failed check of its failed sample. */
  const failureNoteFor = (endpointId: string): string | null => {
    const failed = view.samples.find(
      (s) => s.endpointId === endpointId && s.status === "failed",
    );
    const check = failed?.scorerTrace.find((c) => c.status === "failed");
    return check?.note ?? null;
  };

  const rows: ShareCardRow[] = models.map((rm) => {
    // Asterisk when the visual mean covers fewer samples than configured.
    const partialSamples = rm.visualScore != null && rm.visualScore.n < config.samplesPerModel;
    // Same headline number the Results page shows: capability checks only,
    // zeroed by a failed gate (see lib/checks.ts).
    const cap = capabilityForModel(
      view.artifacts.filter((a) => a.endpointId === rm.endpointId).map((a) => a.checks),
      { passed: rm.testsPassed, total: rm.testsTotal ?? view.capabilityTotal },
    );
    return {
      id: modelIdOf(rm.endpointId),
      color: modelColor(rm.endpointId),
      visual:
        rm.visualScore != null
          ? `${rm.visualScore.value.toFixed(1)}${partialSamples ? "*" : ""}`
          : "—",
      pct: rm.visualScore != null ? Math.round(rm.visualScore.value * 10) : 0,
      tests: cap.passed != null ? `${cap.passed}/${cap.total}` : "—",
      testsState:
        cap.gateName != null || rm.failedSampleCount > 0
          ? "warn"
          : cap.passed != null && cap.passed === cap.total
            ? "ok"
            : "partial",
      cost: usd(rm.costUsd),
      visualValue: rm.visualScore?.value ?? null,
      visualN: rm.visualScore?.n ?? null,
      costUsd: rm.costUsd,
      latencyMs: rm.totalLatencyMs,
      sampleCount: config.samplesPerModel,
      failedSamples: rm.failedSampleCount,
      failureNote: rm.failedSampleCount > 0 ? failureNoteFor(rm.endpointId) : null,
    };
  });

  // Footnote for the asterisked score, e.g. "* mean of n=2 — one sample failed".
  const flagged = models.find(
    (rm) => rm.visualScore != null && rm.visualScore.n < config.samplesPerModel,
  );
  const footnote =
    flagged?.visualScore != null
      ? `* mean of n=${flagged.visualScore.n} — ${
          flagged.failedSampleCount === 1
            ? "one sample failed"
            : `${flagged.failedSampleCount} samples failed`
        }`
      : null;

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
  if (human) scorerParts.push(`human rubric ${human.rubricVersion ?? ""}`.trimEnd());
  if (judge) scorerParts.push(`judge${judge.orderSwapped ? " (order-swapped)" : ""}`);
  const methodology = [
    `${run.pack.slug} ${run.pack.version}`,
    `n=${config.samplesPerModel}/model`,
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
          initialTemplate={parsedTemplate.success ? parsedTemplate.data : undefined}
        />
      </main>
    </>
  );
}
