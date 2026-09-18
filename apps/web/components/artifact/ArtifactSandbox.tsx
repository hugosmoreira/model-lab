import type { Artifact } from "@model-lab/schemas";

/** Only stored same-origin PNG routes are eligible to become image requests. */
export function capturedPreviewSource(ref: string | null): string | null {
  if (ref === null || !/^\/api\/runs\/[^/?#]+\/screenshots\//.test(ref)) return null;
  try {
    const parts = ref.split("/").map(decodeURIComponent);
    if (parts.some((part) => part === "." || part === ".." || /[\\?#]/.test(part))) return null;
    if (!ref.endsWith(".png")) return null;
    return ref;
  } catch {
    return null;
  }
}

/**
 * Generated scripts never execute in the operator's browser. A sandboxed
 * iframe's CSP does not reliably prohibit self-navigation, so previews use
 * captured PNG evidence. Artifact execution belongs to the controlled runner.
 */
export function ArtifactSandbox({
  artifact,
  widthPx,
}: {
  artifact: Artifact;
  widthPx: number | null;
}) {
  const source = capturedPreviewSource(artifact.screenshotRef);
  return (
    <figure
      style={{
        alignSelf: "stretch",
        width: widthPx ?? "100%",
        maxWidth: "100%",
        minHeight: 320,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-void)",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element -- stored run PNG, not generated HTML
        <img
          src={source}
          alt={`Captured artifact — ${artifact.endpointId} · ${artifact.filename}`}
          style={{ width: "100%", height: "auto", objectFit: "contain", display: "block" }}
        />
      ) : (
        <p style={{ padding: 24, textAlign: "center", color: "var(--color-muted)" }}>
          No captured preview is available. Source and browser-check evidence remain available.
        </p>
      )}
      <figcaption
        style={{ padding: 10, fontSize: 11, textAlign: "center", color: "var(--color-faint)" }}
      >
        Captured preview · generated scripts do not run here
      </figcaption>
    </figure>
  );
}
