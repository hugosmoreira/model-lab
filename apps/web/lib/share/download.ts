/**
 * Browser-side download/clipboard helpers for the Share Studio exports.
 * Client-only (touches document/navigator) — import from "use client" modules.
 */

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    downloadDataUrl(url, filename);
  } finally {
    // revoke after the click has been consumed by the browser
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // insecure-context fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

/**
 * Integrity rule (never rasterize without the methodology footer): the card
 * DOM node must contain the exact methodology line before toPng/toSvg runs.
 */
export function assertMethodologyRendered(node: HTMLElement, methodology: string): void {
  const text = node.textContent ?? "";
  if (methodology.trim() === "" || !text.includes(methodology)) {
    throw new Error(
      "integrity check failed: the methodology footer must be visible in every export",
    );
  }
}
