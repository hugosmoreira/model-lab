import { z } from "zod";

export const ShareTemplate = z.enum([
  "new-model-scorecard",
  "head-to-head-winner",
  "cost-vs-quality",
  "category-breakdown",
  "wtl-matrix",
  "artifact-montage",
  "surprise-failure",
  "local-vs-cloud",
  "judge-disagreement",
  "methodology-card",
]);
export type ShareTemplate = z.infer<typeof ShareTemplate>;

export const ShareAspect = z.enum(["16:9", "1:1", "4:5"]);
export type ShareAspect = z.infer<typeof ShareAspect>;

export const SharePreset = z.object({
  runId: z.string(),
  template: ShareTemplate,
  aspect: ShareAspect,
  theme: z.enum(["dark", "light"]),
  title: z.string(),
  takeaway: z.string(),
  /** locked true at export time — integrity rule */
  showMethodology: z.literal(true).default(true),
  showRepoLink: z.boolean().default(true),
});
export type SharePreset = z.infer<typeof SharePreset>;

export const ShareExportRecord = z.object({
  filename: z.string(),
  aspect: ShareAspect,
  runId: z.string(),
  exportedAt: z.string(),
});
export type ShareExportRecord = z.infer<typeof ShareExportRecord>;
