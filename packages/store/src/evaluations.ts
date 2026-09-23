import { HumanAnnotation, PairwiseVote } from "@model-lab/schemas";
import { StoreError } from "./types";

/** New-write policy only: historical read schemas deliberately stay permissive. */
export const ANNOTATION_LIMITS = {
  noteCharacters: 4_000,
  textBytes: 32_768,
  perRun: 1_000,
} as const;
export const ANNOTATION_CAPACITY_MESSAGE =
  "This run has reached its 1,000-annotation limit. Existing notes and ratings are preserved.";

/** The API is not the only writer: apply the same shape rules in every store. */
export function validateAnnotation(annotation: HumanAnnotation): HumanAnnotation {
  const parsed = HumanAnnotation.safeParse(annotation);
  const value = parsed.success ? parsed.data : null;
  if (
    value === null ||
    !Number.isInteger(value.sampleIndex) ||
    value.sampleIndex < 1 ||
    (value.scoreOverride !== null &&
      (!Number.isFinite(value.scoreOverride) ||
        value.scoreOverride < 0 ||
        value.scoreOverride > 10))
  ) {
    throw new StoreError(
      "INVALID",
      "Annotation must reference a positive sample index and a 0–10 score.",
    );
  }
  const text = [value.runId, value.endpointId, value.note, value.author, value.at];
  if (
    value.note.length < 1 ||
    value.note.length > ANNOTATION_LIMITS.noteCharacters ||
    text.some((field) => field.length > ANNOTATION_LIMITS.textBytes) ||
    text.reduce((bytes, field) => bytes + Buffer.byteLength(field, "utf8"), 0) >
      ANNOTATION_LIMITS.textBytes
  ) {
    throw new StoreError(
      "INVALID",
      "Annotations require a 1–4,000-character note and at most 32 KiB of total text.",
    );
  }
  // Persist only schema fields: unknown caller properties must not bypass the
  // retention bound in MemoryStore, which otherwise clones the original input.
  return value;
}

export function validateVote(vote: PairwiseVote): void {
  if (
    !PairwiseVote.safeParse(vote).success ||
    !Number.isInteger(vote.pairIndex) ||
    vote.pairIndex < 1 ||
    !Number.isInteger(vote.pairTotal) ||
    vote.pairIndex > vote.pairTotal ||
    vote.pairing[0] === vote.pairing[1]
  ) {
    throw new StoreError(
      "INVALID",
      "Vote must reference two distinct participants and a valid pair index.",
    );
  }
}
