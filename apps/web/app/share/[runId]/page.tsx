import { TopBar } from "@/components/shell/TopBar";
import { ShareStudio } from "@/components/share/ShareStudio";
import type { ShareCardRow } from "@/components/share/ShareCard";
import { fixtures, modelColor, modelIdOf } from "@/lib/data";
import { usd } from "@/lib/format";

/** Default editorial copy — user-editable card content, not run metrics. */
const DEFAULT_TITLE = "One prompt. Four models. One raycaster.";
const DEFAULT_TAKEAWAY = "The best-looking build was not the most correct one.";

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = fixtures.runCompleted;
  const config = fixtures.runConfiguration;
  const models = fixtures.getRunModels("completed");

  const rows: ShareCardRow[] = models.map((rm) => {
    // Asterisk when the visual mean covers fewer samples than configured.
    const partialSamples = rm.visualScore != null && rm.visualScore.n < config.samplesPerModel;
    return {
      id: modelIdOf(rm.endpointId),
      color: modelColor(rm.endpointId),
      visual:
        rm.visualScore != null
          ? `${rm.visualScore.value.toFixed(1)}${partialSamples ? "*" : ""}`
          : "—",
      pct: rm.visualScore != null ? Math.round(rm.visualScore.value * 10) : 0,
      tests:
        rm.testsPassed != null && rm.testsTotal != null
          ? `${rm.testsPassed}/${rm.testsTotal}`
          : "—",
      testsState:
        rm.testsPassed != null && rm.testsPassed === rm.testsTotal
          ? "ok"
          : rm.failedSampleCount > 0
            ? "warn"
            : "partial",
      cost: usd(rm.costUsd),
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
    scorerParts.push(`browser(${fixtures.CHECK_NAMES.length})`);
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
          rows={rows}
          defaultTitle={DEFAULT_TITLE}
          defaultTakeaway={DEFAULT_TAKEAWAY}
          date={fixtures.runManifest.date}
          methodology={methodology}
          footnote={footnote}
          runLink={`${run.id} · ${fixtures.workspaceSettings.repoUrl}`}
        />
      </main>
    </>
  );
}
