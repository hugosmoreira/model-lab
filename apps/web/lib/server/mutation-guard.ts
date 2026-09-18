/**
 * Browser intent boundary for all write APIs. This is CSRF protection, not
 * authentication: private deployments still need an authenticated proxy.
 * Forwarded headers never select a trusted origin. Non-loopback deployments
 * must configure their one public origin explicitly.
 */
function originUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function rejection(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Run after read-only mode and before reading a body or creating state. */
export function guardMutationRequest(
  request: Pick<Request, "headers" | "url">,
  configuredOrigin = process.env.MODEL_LAB_APP_ORIGIN,
): Response | null {
  let expected: URL | null;
  if (configuredOrigin !== undefined && configuredOrigin.trim() !== "") {
    expected = originUrl(configuredOrigin.trim());
    if (expected === null) {
      return rejection(503, "MODEL_LAB_APP_ORIGIN must be an HTTP(S) origin without a path.");
    }
  } else {
    const target = new URL(request.url);
    expected = originUrl(target.origin);
    if (expected === null || !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)) {
      return rejection(403, "Configure MODEL_LAB_APP_ORIGIN before accepting non-local writes.");
    }
    const host = request.headers.get("host");
    if (host !== null) {
      // Next can normalize a loopback binding to localhost in request.url.
      // Accept the browser's loopback spelling only on the same bound port;
      // neither public Host values nor forwarded headers establish trust.
      const localAuthority = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)
        ? originUrl(`${expected.protocol}//${host}`)
        : null;
      if (localAuthority === null || localAuthority.port !== expected.port) {
        return rejection(403, "Request host must be loopback on the local application port.");
      }
      expected = localAuthority;
    }
  }

  const supplied = request.headers.get("origin");
  const origin = supplied === null ? null : originUrl(supplied);
  if (origin === null || origin.origin !== expected.origin) {
    return rejection(403, "Write requests require the application's exact Origin header.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site.toLowerCase() !== "same-origin") {
    return rejection(403, "Cross-site write requests are not allowed.");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return rejection(415, "Write requests require Content-Type: application/json.");
  }
  return null;
}
