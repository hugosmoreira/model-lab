/**
 * Playwright chromium implementation of the 12 named browser checks.
 *
 * Sandbox posture (audit §11 H-1/H-2): artifact loaded via setContent with an
 * injected CSP meta (default-src 'none'; script-src 'unsafe-inline';
 * style-src 'unsafe-inline'; img-src data:) plus route-abort on ALL network
 * requests; 30s watchdog per artifact.
 *
 * Graceful degradation: if the chromium browser cannot launch (not installed),
 * every check returns status "skipped" with an install hint — the run never
 * crashes.
 */
import type { BrowserTestResult, ConsoleLine } from "@model-lab/schemas";
import type { Browser, BrowserContext, Page } from "playwright";
import { errorMessage } from "../providers/util";

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

export const BROWSER_NOT_INSTALLED_NOTE =
  "browser not installed — run npx playwright install chromium";

const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">`;

export interface BrowserChecksOptions {
  screenshotPath: string;
  watchdogMs?: number; // default 30_000
}

export interface BrowserChecksOutcome {
  checks: BrowserTestResult[];
  consoleLines: ConsoleLine[];
  screenshotSaved: boolean;
  degraded: boolean; // true when the browser could not be launched
}

let browserPromise: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (browserPromise === null) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import("playwright");
        return await chromium.launch({ headless: true });
      } catch {
        return null;
      }
    })();
  }
  return browserPromise;
}

/** Close the shared chromium instance (call at the end of a run). */
export async function closeBrowserChecks(): Promise<void> {
  if (browserPromise === null) return;
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  if (browser !== null) {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Transpilers (tsx/esbuild keepNames) wrap functions passed to page.evaluate
 * in a __name(...) helper the page doesn't define. addInitScript does NOT fire
 * for setContent documents (document.write, not a navigation), so the helper
 * is injected as an inline <script> next to the CSP meta — 'unsafe-inline'
 * script-src permits it, and it runs before the artifact's own scripts.
 */
const NAME_HELPER = `<script>globalThis.__name = function(t, n) { return t; };</script>`;

/** Inject the sandbox CSP meta (+ eval helper) as the first children of <head>. */
export function injectCsp(html: string): string {
  const inject = `${CSP_META}${NAME_HELPER}`;
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch !== null) {
    const idx = headMatch.index + headMatch[0].length;
    return `${html.slice(0, idx)}${inject}${html.slice(idx)}`;
  }
  const htmlMatch = /<html[^>]*>/i.exec(html);
  if (htmlMatch !== null) {
    const idx = htmlMatch.index + htmlMatch[0].length;
    return `${html.slice(0, idx)}<head>${inject}</head>${html.slice(idx)}`;
  }
  return `<head>${inject}</head>${html}`;
}

type CheckStatus = BrowserTestResult["status"];

function skippedAll(note: string): BrowserTestResult[] {
  return BROWSER_CHECK_NAMES.map((name) => ({
    name,
    status: "skipped" as const,
    note,
    durationMs: null,
  }));
}

function fillMissing(results: BrowserTestResult[], status: CheckStatus, note: string): void {
  const seen = new Set(results.map((r) => r.name));
  for (const name of BROWSER_CHECK_NAMES) {
    if (!seen.has(name)) {
      results.push({ name, status, note, durationMs: null });
    }
  }
}

function pushConsole(
  lines: ConsoleLine[],
  t0: number,
  level: ConsoleLine["level"],
  msg: string,
): void {
  if (lines.length >= 100) return;
  lines.push({
    t: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
    level,
    msg: msg.slice(0, 400),
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

export async function runBrowserChecks(
  html: string,
  opts: BrowserChecksOptions,
): Promise<BrowserChecksOutcome> {
  const browser = await getBrowser();
  if (browser === null) {
    return {
      checks: skippedAll(BROWSER_NOT_INSTALLED_NOTE),
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
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    // Transpilers (tsx/esbuild keepNames) wrap functions passed to
    // page.evaluate in a __name(...) helper the page doesn't define — provide
    // it so serialized check functions run under any build toolchain.
    await page.addInitScript({
      content: "globalThis.__name = (target, _name) => target;",
    });
    // Network blocked: abort every request the artifact attempts.
    await page.route("**/*", (route) => {
      void route.abort();
    });

    const t0 = Date.now();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
      pushConsole(consoleLines, t0, "error", `Uncaught ${err.message}`);
    });
    page.on("console", (msg) => {
      const kind = msg.type();
      if (kind === "error") {
        consoleErrors.push(msg.text());
        pushConsole(consoleLines, t0, "error", msg.text());
      } else if (kind === "warning") {
        pushConsole(consoleLines, t0, "warn", msg.text());
      } else {
        pushConsole(consoleLines, t0, "info", msg.text());
      }
    });
    const totalErrors = (): number => pageErrors.length + consoleErrors.length;
    const lastError = (): string =>
      consoleErrors[consoleErrors.length - 1] ?? pageErrors[pageErrors.length - 1] ?? "error";

    const ctx = context;
    timer = setTimeout(() => {
      timedOut = true;
      void ctx.close().catch(() => undefined);
    }, watchdogMs);

    const record = (name: BrowserCheckName, status: CheckStatus, note: string, ms: number): void => {
      results.push({ name, status, note, durationMs: ms });
    };

    // ---- load ------------------------------------------------------------
    const loadStart = Date.now();
    let loaded = false;
    let loadError = "";
    try {
      await page.setContent(injectCsp(html), { waitUntil: "load", timeout: 5_000 });
      loaded = true;
    } catch (err) {
      loadError = errorMessage(err);
    }
    const loadMs = Date.now() - loadStart;

    // 1. html.parses
    if (loaded) {
      const okDoc = await page.evaluate(
        () => document.documentElement !== null && document.body !== null,
      );
      record("html.parses", okDoc ? "passed" : "failed", okDoc ? "valid document" : "no document element", loadMs);
    } else {
      const staticOk = /<!doctype\s+html|<html[\s>]/i.test(html);
      record(
        "html.parses",
        staticOk ? "passed" : "failed",
        staticOk ? "parsed statically (page load failed)" : "not a parsable HTML document",
        loadMs,
      );
    }

    // 2. page.loads (<5s)
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
      return { checks: results, consoleLines, screenshotSaved, degraded: false };
    }

    await page.waitForTimeout(300);

    // 3. console.clean
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

    // 4. canvas.renders — frame pixels change / canvas non-blank
    {
      const start = Date.now();
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
            const stride = Math.max(4, Math.floor(d.length / 2000 / 4) * 4);
            for (let i = 0; i < d.length; i += stride) {
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
      const ms = Date.now() - start;
      if (!info.found) record("canvas.renders", "failed", "no canvas element", ms);
      else if (info.blank) record("canvas.renders", "failed", "blank frame", ms);
      else if (info.changed) record("canvas.renders", "passed", "frame delta confirmed", ms);
      else record("canvas.renders", "passed", "static frame (non-blank)", ms);
    }

    // 5. interaction.wasd
    {
      const start = Date.now();
      const errsBefore = totalErrors();
      const before = await canvasSnapshot(page);
      for (const key of ["w", "a", "s", "d"]) {
        await page.keyboard.down(key);
        await page.waitForTimeout(60);
        await page.keyboard.up(key);
      }
      await page.waitForTimeout(200);
      const after = await canvasSnapshot(page);
      const ms = Date.now() - start;
      if (totalErrors() > errsBefore) {
        record("interaction.wasd", "failed", `error during input: ${lastError().slice(0, 120)}`, ms);
      } else if (before !== "" && before !== after) {
        record("interaction.wasd", "passed", "movement responds", ms);
      } else {
        record("interaction.wasd", "warn", "no crash; no visible state change", ms);
      }
    }

    // 6. interaction.mouse
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
        record("interaction.mouse", "failed", `error during input: ${lastError().slice(0, 120)}`, ms);
      } else {
        record("interaction.mouse", "passed", "no errors on mouse input", ms);
      }
    }

    // 7. minimap.present
    {
      const start = Date.now();
      const found = await page.evaluate(() => {
        const canvases = document.querySelectorAll("canvas");
        if (canvases.length >= 2) return "second canvas";
        const named = document.querySelector(
          '[id*="minimap" i],[class*="minimap" i],[id*="radar" i],[class*="radar" i]',
        );
        if (named !== null) return "named element";
        const els = Array.from(document.querySelectorAll("div,section,aside,svg"));
        for (const el of els) {
          const cs = getComputedStyle(el);
          if (cs.position === "absolute" || cs.position === "fixed") {
            const r = el.getBoundingClientRect();
            if (
              r.width > 20 &&
              r.width < innerWidth * 0.4 &&
              r.height > 20 &&
              r.height < innerHeight * 0.4
            ) {
              return "positioned overlay";
            }
          }
        }
        return null;
      });
      const ms = Date.now() - start;
      if (found !== null) record("minimap.present", "passed", `detected (${found})`, ms);
      else record("minimap.present", "failed", "no minimap element detected", ms);
    }

    // 8. screenshot.captured
    {
      const start = Date.now();
      try {
        const buf = await page.screenshot({ path: opts.screenshotPath, timeout: 5_000 });
        screenshotSaved = true;
        const kb = Math.round(buf.byteLength / 1024);
        if (buf.byteLength > 1024) {
          record("screenshot.captured", "passed", `1280×720 · ${kb}kb`, Date.now() - start);
        } else {
          record("screenshot.captured", "warn", `suspiciously small (${kb}kb)`, Date.now() - start);
        }
      } catch (err) {
        record("screenshot.captured", "failed", errorMessage(err).slice(0, 160), Date.now() - start);
      }
    }

    // 9. textures.applied — canvas color variance heuristic
    {
      const start = Date.now();
      const distinct = await page.evaluate(() => {
        const cv = document.querySelector("canvas");
        if (cv === null) return 0;
        const c2d = cv.getContext("2d");
        if (c2d === null || cv.width === 0 || cv.height === 0) return -1;
        try {
          const d = c2d.getImageData(0, 0, cv.width, cv.height).data;
          const tones = new Set<number>();
          const stride = Math.max(4, Math.floor(d.length / 4096 / 4) * 4);
          for (let i = 0; i + 2 < d.length; i += stride) {
            const r = d[i] ?? 0;
            const g = d[i + 1] ?? 0;
            const b = d[i + 2] ?? 0;
            tones.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          }
          return tones.size;
        } catch {
          return -1;
        }
      });
      const ms = Date.now() - start;
      if (distinct >= 12) record("textures.applied", "passed", `color variance ok (${distinct} tones)`, ms);
      else if (distinct >= 4) record("textures.applied", "warn", `low variance (${distinct} tones) — flat shading?`, ms);
      else if (distinct === -1) record("textures.applied", "warn", "non-2d canvas — variance not measurable", ms);
      else record("textures.applied", "failed", "flat or blank output", ms);
    }

    // 10. fps.stable — rAF sampling over ~700ms
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

    // 11. resize.handled
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

    // 12. a11y.contrast — basic text contrast sample
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
      else if (ratio >= 4.5) record("a11y.contrast", "passed", `min contrast ${ratio.toFixed(1)}:1`, ms);
      else if (ratio >= 3) record("a11y.contrast", "warn", `min contrast ${ratio.toFixed(1)}:1 (< 4.5:1)`, ms);
      else record("a11y.contrast", "failed", `min contrast ${ratio.toFixed(1)}:1`, ms);
    }
  } catch (err) {
    if (timedOut) {
      fillMissing(results, "failed", `watchdog: ${Math.round((opts.watchdogMs ?? 30_000) / 1000)}s limit exceeded`);
    } else {
      fillMissing(results, "skipped", `check runner error: ${errorMessage(err).slice(0, 160)}`);
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (context !== null) await context.close().catch(() => undefined);
  }

  fillMissing(results, "skipped", "not executed");
  return { checks: results, consoleLines, screenshotSaved, degraded: false };
}
