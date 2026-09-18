import assert from "node:assert/strict";
import test from "node:test";
import { historyPairingLabel, previewArtifact } from "../lib/compare-privacy.ts";

test("unfinished history keeps both identities out of visible and accessible text", () => {
  const label = historyPairingLabel(false, "identifiable-one", "identifiable-two");
  assert.equal(label, "Model A vs Model B · identities hidden");
  assert.equal(
    historyPairingLabel(true, "identifiable-one", "identifiable-two"),
    "identifiable-one vs identifiable-two",
  );
});

test("blind previews mask endpoint and filename without changing captured media", () => {
  const artifact = {
    endpointId: "provider/identifiable-one",
    filename: "identifiable-one.html",
    screenshotRef: "/capture.png",
  };
  for (const slot of ["A", "B"]) {
    const hidden = previewArtifact(artifact, slot, false);
    assert.equal(hidden.endpointId, `model-${slot}-hidden`);
    assert.equal(hidden.filename, `Artifact ${slot}`);
    assert.equal(hidden.screenshotRef, artifact.screenshotRef);
    assert.equal(previewArtifact(artifact, slot, true), artifact);
  }
  assert.equal(artifact.filename, "identifiable-one.html");
});
