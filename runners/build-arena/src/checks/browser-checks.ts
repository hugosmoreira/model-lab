/**
 * Playwright chromium implementation of the 12 named browser checks.
 *
 * Artifact HTML is fulfilled locally with an immutable response-header CSP,
 * an opaque sandbox origin, context-wide HTTP/WebSocket denial and blocked
 * service workers. Native WebRTC UDP denial plus a non-forwarding proxy closes
 * its separate socket path. These are browser controls, not an OS sandbox.
 * Each artifact has private contexts and a 30s watchdog.
 *
 * Graceful degradation: if the chromium browser cannot launch (not installed),
 * every check returns status "skipped" with an install hint — the run never
 * crashes.
 *
 * TAXONOMY (see CHECK_CATEGORY): every check is a gate, a capability or a
 * diagnostic. Gates are correctness preconditions; capabilities are the
 * headline score; diagnostics measure the harness and are never scored.
 *
 * PIXEL EVIDENCE: the checks that decide whether the artifact actually drew a
 * scene (canvas.renders, minimap.present, textures.applied) read the captured
 * frame, not the DOM. A build that paints only a sky gradient and a floor
 * gradient used to pass all three — a two-stop gradient is "non-blank", has
 * plenty of global colour variance, and a black minimap canvas is still
 * present in the DOM. See analyzeFrame / CHECK_THRESHOLDS.
 *
 * FAIL CLOSED: none of those three may report a working render when the frame
 * could not be measured. "We looked and it was empty" is a verdict about the
 * artifact ("failed"); "we could not look" is a verdict about the harness
 * ("warn" + a note that starts MEASUREMENT FAILED and names the reason), and
 * an unresolved gate makes the sample noSignal — score null, never a clean
 * pass and never a manufactured zero. See unmeasuredGates().
 */
import type { BrowserTestResult, CheckCategory, ConsoleLine } from "@model-lab/schemas";
import type { Browser, BrowserContext, Page } from "playwright";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { errorMessage } from "../providers/util";
import {
  artifactBrowserExecutable,
  BROWSER_RUNTIME,
  supportedBrowserVersion,
} from "./browser-runtime";

export const BROWSER_CHECK_NAMES = [
  "html.parses",
  "page.loads",
  "console.clean",
  "canvas.renders",
  "interaction.wasd",
  "interaction.mouse",
  "minimap.present",
  "screenshot.captured",
  "textures.applied",
  "fps.stable",
  "resize.handled",
  "a11y.contrast",
] as const;
export type BrowserCheckName = (typeof BROWSER_CHECK_NAMES)[number];

/**
 * The single source of truth for what each check is FOR. record() stamps the
 * category from this map so no call site can forget it.
 *
 *  gate        — a correctness precondition. A failed gate means the artifact
 *                is broken and the headline score is 0, whatever else passed.
 *  capability  — did the model build what the brief asked for. THIS is the
 *                headline score.
 *  diagnostic  — measures the harness / rendering environment, not the
 *                artifact. screenshot.captured says Playwright wrote a PNG;
 *                fps.stable says this machine's compositor kept up; a11y
 *                contrast samples DOM chrome, not the 3D view. Reported so a
 *                human can see them, never scored.
 */
export const CHECK_CATEGORY: Record<BrowserCheckName, CheckCategory> = {
  "html.parses": "gate",
  "page.loads": "gate",
  "console.clean": "gate",
  "canvas.renders": "gate",
  "interaction.wasd": "capability",
  "interaction.mouse": "capability",
  "minimap.present": "capability",
  "textures.applied": "capability",
  "resize.handled": "capability",
  "screenshot.captured": "diagnostic",
  "fps.stable": "diagnostic",
  "a11y.contrast": "diagnostic",
};

/**
 * Every tuned number lives here, with what it distinguishes and the real
 * measurements behind it. Calibrated on the stored artifacts of runs
 * run_0cf7aa08 / run_a410b632 / run_ad3f9707 / run_f0520023 / run_a5020387
 * (15 artifacts: 3 gradient-only "no walls" local builds vs 12 builds that
 * genuinely render a scene). Luminance values are 0-255.
 */
export const CHECK_THRESHOLDS = {
  /**
   * canvas.renders (gate) — σ of per-column mean luminance across the middle
   * band. A raycaster paints vertical wall bands, so columns differ; a sky /
   * floor gradient varies only with y, so every column is identical and σ→0.
   * Measured: gradient-only builds 0.00 / 0.12 / 0.38; the weakest build that
   * really renders 8.6, the rest 13-32.
   */
  columnVarianceMin: 2,
  /**
   * canvas.renders (gate) — mean |Δluminance| between horizontally-adjacent
   * pixels. Only consulted when columnVariance is ALREADY below its floor: the
   * two together mean "no vertical structure AND no high-frequency detail".
   * Measured: gradient-only builds 0.00 / 0.49 / 0.75 (the 0.75 is a crosshair
   * and HUD text painted on the canvas, not walls).
   */
  localDetailMin: 1.5,
  /**
   * canvas.renders (gate) — a frame this uniform is blank. Measured: an
   * all-one-colour frame 1.00; the most uniform genuine render 0.92.
   */
  blankUniformityMax: 0.995,
  /**
   * minimap.present (capability) — a located element has to draw more than one
   * flat colour. Deliberately a floor, not a richness bar: a legitimate map can
   * be two tones (walls on background). Measured on the padding box: empty
   * minimaps 1 quantised colour; real minimaps 3-97.
   */
  minimapDistinctColorsMin: 2,
  /**
   * minimap.present (capability) — fraction of the element that is one colour;
   * this is the leg that catches an all-black canvas. Read it as "at least 5%
   * of the element has to be something other than the background". Measured:
   * empty minimaps 0.99-1.00 (the 0.99 is a container border clipping in);
   * real minimaps 0.33-0.68, so the pass side keeps wide clearance.
   */
  minimapUniformityMax: 0.95,
  /**
   * textures.applied (capability) — edge density inside the wall region (see
   * FrameMetrics.wallDetail). Mean |Δ| alone cannot do this job: chunky pixel
   * textures are mostly flat blocks, so a genuinely textured build measured a
   * LOWER mean |Δ| (0.18) than a gradient-only build (0.75). Edge density is
   * bimodal instead — a smooth vertical gradient has no horizontal delta at
   * all. Measured: gradient-only builds exactly 0.0000; textured builds
   * 0.0225 / 0.0677 / 0.1465 / 0.1565 / 0.2816.
   */
  wallDetailMin: 0.01,
  /** textures.applied — below the pass line but above this is flat shading (warn), not an empty frame. */
  wallDetailWarn: 0.002,
  /** |Δluminance| (0-255) that counts as an edge rather than gradient banding. */
  edgeDelta: 4,

  // -- geometry ------------------------------------------------------------
  /** Middle band of the view, as a fraction of canvas height: where walls live.
   *  Narrow enough to sit below a top HUD and above a bottom status bar. */
  bandTop: 0.4,
  bandBottom: 0.62,
  /** The "wall region": the most edge-dense quarter of the band's columns. A
   *  raycaster looking down an open corridor puts walls in part of the frame
   *  only, so averaging over the whole band would dilute real texture away. */
  wallColumnFraction: 0.25,
  /** A positioned element covering more of the canvas than this is a
   *  full-bleed wrapper, not a HUD — masking it would blank the measurement. */
  overlayMaxCoverage: 0.35,
  /** A column with more than this fraction of its band rows behind a HUD /
   *  minimap overlay is dropped: partial columns would be averaged over
   *  different rows and manufacture variance out of a plain gradient. */
  overlayColumnTolerance: 0.05,
  /** Fewer surviving columns than this and the masked measurement is not
   *  trustworthy — fall back to measuring unmasked. */
  minSampleColumns: 16,
} as const;

export const BROWSER_NOT_INSTALLED_NOTE = "verified browser unavailable — run pnpm browser:install";

export const ARTIFACT_CSP =
  "sandbox allow-scripts allow-pointer-lock; default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";
// The sandbox directive is only effective in the HTTP header, never a meta tag.
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP.replace("sandbox allow-scripts allow-pointer-lock; ", "")}">`;

export interface BrowserChecksOptions {
  screenshotPath: string;
  watchdogMs?: number; // default 30_000
  signal?: AbortSignal;
}

export interface BrowserChecksOutcome {
  checks: BrowserTestResult[];
  consoleLines: ConsoleLine[];
  screenshotSaved: boolean;
  degraded: boolean; // true when the browser could not be launched
}

/** Category of a stored result — falls back to the map for historical traces. */
export function categoryOf(result: Pick<BrowserTestResult, "name" | "category">): CheckCategory {
  const known = CHECK_CATEGORY[result.name as BrowserCheckName];
  return known ?? result.category ?? "capability";
}

/** The checks that make up the headline score. */
export function capabilityChecks(results: readonly BrowserTestResult[]): BrowserTestResult[] {
  return results.filter((r) => categoryOf(r) === "capability");
}

/** Failed correctness preconditions, in canonical check order. */
export function failedGates(results: readonly BrowserTestResult[]): BrowserTestResult[] {
  return results.filter((r) => categoryOf(r) === "gate" && r.status === "failed");
}

/**
 * Gates whose verdict could not be established — the measuring instrument
 * broke, so we know nothing about the artifact either way.
 *
 * FAIL-CLOSED POLICY. A gate is a claim about the artifact; an unmeasurable
 * frame supports no claim, so it must never be recorded "passed". It is
 * recorded "warn" instead, and the run treats it as `noSignal` (score: null,
 * the state already used for a degraded harness) rather than as a zero.
 *
 * Why null and not 0: a 0 asserts "we measured this build and it is broken",
 * which is a statement about the MODEL. An unmeasurable frame is a statement
 * about the HARNESS. Handing out zeros for a harness fault corrupts the
 * leaderboard exactly as badly as handing out passes did, just in the other
 * direction — and it would be far harder to notice, because a zero looks like
 * a legitimate result. `noSignal` already exists for "the checks produced no
 * capability signal" (browser not installed), so this reuses it rather than
 * inventing a third state.
 */
export function unmeasuredGates(results: readonly BrowserTestResult[]): BrowserTestResult[] {
  return results.filter((r) => categoryOf(r) === "gate" && r.status === "warn");
}

type BrowserLease = {
  promise: Promise<Browser | null>;
  users: number;
  closing: boolean;
  unavailableNote: string;
};
let sharedBrowser: BrowserLease | null = null;
let browserVersion: string | null = null;

/**
 * WebRTC sockets bypass Playwright request interception and connect-src CSP.
 * Force its native transport policy to disable direct UDP and route TCP
 * through a private proxy that closes every connection without forwarding.
 * Never fall back to a normal browser if either control fails to initialize.
 */
export async function launchArtifactBrowser(): Promise<Browser> {
  const denyProxy = createServer((socket) => socket.destroy());
  let browser: Browser | null = null;
  denyProxy.on("error", () => {
    void browser?.close().catch(() => undefined);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      denyProxy.once("error", reject);
      denyProxy.listen(0, "127.0.0.1", () => {
        denyProxy.removeListener("error", reject);
        resolve();
      });
    });
    const address = denyProxy.address();
    if (address === null || typeof address === "string") throw new Error("deny proxy unavailable");
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      executablePath: artifactBrowserExecutable(),
      proxy: { server: `http://127.0.0.1:${address.port}`, bypass: "<-loopback>" },
      args: [
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-quic",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ],
    });
    if (!supportedBrowserVersion(browser.version())) {
      throw new Error(
        `Browser ${browser.version()} is older than required ${BROWSER_RUNTIME.minimumVersion}; run pnpm browser:install`,
      );
    }
    browser.once("disconnected", () => denyProxy.close());
    return browser;
  } catch (error) {
    await browser?.close().catch(() => undefined);
    denyProxy.close();
    throw error;
  }
}

function acquireBrowser(): BrowserLease {
  if (sharedBrowser === null || sharedBrowser.closing) {
    const lease: BrowserLease = {
      promise: Promise.resolve(null),
      users: 0,
      closing: false,
      unavailableNote: BROWSER_NOT_INSTALLED_NOTE,
    };
    lease.promise = (async () => {
      try {
        const browser = await launchArtifactBrowser();
        browserVersion = `chromium ${browser.version()}`;
        return browser;
      } catch (error) {
        lease.unavailableNote = `${BROWSER_NOT_INSTALLED_NOTE}: ${errorMessage(error).slice(0, 240)}`;
        return null;
      }
    })();
    sharedBrowser = lease;
  }
  sharedBrowser.users += 1;
  return sharedBrowser;
}

async function releaseBrowser(lease: BrowserLease): Promise<void> {
  lease.users -= 1;
  if (lease.closing && lease.users === 0) await disposeBrowser(lease);
}

async function disposeBrowser(lease: BrowserLease): Promise<void> {
  if (sharedBrowser === lease) sharedBrowser = null;
  const browser = await lease.promise.catch(() => null);
  if (browser !== null) await browser.close().catch(() => undefined);
}

/**
 * "chromium 141.0.7390.37" once a browser has launched in this process — the
 * exact build every check in the run executed in — or null before that.
 */
export function getBrowserVersion(): string | null {
  return browserVersion;
}

/**
 * The frame analyzer lives in its OWN context and never loads artifact HTML:
 * it decodes a PNG we captured and reads its pixels. Two reasons it is not the
 * artifact's page: (1) an artifact could shadow Image / getImageData and hand
 * the scorer whatever pixels it liked — this is a benchmark, so the measuring
 * instrument must be out of the subject's reach; (2) a WebGL canvas without
 * preserveDrawingBuffer reads back empty outside its own rAF, whereas the
 * composited screenshot is always correct.
 */

/**
 * The analyzer page needs the same `__name` shim the artifact page gets (see
 * NAME_HELPER): every function handed to `analyzer.evaluate` is serialized
 * from THIS module's source, and a transpiler that preserves function names
 * (tsx/esbuild `keepNames`, and any bundler configured the same way) rewrites
 *   `const LOAD_FRAME = async (u) => {…}`
 * into
 *   `const LOAD_FRAME = __name(async (u) => {…}, "LOAD_FRAME")`
 * — wrapping the inner arrows too. The helper only exists in module scope, so
 * the serialized body throws `ReferenceError: __name is not defined` in a page
 * that lacks it. The artifact page is covered twice over (addInitScript + the
 * injected <script>); this page was covered nowhere, which silently disabled
 * ALL pixel analysis under those toolchains.
 *
 * Passed as a STRING, not a function: a string is never rewritten by the
 * transpiler, so the shim cannot depend on the very helper it installs. It is
 * written as a comma expression so it is valid both as an init-script
 * statement and as an `evaluate` expression, and so the value handed back is a
 * serializable string rather than the function itself.
 */
const ANALYZER_NAME_SHIM =
  "globalThis.__name = globalThis.__name || function (target) { return target; }, " +
  "typeof globalThis.__name";

async function createAnalyzer(ctx: BrowserContext): Promise<Page> {
  await ctx.addInitScript({ content: ANALYZER_NAME_SHIM });
  const page = await ctx.newPage();
  await page.evaluate(ANALYZER_NAME_SHIM);
  return page;
}

/** Retire this browser generation; active operations release their own leases. */
export async function closeBrowserChecks(): Promise<void> {
  const lease = sharedBrowser;
  if (lease === null) return;
  lease.closing = true;
  if (lease.users === 0) await disposeBrowser(lease);
}

/**
 * Transpilers (tsx/esbuild keepNames) wrap functions passed to page.evaluate
 * in a __name(...) helper the page doesn't define. The trusted prefix keeps
 * the exported HTML wrapper compatible with setContent callers (which do
 * not run init scripts), as well as the runner's header-protected navigation.
 */
const NAME_HELPER = `<script>globalThis.__name = function(t, n) { return t; };</script>`;

/** Trusted prefix: never select a head-looking substring from untrusted HTML. */
export function injectCsp(html: string): string {
  return `<!doctype html><html><head>${CSP_META}${NAME_HELPER}</head>${html}`;
}

/** Install before creating any page, including the first artifact navigation. */
export async function restrictArtifactContext(context: BrowserContext): Promise<void> {
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  await context.routeWebSocket("**/*", (socket) => socket.close());
}

type CheckStatus = BrowserTestResult["status"];

function result(
  name: BrowserCheckName,
  status: CheckStatus,
  note: string,
  ms: number | null,
): BrowserTestResult {
  return { name, status, note, durationMs: ms, category: CHECK_CATEGORY[name] };
}

function skippedAll(note: string): BrowserTestResult[] {
  return BROWSER_CHECK_NAMES.map((name) => result(name, "skipped", note, null));
}

function fillMissing(results: BrowserTestResult[], status: CheckStatus, note: string): void {
  const seen = new Set(results.map((r) => r.name));
  for (const name of BROWSER_CHECK_NAMES) {
    if (!seen.has(name)) results.push(result(name, status, note, null));
  }
}

/** Display order is the canonical check order, whatever order they were run in. */
function inCanonicalOrder(results: BrowserTestResult[]): BrowserTestResult[] {
  const rank = new Map<string, number>(BROWSER_CHECK_NAMES.map((n, i) => [n, i]));
  return [...results].sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));
}

export const BROWSER_DIAGNOSTIC_LIMITS = {
  lines: 100,
  lineBytes: 400,
  events: 1_000,
  receivedBytes: 1_000_000,
} as const;

/** Keep UTF-8 storage bounded even for multibyte input. */
function truncateDiagnostic(msg: string): string {
  const prefix = msg.slice(0, BROWSER_DIAGNOSTIC_LIMITS.lineBytes);
  const bytes = Buffer.from(prefix);
  if (bytes.byteLength <= BROWSER_DIAGNOSTIC_LIMITS.lineBytes) return prefix;
  // Drop an incomplete final UTF-8 sequence rather than introducing extra bytes.
  return bytes.subarray(0, BROWSER_DIAGNOSTIC_LIMITS.lineBytes).toString("utf8").replace(/�$/, "");
}

function pushConsole(
  lines: ConsoleLine[],
  t0: number,
  level: ConsoleLine["level"],
  msg: string,
): void {
  if (lines.length >= BROWSER_DIAGNOSTIC_LIMITS.lines) return;
  lines.push({
    t: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
    level,
    msg: truncateDiagnostic(msg),
  });
}

async function canvasSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cv = document.querySelector("canvas");
    if (cv === null) return "";
    try {
      return cv.toDataURL();
    } catch {
      return "";
    }
  });
}

// ---------------------------------------------------------------------------
// Frame analysis
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Measurements over one rectangle of the captured frame. */
export interface RegionMetrics {
  /**
   * σ of per-column mean luminance across the middle band. Vertical wall bands
   * push it up; a gradient that varies only with y leaves every column
   * identical, so it collapses to ~0.
   */
  columnVariance: number;
  /** Mean |Δluminance| between horizontally-adjacent pixels in the band. */
  localDetail: number;
  /**
   * localDetail in its edge form, restricted to the wall region (the most
   * edge-dense quarter of the band's columns): the fraction of adjacent pixel
   * pairs whose |Δluminance| clears CHECK_THRESHOLDS.edgeDelta. Survives
   * chunky pixel textures, which keep the *mean* delta low.
   */
  wallDetail: number;
  /**
   * Distinct quantised colours (4 bits/channel) over the whole rectangle as
   * composited — overlays included, since they are part of what was drawn.
   */
  distinctColors: number;
  /** Fraction of pixels equal to the modal quantised colour (all-black → 1.0). */
  uniformity: number;
  /** Columns actually sampled. 0 means nothing was measurable. */
  columns: number;
}

interface FrameProbe {
  canvas: Rect | null;
  /** HUD / minimap rectangles painted over the canvas, in CSS px. */
  masks: Rect[];
  minimap: (Rect & { how: string }) | null;
  viewport: { w: number; h: number };
}

interface Frame {
  metrics: RegionMetrics;
  probe: FrameProbe;
  /** measure an arbitrary sub-rectangle (CSS px) of the same frame */
  measure: (rect: Rect, masks: Rect[]) => Promise<RegionMetrics | null>;
}

/**
 * Locate the main canvas, the overlays painted on top of it, and the minimap
 * candidate — all in one DOM pass, in the artifact's page.
 */
const PROBE_DOM = (limits: { overlayMaxCoverage: number }): FrameProbe => {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const canvases = Array.from(document.querySelectorAll("canvas"));
  const toRect = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  // minimap heuristic (unchanged): a 2nd canvas, a named element, or a small
  // positioned overlay.
  let mmEl: Element | null = null;
  let how = "";
  let main: HTMLCanvasElement | null = null;
  let area = 0;
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    if (r.width * r.height > area) {
      area = r.width * r.height;
      main = c;
    }
  }
  if (canvases.length >= 2) {
    mmEl = canvases.find((c) => c !== main) ?? null;
    how = "second canvas";
  }
  if (mmEl === null) {
    const named = document.querySelector(
      '[id*="minimap" i],[class*="minimap" i],[id*="radar" i],[class*="radar" i]',
    );
    if (named !== null) {
      mmEl = named;
      how = "named element";
    }
  }
  if (mmEl === null) {
    for (const el of Array.from(document.querySelectorAll("div,section,aside,svg"))) {
      const cs = getComputedStyle(el);
      if (cs.position === "absolute" || cs.position === "fixed") {
        const r = el.getBoundingClientRect();
        if (
          r.width > 20 &&
          r.width < window.innerWidth * 0.4 &&
          r.height > 20 &&
          r.height < window.innerHeight * 0.4
        ) {
          mmEl = el;
          how = "positioned overlay";
          break;
        }
      }
    }
  }
  /**
   * The minimap is measured on its PADDING box, not its border box: a bright
   * CSS border around an all-black canvas would otherwise read as content and
   * hide the fact that nothing was drawn.
   */
  const paddingBox = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    const bl = el.clientLeft;
    const bt = el.clientTop;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!Number.isFinite(cw) || cw <= 0 || !Number.isFinite(ch) || ch <= 0) return toRect(el);
    // clientWidth/Height are untransformed layout px while the rect is not, so
    // scale the border inset by whatever CSS transform the box carries.
    const borderW = cw + 2 * bl;
    const borderH = ch + 2 * bt;
    const sx = r.width > 0 && borderW > 0 ? r.width / borderW : 1;
    const sy = r.height > 0 && borderH > 0 ? r.height / borderH : 1;
    return { x: r.left + bl * sx, y: r.top + bt * sy, w: cw * sx, h: ch * sy };
  };
  const minimap = mmEl === null ? null : { ...paddingBox(mmEl), how };

  if (main === null) return { canvas: null, masks: [], minimap, viewport };
  const mr = main.getBoundingClientRect();
  const chain = new Set<Element>();
  for (let p: Element | null = main; p !== null; p = p.parentElement) chain.add(p);

  const masks: Rect[] = [];
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 4000)) {
    if (chain.has(el)) continue;
    const cs = getComputedStyle(el);
    const positioned =
      cs.position === "absolute" || cs.position === "fixed" || cs.position === "sticky";
    if (!positioned && el.tagName !== "CANVAS") continue;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const overlap =
      Math.max(0, Math.min(r.right, mr.right) - Math.max(r.left, mr.left)) *
      Math.max(0, Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top));
    if (overlap <= 0) continue;
    // a full-bleed wrapper is not a HUD; masking it would blank the frame
    if (area > 0 && overlap / area > limits.overlayMaxCoverage) continue;
    masks.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    if (masks.length >= 40) break;
  }
  return { canvas: { x: mr.left, y: mr.top, w: mr.width, h: mr.height }, masks, minimap, viewport };
};

/** Decode the captured PNG into the analyzer page. Returns its pixel size. */
const LOAD_FRAME = async (dataUrl: string): Promise<{ w: number; h: number }> => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (g === null) throw new Error("no 2d context");
  g.drawImage(img, 0, 0);
  (globalThis as unknown as { __mlFrame: unknown }).__mlFrame = {
    ctx: g,
    w: c.width,
    h: c.height,
  };
  return { w: c.width, h: c.height };
};

interface MeasureRequest {
  rect: Rect;
  masks: Rect[];
  bandTop: number;
  bandBottom: number;
  wallColumnFraction: number;
  overlayColumnTolerance: number;
  minSampleColumns: number;
  edgeDelta: number;
}

/**
 * Runs in the analyzer page against the decoded frame. Pure arithmetic — no
 * artifact code has ever run in this context.
 */
const MEASURE_REGION = (req: MeasureRequest): RegionMetrics => {
  const frame = (
    globalThis as unknown as {
      __mlFrame?: { ctx: CanvasRenderingContext2D; w: number; h: number };
    }
  ).__mlFrame;
  if (frame === undefined) throw new Error("frame not loaded");
  const x0 = Math.max(0, Math.min(frame.w - 1, Math.round(req.rect.x)));
  const y0 = Math.max(0, Math.min(frame.h - 1, Math.round(req.rect.y)));
  const w = Math.max(1, Math.min(frame.w - x0, Math.round(req.rect.w)));
  const h = Math.max(1, Math.min(frame.h - y0, Math.round(req.rect.h)));
  const d = frame.ctx.getImageData(x0, y0, w, h).data;
  const lum = (i: number): number =>
    0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
  const quant = (i: number): number =>
    (((d[i] ?? 0) >> 4) << 8) | (((d[i + 1] ?? 0) >> 4) << 4) | ((d[i + 2] ?? 0) >> 4);

  const bandTop = Math.floor(h * req.bandTop);
  const bandBottom = Math.max(bandTop + 1, Math.floor(h * req.bandBottom));
  const rowStride = Math.max(1, Math.floor((bandBottom - bandTop) / 60));
  const colStride = Math.max(1, Math.floor(w / 400));

  const scan = (
    boxes: Array<{ x: number; y: number; r: number; b: number }>,
  ): { means: number[]; edges: number[]; details: number[] } => {
    const means: number[] = [];
    const edges: number[] = [];
    const details: number[] = [];
    for (let x = 0; x + 1 < w; x += colStride) {
      let sum = 0;
      let n = 0;
      let deltaSum = 0;
      let edgeHits = 0;
      let blocked = 0;
      let rows = 0;
      for (let y = bandTop; y < bandBottom; y += rowStride) {
        rows += 1;
        let hidden = false;
        for (const bx of boxes) {
          if (y >= bx.y && y < bx.b && x + 1 >= bx.x && x < bx.r) {
            hidden = true;
            break;
          }
        }
        if (hidden) {
          blocked += 1;
          continue;
        }
        const l = lum((y * w + x) * 4);
        const delta = Math.abs(lum((y * w + x + 1) * 4) - l);
        sum += l;
        n += 1;
        deltaSum += delta;
        if (delta >= req.edgeDelta) edgeHits += 1;
      }
      if (n === 0 || rows === 0 || blocked / rows > req.overlayColumnTolerance) continue;
      means.push(sum / n);
      details.push(deltaSum / n);
      edges.push(edgeHits / n);
    }
    return { means, edges, details };
  };

  const boxes = req.masks.map((m) => ({
    x: m.x - x0,
    y: m.y - y0,
    r: m.x + m.w - x0,
    b: m.y + m.h - y0,
  }));
  let scanned = scan(boxes);
  if (scanned.means.length < req.minSampleColumns && boxes.length > 0) {
    scanned = scan([]); // masking left too little to trust — measure unmasked
  }

  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanOfMeans = mean(scanned.means);
  const columnVariance =
    scanned.means.length > 1
      ? Math.sqrt(
          scanned.means.reduce((a, b) => a + (b - meanOfMeans) ** 2, 0) / scanned.means.length,
        )
      : 0;
  const rankedEdges = [...scanned.edges].sort((a, b) => b - a);
  const wallCols = Math.max(1, Math.round(rankedEdges.length * req.wallColumnFraction));
  const wallDetail = rankedEdges.length === 0 ? 0 : mean(rankedEdges.slice(0, wallCols));

  // distinct colours / uniformity over the whole rectangle
  const hist = new Map<number, number>();
  let total = 0;
  const qx = Math.max(1, Math.floor(w / 200));
  const qy = Math.max(1, Math.floor(h / 200));
  for (let y = 0; y < h; y += qy) {
    for (let x = 0; x < w; x += qx) {
      const k = quant((y * w + x) * 4);
      hist.set(k, (hist.get(k) ?? 0) + 1);
      total += 1;
    }
  }
  let modal = 0;
  for (const v of hist.values()) if (v > modal) modal = v;

  return {
    columnVariance,
    localDetail: mean(scanned.details),
    wallDetail,
    distinctColors: hist.size,
    uniformity: total > 0 ? modal / total : 1,
    columns: scanned.means.length,
  };
};

const T = CHECK_THRESHOLDS;

/**
 * Either a measured frame, or the reason there isn't one. NEVER collapse the
 * two: "we looked and the frame was empty" and "we could not look" are
 * different findings, and conflating them is what let every broken artifact
 * pass canvas.renders while the analyzer was throwing.
 */
type FrameResult = { frame: Frame; issue: null } | { frame: null; issue: string };

/**
 * Capture the frame ONCE and hand back a measured view of it. Reuses the same
 * screenshot the screenshot.captured diagnostic reports on — no extra grabs.
 */
async function analyzeFrame(
  page: Page,
  analyzer: Page | null,
  buffer: Buffer,
): Promise<FrameResult> {
  if (analyzer === null) return { frame: null, issue: "analyzer page unavailable" };
  const probe = await page.evaluate(PROBE_DOM, { overlayMaxCoverage: T.overlayMaxCoverage });
  const size = await analyzer.evaluate(
    LOAD_FRAME,
    `data:image/png;base64,${buffer.toString("base64")}`,
  );
  const scaleX = probe.viewport.w > 0 ? size.w / probe.viewport.w : 1;
  const scaleY = probe.viewport.h > 0 ? size.h / probe.viewport.h : 1;
  const toFrame = (r: Rect): Rect => ({
    x: r.x * scaleX,
    y: r.y * scaleY,
    w: r.w * scaleX,
    h: r.h * scaleY,
  });

  const measure = async (rect: Rect, masks: Rect[]): Promise<RegionMetrics | null> => {
    const f = toFrame(rect);
    const x = Math.max(0, f.x);
    const y = Math.max(0, f.y);
    const clipped: Rect = {
      x,
      y,
      w: Math.min(size.w - x, f.w - (x - f.x)),
      h: Math.min(size.h - y, f.h - (y - f.y)),
    };
    if (clipped.w < 8 || clipped.h < 8) return null;
    return analyzer.evaluate(MEASURE_REGION, {
      rect: clipped,
      masks: masks.map(toFrame),
      bandTop: T.bandTop,
      bandBottom: T.bandBottom,
      wallColumnFraction: T.wallColumnFraction,
      overlayColumnTolerance: T.overlayColumnTolerance,
      minSampleColumns: T.minSampleColumns,
      edgeDelta: T.edgeDelta,
    });
  };

  // The 3D view is the main canvas, inset 2% so a CSS border is not read as
  // structure; the page background outside it is not the artifact's render.
  const view = probe.canvas;
  if (view === null) return { frame: null, issue: "no canvas rect in the captured frame" };
  const metrics = await measure(
    { x: view.x + view.w * 0.02, y: view.y, w: view.w * 0.96, h: view.h },
    probe.masks,
  );
  if (metrics === null) {
    return {
      frame: null,
      issue: `canvas rect too small to sample (${Math.round(view.w)}×${Math.round(view.h)}px)`,
    };
  }
  return { frame: { metrics, probe, measure }, issue: null };
}

export async function runBrowserChecks(
  html: string,
  opts: BrowserChecksOptions,
): Promise<BrowserChecksOutcome> {
  const lease = acquireBrowser();
  const browser = await lease.promise;
  if (browser === null) {
    await releaseBrowser(lease);
    return {
      checks: skippedAll(lease.unavailableNote),
      consoleLines: [],
      screenshotSaved: false,
      degraded: true,
    };
  }

  const watchdogMs = opts.watchdogMs ?? 30_000;
  const results: BrowserTestResult[] = [];
  const consoleLines: ConsoleLine[] = [];
  let screenshotSaved = false;
  let context: BrowserContext | null = null;
  let analyzerContext: BrowserContext | null = null;
  let timedOut = false;
  let stopped: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (reason: string): void => {
    stopped ??= reason;
    void context?.close().catch(() => undefined);
    void analyzerContext?.close().catch(() => undefined);
  };
  const onAbort = (): void => stop("cancelled by operator");
  const outcome = (): BrowserChecksOutcome => {
    if (stopped !== null) {
      const clean = results.find((entry) => entry.name === "console.clean");
      if (clean) Object.assign(clean, { status: "failed", note: stopped });
      else results.push(result("console.clean", "failed", stopped, null));
    }
    return { checks: inCanonicalOrder(results), consoleLines, screenshotSaved, degraded: false };
  };

  try {
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) {
      stop("cancelled by operator");
      throw new Error("cancelled by operator");
    }
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
    });
    if (stopped !== null) throw new Error(stopped);
    timer = setTimeout(() => {
      timedOut = true;
      stop(`watchdog: ${Math.round(watchdogMs / 1000)}s limit exceeded`);
    }, watchdogMs);
    await restrictArtifactContext(context);
    // A non-secure reserved host keeps service-worker APIs unavailable. The
    // document is always fulfilled locally; no DNS or HTTP request is sent.
    const documentUrl = "http://model-lab-artifact.invalid/document";
    await context.route(
      documentUrl,
      (route) =>
        route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": ARTIFACT_CSP,
            "x-content-type-options": "nosniff",
          },
          body: injectCsp(html),
        }),
      { times: 1 },
    );
    const page = await context.newPage();
    context.on("page", (extra) => {
      if (extra !== page) void extra.close().catch(() => undefined);
    });
    // Transpilers (tsx/esbuild keepNames) wrap functions passed to
    // page.evaluate in a __name(...) helper the page doesn't define — provide
    // it so serialized check functions run under any build toolchain.
    await page.addInitScript({
      content: "globalThis.__name = (target, _name) => target;",
    });
    const t0 = Date.now();
    let errorCount = 0;
    let recentError = "error";
    let diagnosticCount = 0;
    let diagnosticBytes = 0;
    const diagnostic = (level: ConsoleLine["level"], message: string): void => {
      if (stopped !== null) return;
      diagnosticCount += 1;
      diagnosticBytes += Buffer.byteLength(message);
      if (level === "error") {
        errorCount += 1;
        recentError = truncateDiagnostic(message);
      }
      pushConsole(consoleLines, t0, level, message);
      if (
        diagnosticCount >= BROWSER_DIAGNOSTIC_LIMITS.events ||
        diagnosticBytes >= BROWSER_DIAGNOSTIC_LIMITS.receivedBytes
      ) {
        stop(`diagnostic limit exceeded (${diagnosticCount} events, ${diagnosticBytes} bytes)`);
      }
    };
    page.on("pageerror", (err) => {
      diagnostic("error", err.message);
    });
    page.on("console", (msg) => {
      const kind = msg.type();
      if (kind === "error") {
        diagnostic("error", msg.text());
      } else if (kind === "warning") {
        diagnostic("warn", msg.text());
      } else {
        diagnostic("info", msg.text());
      }
    });
    const totalErrors = (): number => errorCount;
    const lastError = (): string => recentError;

    const record = (
      name: BrowserCheckName,
      status: CheckStatus,
      note: string,
      ms: number,
    ): void => {
      results.push(result(name, status, note, ms));
    };

    // ---- load ------------------------------------------------------------
    const loadStart = Date.now();
    let loaded = false;
    let loadError = "";
    try {
      await page.goto(documentUrl, { waitUntil: "load", timeout: 5_000 });
      loaded = true;
    } catch (err) {
      loadError = errorMessage(err);
    }
    const loadMs = Date.now() - loadStart;

    // 1. html.parses (GATE)
    if (loaded) {
      const okDoc = await page.evaluate(
        () => document.documentElement !== null && document.body !== null,
      );
      record(
        "html.parses",
        okDoc ? "passed" : "failed",
        okDoc ? "valid document" : "no document element",
        loadMs,
      );
    } else {
      const staticOk = /<!doctype\s+html|<html[\s>]/i.test(html);
      record(
        "html.parses",
        staticOk ? "passed" : "failed",
        staticOk ? "parsed statically (page load failed)" : "not a parsable HTML document",
        loadMs,
      );
    }

    // 2. page.loads (GATE, <5s)
    if (loaded && loadMs < 5_000) {
      record("page.loads", "passed", `${(loadMs / 1000).toFixed(1)}s < 5s limit`, loadMs);
    } else {
      record(
        "page.loads",
        "failed",
        loaded ? `${(loadMs / 1000).toFixed(1)}s ≥ 5s limit` : loadError.slice(0, 160),
        loadMs,
      );
    }
    if (!loaded) {
      fillMissing(results, "skipped", "skipped (page load failed)");
      return outcome();
    }

    await page.waitForTimeout(300);

    // 3. console.clean (GATE)
    // A console error zeroes the headline score in run.ts, but it does NOT
    // short-circuit the run: an artifact that throws once and still renders is
    // worth measuring, and the trace stays useful to a human.
    {
      const start = Date.now();
      const errs = totalErrors();
      record(
        "console.clean",
        errs === 0 ? "passed" : "failed",
        errs === 0 ? "no errors" : lastError().slice(0, 160),
        Date.now() - start,
      );
    }

    // ---- one capture, shared by canvas.renders / minimap / textures -------
    // The canvas's OWN bitmap: a uniform bitmap means nothing was drawn, even
    // when the composited screenshot shows a start screen / HUD painted over
    // it. This signal can only ADD a failure — an artifact that lied here
    // would still have to clear the screenshot-based structure test below.
    const canvasProbeStart = Date.now();
    const info = await page.evaluate(async () => {
      const cv = document.querySelector("canvas");
      if (cv === null) return { found: false, blank: true, changed: false };
      const snap = (): string => {
        try {
          return cv.toDataURL();
        } catch {
          return "";
        }
      };
      const a = snap();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const b = snap();
      let blank = true;
      try {
        const c2d = cv.getContext("2d");
        if (c2d !== null && cv.width > 0 && cv.height > 0) {
          const d = c2d.getImageData(0, 0, cv.width, cv.height).data;
          const r0 = d[0];
          const g0 = d[1];
          const b0 = d[2];
          const a0 = d[3];
          // Fixed-step sampling can alias a repeating texture and report it
          // blank (e.g. 10px stripes at a 460px sample stride). The bitmap is
          // already in memory; stop at the first differing pixel instead.
          for (let i = 4; i < d.length; i += 4) {
            if (d[i] !== r0 || d[i + 1] !== g0 || d[i + 2] !== b0 || d[i + 3] !== a0) {
              blank = false;
              break;
            }
          }
        } else {
          // non-2d (WebGL) canvas: approximate via dataURL entropy
          blank = a.length < 2000;
        }
      } catch {
        blank = a.length < 2000;
      }
      return { found: true, blank, changed: a !== "" && a !== b };
    });
    const canvasProbeMs = Date.now() - canvasProbeStart;

    // screenshot.captured (DIAGNOSTIC) — captured here so canvas.renders can
    // read the same pixels; recorded under its own name and duration.
    const shotStart = Date.now();
    let frame: Frame | null = null;
    /**
     * Why there is no frame, when there is no frame. This string is the whole
     * reason the pixel checks can distinguish "we looked and it was empty"
     * from "we could not look" — never let it go unset while frame is null.
     */
    let frameIssue: string | null = "frame never captured";
    try {
      const buf = await page.screenshot({ timeout: 5_000 });
      await writeFile(opts.screenshotPath, buf, { flag: "wx" });
      screenshotSaved = true;
      const kb = Math.round(buf.byteLength / 1024);
      if (buf.byteLength > 1024) {
        record("screenshot.captured", "passed", `1280×720 · ${kb}kb`, Date.now() - shotStart);
      } else {
        record(
          "screenshot.captured",
          "warn",
          `suspiciously small (${kb}kb)`,
          Date.now() - shotStart,
        );
      }
      try {
        // Private until every deferred region measurement has finished.
        analyzerContext = await browser.newContext({ serviceWorkers: "block" });
        if (stopped !== null) throw new Error(stopped);
        await restrictArtifactContext(analyzerContext);
        const analyzer = await createAnalyzer(analyzerContext);
        const analyzed = await analyzeFrame(page, analyzer, buf);
        frame = analyzed.frame;
        frameIssue = analyzed.issue;
      } catch (err) {
        // Analysis is best-effort, but a broken analyzer is REPORTED, not
        // silently downgraded to a pass — see unmeasuredGates().
        frame = null;
        frameIssue = `frame analysis error: ${errorMessage(err).slice(0, 120)}`;
      }
    } catch (err) {
      record(
        "screenshot.captured",
        "failed",
        errorMessage(err).slice(0, 160),
        Date.now() - shotStart,
      );
      frameIssue = `screenshot failed: ${errorMessage(err).slice(0, 120)}`;
    }
    /** "we could not look, because …" — only ever read when frame === null. */
    const notMeasured = frameIssue ?? "reason unknown";

    // 4. canvas.renders (GATE) — is there a scene, or only a gradient?
    {
      const m = frame?.metrics ?? null;
      const flat =
        m !== null &&
        m.columns > 0 &&
        m.columnVariance < T.columnVarianceMin &&
        m.localDetail < T.localDetailMin;
      const evidence =
        m === null
          ? ""
          : `(column σ ${m.columnVariance.toFixed(1)}, detail ${m.localDetail.toFixed(1)})`;
      if (!info.found) {
        record("canvas.renders", "failed", "no canvas element", canvasProbeMs);
      } else if (info.blank) {
        record(
          "canvas.renders",
          "failed",
          "blank frame — nothing drawn to the canvas",
          canvasProbeMs,
        );
      } else if (m !== null && (m.distinctColors <= 1 || m.uniformity >= T.blankUniformityMax)) {
        record(
          "canvas.renders",
          "failed",
          `blank frame — ${m.distinctColors} distinct colour${m.distinctColors === 1 ? "" : "s"}`,
          canvasProbeMs,
        );
      } else if (flat) {
        record(
          "canvas.renders",
          "failed",
          `no vertical structure — gradient only ${evidence}`,
          canvasProbeMs,
        );
      } else if (m === null) {
        /**
         * FAIL-CLOSED. This used to record "passed (pixels not measurable)",
         * which meant that the moment frame analysis broke — as it did under
         * every keepNames toolchain, see ANALYZER_NAME_SHIM — every artifact
         * that drew a gradient and nothing else cleared the render gate. An
         * unmeasurable frame is not evidence of a render; it is the absence of
         * evidence, so the gate does not pass. It is "warn", not "failed",
         * because the artifact has not been shown to be broken either: the
         * run scores it as noSignal (null), not as a zero.
         */
        record(
          "canvas.renders",
          "warn",
          `MEASUREMENT FAILED — ${notMeasured}; cannot confirm anything was rendered` +
            `${info.changed ? " (the canvas bitmap did change between samples)" : ""}`,
          canvasProbeMs,
        );
      } else {
        record(
          "canvas.renders",
          "passed",
          `${info.changed ? "frame delta confirmed" : "static frame"} · vertical structure ${evidence}`,
          canvasProbeMs,
        );
      }
    }

    // A frame with nothing in it makes every capability question meaningless —
    // record them "skipped" rather than letting them accrue passes.
    // Only a *failed* gate short-circuits: a warn gate means we don't know what
    // the frame held, so the remaining checks still run and report what they
    // can. Their passes cannot be mistaken for a clean result, because an
    // unresolved gate makes the whole sample noSignal (score null) in run.ts.
    const renderGate = results.find((r) => r.name === "canvas.renders");
    if (renderGate !== undefined && renderGate.status === "failed") {
      fillMissing(results, "skipped", "skipped (canvas.renders gate failed)");
      return outcome();
    }

    // 5. interaction.wasd (CAPABILITY)
    //
    // One key at a time, comparing the frame after each. Pressing w-a-s-d back
    // to back and comparing only at the end let opposite keys cancel out: a
    // build that moved forward for w and back for s could land on the exact
    // starting frame, and how many rAF ticks each hold spanned depended on
    // machine load — so a working build scored "no visible state change" on a
    // busy runner and "movement responds" on an idle one. Any key that changes
    // the frame is proof of a responding build; a wall in front of the player
    // blocking w is why the others still get their turn.
    {
      const start = Date.now();
      const errsBefore = totalErrors();
      const before = await canvasSnapshot(page);
      let changed = false;
      let respondedTo = "";
      for (const key of ["w", "d", "a", "s"]) {
        await page.keyboard.down(key);
        await page.waitForTimeout(160);
        await page.keyboard.up(key);
        await page.waitForTimeout(120);
        if (totalErrors() > errsBefore) break;
        const now = await canvasSnapshot(page);
        if (before !== "" && now !== before) {
          changed = true;
          respondedTo = key;
          break;
        }
      }
      const ms = Date.now() - start;
      if (totalErrors() > errsBefore) {
        record(
          "interaction.wasd",
          "failed",
          `error during input: ${lastError().slice(0, 120)}`,
          ms,
        );
      } else if (changed) {
        record(
          "interaction.wasd",
          "passed",
          `movement responds (frame changed on "${respondedTo}")`,
          ms,
        );
      } else {
        record(
          "interaction.wasd",
          "warn",
          "no crash; no visible state change after w, d, a, s",
          ms,
        );
      }
    }

    // 6. interaction.mouse (CAPABILITY)
    {
      const start = Date.now();
      const errsBefore = totalErrors();
      await page.mouse.move(400, 300);
      await page.mouse.move(700, 380, { steps: 5 });
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(150);
      const ms = Date.now() - start;
      if (totalErrors() > errsBefore) {
        record(
          "interaction.mouse",
          "failed",
          `error during input: ${lastError().slice(0, 120)}`,
          ms,
        );
      } else {
        record("interaction.mouse", "passed", "no errors on mouse input", ms);
      }
    }

    // 7. minimap.present (CAPABILITY) — located AND actually drawn
    {
      const start = Date.now();
      const located =
        frame !== null
          ? frame.probe.minimap
          : (await page.evaluate(PROBE_DOM, { overlayMaxCoverage: T.overlayMaxCoverage })).minimap;
      if (located === null) {
        record("minimap.present", "failed", "no minimap element detected", Date.now() - start);
      } else if (frame === null) {
        // Located in the DOM, contents unknown — an element is not a minimap.
        record(
          "minimap.present",
          "warn",
          `detected (${located.how}) but MEASUREMENT FAILED — ${notMeasured}; contents unverified`,
          Date.now() - start,
        );
      } else {
        // located is already the padding box; 1px more absorbs antialiasing
        const inset = Math.min(1, Math.floor(Math.min(located.w, located.h) / 8));
        const m = await frame.measure(
          {
            x: located.x + inset,
            y: located.y + inset,
            w: located.w - inset * 2,
            h: located.h - inset * 2,
          },
          [],
        );
        const ms = Date.now() - start;
        if (m === null) {
          record(
            "minimap.present",
            "warn",
            `detected (${located.how}) but MEASUREMENT FAILED — region ${Math.round(located.w)}×${Math.round(located.h)}px is too small to sample; contents unverified`,
            ms,
          );
        } else if (
          m.distinctColors < T.minimapDistinctColorsMin ||
          m.uniformity > T.minimapUniformityMax
        ) {
          record(
            "minimap.present",
            "failed",
            `element present but renders nothing (${m.distinctColors} distinct colour${m.distinctColors === 1 ? "" : "s"}, ${Math.round(m.uniformity * 100)}% one tone)`,
            ms,
          );
        } else {
          record(
            "minimap.present",
            "passed",
            `detected (${located.how}) · ${m.distinctColors} distinct colours drawn`,
            ms,
          );
        }
      }
    }

    // 8. textures.applied (CAPABILITY) — surface detail inside the wall region
    {
      const start = Date.now();
      const m = frame?.metrics ?? null;
      const ms = Date.now() - start;
      if (m === null) {
        // could not look
        record(
          "textures.applied",
          "warn",
          `MEASUREMENT FAILED — ${notMeasured}; surface detail unverified`,
          ms,
        );
      } else if (m.columns === 0) {
        // looked, but every column of the wall band was masked out
        record(
          "textures.applied",
          "warn",
          "frame measured but no column of the wall band was samplable (fully covered by overlays) — surface detail unknown",
          ms,
        );
      } else {
        const pct = (m.wallDetail * 100).toFixed(1);
        if (m.wallDetail >= T.wallDetailMin) {
          record(
            "textures.applied",
            "passed",
            `surface detail in the wall region (${pct}% edge pixels)`,
            ms,
          );
        } else if (m.wallDetail >= T.wallDetailWarn) {
          record(
            "textures.applied",
            "warn",
            `flat shading — only ${pct}% edge pixels in the wall region`,
            ms,
          );
        } else {
          record(
            "textures.applied",
            "failed",
            `no surface detail — ${pct}% edge pixels in the wall region (gradient or flat fill)`,
            ms,
          );
        }
      }
    }

    // 9. fps.stable (DIAGNOSTIC) — rAF sampling over ~700ms
    {
      const start = Date.now();
      const fps = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const begin = performance.now();
            const tick = (): void => {
              frames += 1;
              const elapsed = performance.now() - begin;
              if (elapsed < 700) requestAnimationFrame(tick);
              else resolve(Math.round(frames / (elapsed / 1000)));
            };
            requestAnimationFrame(tick);
          }),
      );
      const ms = Date.now() - start;
      if (fps > 30) record("fps.stable", "passed", `${fps}fps sustained`, ms);
      else if (fps >= 15) record("fps.stable", "warn", `${fps}fps — below 30fps target`, ms);
      else record("fps.stable", "failed", `${fps}fps`, ms);
    }

    // 10. resize.handled (CAPABILITY)
    {
      const start = Date.now();
      const errsBefore = totalErrors();
      await page.setViewportSize({ width: 720, height: 480 });
      await page.waitForTimeout(250);
      const alive = await page.evaluate(() => document.body !== null);
      const ms = Date.now() - start;
      if (totalErrors() > errsBefore) {
        record("resize.handled", "failed", `error on resize: ${lastError().slice(0, 120)}`, ms);
      } else if (!alive) {
        record("resize.handled", "failed", "document unavailable after resize", ms);
      } else {
        record("resize.handled", "passed", "viewport resize ok", ms);
      }
    }

    // 11. a11y.contrast (DIAGNOSTIC) — basic text contrast sample
    {
      const start = Date.now();
      const ratio = await page.evaluate(() => {
        const lum = (r: number, g: number, b: number): number => {
          const f = (v: number): number => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const parse = (c: string): { r: number; g: number; b: number; a: number } | null => {
          const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
          if (m === null) return null;
          return {
            r: Number(m[1] ?? 0),
            g: Number(m[2] ?? 0),
            b: Number(m[3] ?? 0),
            a: m[4] === undefined ? 1 : Number(m[4]),
          };
        };
        const els = Array.from(document.querySelectorAll("body *"))
          .filter((el) => {
            const hasText = Array.from(el.childNodes).some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
            );
            return hasText && (el as HTMLElement).offsetWidth > 0;
          })
          .slice(0, 20);
        if (els.length === 0) return null;
        let min = 21;
        for (const el of els) {
          const fg = parse(getComputedStyle(el).color);
          if (fg === null) continue;
          let bg: { r: number; g: number; b: number; a: number } | null = null;
          let p: Element | null = el;
          while (p !== null && p !== document.documentElement) {
            const c = parse(getComputedStyle(p).backgroundColor);
            if (c !== null && c.a > 0.5) {
              bg = c;
              break;
            }
            p = p.parentElement;
          }
          if (bg === null) bg = { r: 0, g: 0, b: 0, a: 1 };
          const l1 = lum(fg.r, fg.g, fg.b);
          const l2 = lum(bg.r, bg.g, bg.b);
          const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (r < min) min = r;
        }
        return min;
      });
      const ms = Date.now() - start;
      if (ratio === null) record("a11y.contrast", "warn", "no text content to sample", ms);
      else if (ratio >= 4.5)
        record("a11y.contrast", "passed", `min contrast ${ratio.toFixed(1)}:1`, ms);
      else if (ratio >= 3)
        record("a11y.contrast", "warn", `min contrast ${ratio.toFixed(1)}:1 (< 4.5:1)`, ms);
      else record("a11y.contrast", "failed", `min contrast ${ratio.toFixed(1)}:1`, ms);
    }
  } catch (err) {
    if (stopped !== null || timedOut) {
      fillMissing(
        results,
        "failed",
        stopped ?? `watchdog: ${Math.round(watchdogMs / 1000)}s limit exceeded`,
      );
    } else {
      fillMissing(results, "skipped", `check runner error: ${errorMessage(err).slice(0, 160)}`);
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    if (context !== null) await context.close().catch(() => undefined);
    if (analyzerContext !== null) await analyzerContext.close().catch(() => undefined);
    await releaseBrowser(lease);
  }

  fillMissing(results, "skipped", "not executed");
  return outcome();
}
