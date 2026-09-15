/**
 * Pure export builders for the Share Studio (Phase 4). Client-safe: no DOM,
 * no node imports — every function maps card data → string, so the exports
 * are exactly as faithful as the rendered card.
 */
import type { RunManifest } from "@model-lab/schemas";
import type { ShareCardContent, ShareCardRow } from "@/components/share/ShareCard";

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV columns fixed by the spec: model,visual,tests,cost,latency. */
export function buildCsv(rows: ShareCardRow[]): string {
  const header = "model,visual,tests,cost,latency";
  const lines = rows.map((r) =>
    [
      r.id,
      r.visualValue !== null ? r.visualValue.toFixed(1) : "",
      r.tests,
      r.costUsd.toFixed(2),
      r.latencyMs !== null ? (r.latencyMs / 1000).toFixed(1) : "",
    ]
      .map(csvField)
      .join(","),
  );
  return `${[header, ...lines].join("\n")}\n`;
}

/** JSON export: { manifest, rows, content } — provenance travels with data. */
export function buildJson(
  manifest: RunManifest,
  rows: ShareCardRow[],
  content: ShareCardContent,
): string {
  return `${JSON.stringify({ manifest, rows, content }, null, 2)}\n`;
}

/** Faithful text description of the card for screen readers / alt attributes. */
export function buildAltText(
  templateLabel: string,
  rows: ShareCardRow[],
  content: ShareCardContent,
): string {
  const modelLines = rows.map((r) => {
    const visual = r.visual === "—" ? "visual not scored" : `visual ${r.visual} of 10`;
    const fails =
      r.failedSamples > 0
        ? `, ${r.failedSamples} render ${r.failedSamples === 1 ? "failure" : "failures"}`
        : "";
    return `${r.id}: ${visual}, tests ${r.tests}, cost ${r.cost}${fails}.`;
  });
  const parts = [
    `${templateLabel} card — ${content.title}.`,
    content.takeaway,
    ...modelLines,
    `Methodology: ${content.methodology}${content.footnote ? ` (${content.footnote})` : ""}.`,
  ];
  if (content.showRepoLink) parts.push(`Run ${content.runLink}.`);
  return parts.join(" ");
}

/** Social post draft: title, takeaway, 3-4 metric lines, run + repo trailer. */
export function buildPostDraft(rows: ShareCardRow[], content: ShareCardContent): string {
  const metricLines = rows
    .slice(0, 4)
    .map((r) => `${r.id} — visual ${r.visual}/10 · tests ${r.tests} · ${r.cost}`);
  return [
    content.title,
    "",
    content.takeaway,
    "",
    ...metricLines,
    "",
    `run ${content.runLink}`,
  ].join("\n");
}
