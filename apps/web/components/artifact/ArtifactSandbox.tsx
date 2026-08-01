import type { Artifact } from "@model-lab/schemas";

/**
 * Content-Security-Policy injected into every artifact document:
 * no network of any kind (default-src 'none'), inline script/style only
 * (single-file contract), images restricted to data: URIs.
 */
const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">`;

/**
 * Pure: inject the sandbox CSP meta right after <head>. If the document has
 * no <head>, one is prepended (after <html> when present) so the policy is
 * always active before any artifact markup parses.
 */
export function injectCsp(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + CSP_META);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${CSP_META}</head>`);
  }
  return `<head>${CSP_META}</head>${html}`;
}

/**
 * SECURITY BOUNDARY (audit H-1/H-2): model-generated HTML executes inside an
 * <iframe sandbox="allow-scripts"> — NEVER allow-same-origin — so the artifact
 * runs in an opaque origin with no access to the app's origin, storage, or
 * cookies. The injected CSP additionally blocks all network egress.
 * Remounting (key change in the parent) restarts the isolated preview.
 */
export function ArtifactSandbox({
  artifact,
  widthPx,
}: {
  artifact: Artifact;
  /** null = 100% (desktop); otherwise a fixed device width in px */
  widthPx: number | null;
}) {
  return (
    <iframe
      sandbox="allow-scripts"
      title={`Sandboxed artifact preview — ${artifact.endpointId} · ${artifact.filename}`}
      srcDoc={injectCsp(artifact.source)}
      style={{
        alignSelf: "stretch",
        width: widthPx ?? "100%",
        maxWidth: "100%",
        minHeight: 320,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-void)",
        margin: "0 auto",
        display: "block",
      }}
    />
  );
}
