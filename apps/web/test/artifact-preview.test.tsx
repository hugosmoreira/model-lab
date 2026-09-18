import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Artifact } from "@model-lab/schemas";
import { ArtifactSandbox, capturedPreviewSource } from "../components/artifact/ArtifactSandbox";

const artifact = Artifact.parse({
  runId: "run_test",
  endpointId: "model-hidden",
  sampleIndex: 1,
  path: "artifacts/synthetic.html",
  filename: "artifact.html",
  sizeKb: 1,
  renderOk: true,
  source: '<!-- <head> --><script>fetch("https://forbidden.invalid/")</script>',
  screenshotRef: "/api/runs/run_test/screenshots/full-id/endpoint-s1.png",
  sandbox: { isolatedOrigin: true, networkBlocked: true, execLimitSec: 30, sizeLimitMb: 5 },
});

test("previews render stored PNGs without executing or embedding generated HTML", () => {
  const markup = renderToStaticMarkup(<ArtifactSandbox artifact={artifact} widthPx={390} />);
  assert.match(markup, /<img /);
  assert.match(markup, /endpoint-s1\.png/);
  assert.doesNotMatch(markup, /<iframe|<script|srcdoc|forbidden\.invalid/i);
  assert.match(markup, /generated scripts do not run here/);
});

test("missing or untrusted captures stay unavailable rather than becoming live previews", () => {
  for (const screenshotRef of [
    null,
    "https://forbidden.invalid/image.png",
    "//forbidden.invalid/image.png",
    "data:image/svg+xml,<svg onload='alert(1)'/>",
    "/api/runs/run_test/screenshots/../sensitive.png",
    "/api/runs/run_test/screenshots/%2e%2e/sensitive.png",
    "/api/runs/run_test/screenshots/%5c%5cforbidden.png",
    "/api/runs/run_test/screenshots/file.png?redirect=remote.png",
    "/api/runs/run_test/screenshots/%broken.png",
  ]) {
    assert.equal(capturedPreviewSource(screenshotRef), null);
    const markup = renderToStaticMarkup(
      <ArtifactSandbox artifact={{ ...artifact, screenshotRef }} widthPx={null} />,
    );
    assert.match(markup, /No captured preview is available/);
    assert.doesNotMatch(markup, /<iframe|<script|<img|srcdoc|forbidden\.invalid/i);
  }
});
