import { HumanAnnotation, PairwiseVote } from "@model-lab/schemas";
import { StoreError } from "./types";

/** The API is not the only writer: apply the same shape rules in every store. */
export function validateAnnotation(annotation: HumanAnnotation): void {
  if (
    !HumanAnnotation.safeParse(annotation).success ||
    !Number.isInteger(annotation.sampleIndex) ||
    annotation.sampleIndex < 1 ||
    (annotation.scoreOverride !== null &&
      (!Number.isFinite(annotation.scoreOverride) ||
        annotation.scoreOverride < 0 ||
        annotation.scoreOverride > 10))
  ) {
    throw new StoreError(
      "INVALID",
      "Annotation must reference a positive sample index and a 0–10 score.",
    );
  }
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
