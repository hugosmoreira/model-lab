import type { Artifact } from "@model-lab/schemas";

/** These are display safeguards; the local operator can inspect the full run. */
export function historyPairingLabel(final: boolean, aName: string, bName: string): string {
  return final ? `${aName} vs ${bName}` : "Model A vs Model B · identities hidden";
}

/** Accessible preview text must not reveal either an endpoint or its filename. */
export function previewArtifact(artifact: Artifact, slot: "A" | "B", revealed: boolean): Artifact {
  return revealed
    ? artifact
    : { ...artifact, endpointId: `model-${slot}-hidden`, filename: `Artifact ${slot}` };
}
