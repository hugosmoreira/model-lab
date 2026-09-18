/**
 * Controlled loopback traps only: no provider or public Internet traffic.
 * Run: node --experimental-strip-types --disable-warning=ExperimentalWarning
 *      --test test/browser-boundaries.test.mjs
 */
/* global Image, window, document, RTCPeerConnection */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { register } from "node:module";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createSocket } from "node:dgram";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

register("./ts-resolve.mjs", import.meta.url);
const {
  ARTIFACT_CSP,
  BROWSER_DIAGNOSTIC_LIMITS,
  closeBrowserChecks,
  injectCsp,
  launchArtifactBrowser,
  restrictArtifactContext,
  runBrowserChecks,
} = await import("../src/checks/browser-checks.ts");
const { artifactBrowserExecutable, BROWSER_RUNTIME, supportedBrowserVersion } =
  await import("../src/checks/browser-runtime.ts");

let browser;
let server;
let origin;
let directory;
let walls;
let empty;
const received = [];
let artifactNumber = 0;
const shot = () => path.join(directory, `artifact-${++artifactNumber}.png`);
const gate = (outcome, name) => outcome.checks.find((entry) => entry.name === name);

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "model-lab-browser-boundaries-"));
  walls = await readFile(new URL("./fixtures/renders-walls.html", import.meta.url), "utf8");
  empty = await readFile(new URL("./fixtures/renders-nothing.html", import.meta.url), "utf8");
  server = createServer((request, response) => {
    received.push(request.url);
    response.end("network trap");
  });
  server.on("upgrade", (request, socket) => {
    received.push(request.url);
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: artifactBrowserExecutable() });
  assert.equal(supportedBrowserVersion(browser.version()), true);
});

after(async () => {
  await closeBrowserChecks();
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("browser version gate rejects vulnerable and unrecognized runtimes before artifact execution", () => {
  for (const version of [
    "151.0.7922.34",
    "153.0.8010.12",
    "153.0.8010.47",
    "unknown",
    "153.0.8010",
  ]) {
    assert.equal(supportedBrowserVersion(version), false);
  }
  assert.equal(supportedBrowserVersion(BROWSER_RUNTIME.version), true);
  assert.equal(supportedBrowserVersion("153.0.8010.53"), true);
});

test("context controls stop HTTP, popup first requests, navigation, sockets and workers independently of CSP", async () => {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  const attempted = [];
  context.on("request", (request) => attempted.push(request.url()));
  try {
    await restrictArtifactContext(context);
    // The bootstrap is locally fulfilled, including on loopback. The trap
    // listener must not receive even this request.
    await context.route(
      `${origin}/bootstrap`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><body>synthetic test</body>",
        }),
      { times: 1 },
    );
    const page = await context.newPage();
    await page.goto(`${origin}/bootstrap`);
    const socketClosed = await page.evaluate(async (base) => {
      void fetch(base + "/fetch").catch(() => {});
      const image = new Image();
      image.src = base + "/image";
      document.body.appendChild(image);
      window.open(base + "/popup", "_blank");
      void navigator.serviceWorker.register(base + "/worker.js").catch(() => {});
      const ws = new WebSocket(base.replace("http:", "ws:") + "/socket");
      return new Promise((resolve) => {
        ws.onclose = () => resolve(true);
        ws.onerror = () => resolve(true);
        setTimeout(() => resolve(ws.readyState >= 2), 500);
      });
    }, origin);
    assert.equal(socketClosed, true);
    await page.goto(`${origin}/navigation`).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const suffix of ["/fetch", "/image", "/popup", "/navigation"]) {
      assert.ok(
        attempted.some((url) => url.endsWith(suffix)),
        `attempted ${suffix}`,
      );
    }
    assert.deepEqual(received, [], "loopback HTTP and WebSocket traps remain silent");
    assert.equal(context.serviceWorkers().length, 0);
  } finally {
    await context.close();
  }
});

test("trusted prefix and header policy survive comment and attribute head tricks with an opaque origin", async () => {
  const source = `<!-- <head> --> <!doctype html><html data-decoy="<head>">
  <head><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'"></head>
  <body><canvas width="20" height="20"></canvas><script>
  console.log("OPAQUE:" + String(globalThis.origin));
  try { localStorage.setItem("artifact-secret", "x"); console.log("STORAGE:allowed"); }
  catch { console.log("STORAGE:blocked"); }
  void fetch("${origin}/comment").catch(() => {});
  new Image().src = "${origin}/attribute";
  try { new WebSocket("${origin.replace("http:", "ws:")}/artifact-socket"); } catch {}
  window.open("${origin}/artifact-popup");
  const f = document.createElement("iframe"); f.src="${origin}/frame"; document.body.appendChild(f);
  try { navigator.sendBeacon("${origin}/beacon", "x"); } catch {}
  document.querySelector("meta").remove();
  void fetch("${origin}/after-meta-removal").catch(() => {});
  </script></body></html>`;
  assert.ok(
    injectCsp(source).startsWith(
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy"',
    ),
  );
  assert.ok(injectCsp(source).indexOf("default-src") < injectCsp(source).indexOf("<!--"));
  assert.match(ARTIFACT_CSP, /sandbox allow-scripts allow-pointer-lock/);
  const result = await runBrowserChecks(source, { screenshotPath: shot(), watchdogMs: 8_000 });
  assert.equal(result.degraded, false);
  assert.ok(result.consoleLines.some((line) => line.msg === "OPAQUE:null"));
  assert.ok(result.consoleLines.some((line) => line.msg === "STORAGE:blocked"));
  assert.deepEqual(received, []);
});

test("self-navigation cannot send a request to the loopback trap", async () => {
  const result = await runBrowserChecks(
    `<!doctype html><script>
    console.log("NAVIGATION:attempted");
    location.href = "${origin}/self-navigation";
    </script>`,
    { screenshotPath: shot(), watchdogMs: 8_000 },
  );
  assert.equal(result.degraded, false);
  assert.ok(result.consoleLines.some((line) => line.msg === "NAVIGATION:attempted"));
  assert.deepEqual(received, []);
});

test("error storms stop execution with bounded UTF-8 diagnostics and permit a later artifact", async () => {
  const begin = Date.now();
  const result = await runBrowserChecks(
    `<!doctype html><script>
    for (let i=0; i<100000; i++) console.error("🙂".repeat(500));
    </script>`,
    { screenshotPath: shot(), watchdogMs: 8_000 },
  );
  assert.equal(result.degraded, false);
  assert.equal(gate(result, "console.clean").status, "failed");
  assert.match(gate(result, "console.clean").note, /diagnostic limit exceeded/);
  assert.ok(result.consoleLines.length <= BROWSER_DIAGNOSTIC_LIMITS.lines);
  assert.ok(
    result.consoleLines.every(
      (line) => Buffer.byteLength(line.msg) <= BROWSER_DIAGNOSTIC_LIMITS.lineBytes,
    ),
  );
  assert.ok(Date.now() - begin < 8_000);
  const next = await runBrowserChecks(walls, { screenshotPath: shot() });
  assert.equal(gate(next, "console.clean").status, "passed");
  assert.equal(gate(next, "canvas.renders").status, "passed");
});

test("overlapping artifacts keep their measurements and survive another run's cleanup", async () => {
  for (let iteration = 0; iteration < 2; iteration++) {
    const working = runBrowserChecks(walls, { screenshotPath: shot() });
    const broken = runBrowserChecks(empty, { screenshotPath: shot() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await closeBrowserChecks();
    const [good, bad] = await Promise.all([working, broken]);
    assert.equal(gate(good, "canvas.renders").status, "passed");
    assert.equal(gate(good, "textures.applied").status, "passed");
    assert.equal(gate(bad, "canvas.renders").status, "failed");
    assert.match(gate(bad, "canvas.renders").note, /no vertical structure/);
    assert.equal(good.screenshotSaved, true);
    assert.equal(bad.screenshotSaved, true);
  }
});

test("cancellation closes an executing context and leaves later work usable", async () => {
  const controller = new AbortController();
  const begin = Date.now();
  const pending = runBrowserChecks("<!doctype html><script>while(true) {}</script>", {
    screenshotPath: shot(),
    watchdogMs: 8_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 200);
  const cancelled = await pending;
  assert.equal(gate(cancelled, "console.clean").status, "failed");
  assert.match(gate(cancelled, "console.clean").note, /cancelled by operator/);
  assert.ok(Date.now() - begin < 5_000);
  const next = await runBrowserChecks(walls, { screenshotPath: shot() });
  assert.equal(gate(next, "canvas.renders").status, "passed");
});

test("late minimap measurements use their own captured frames during concurrent input checks", async () => {
  const scene = (drawMap, paintScene = true) => `<!doctype html><style>body {margin:0}</style>
    <canvas id="view" width="1280" height="720"></canvas>
    <canvas id="minimap" width="100" height="100" style="position:fixed;top:10px;right:10px"></canvas>
    <script>
    const g=document.querySelector("#view").getContext("2d");
    // 10px stripes used to alias the blank probe's 460px sampling stride.
    for(let x=0;x<1280;x+=10){g.fillStyle=${paintScene} && x%20===0?"#111":"#ccc";g.fillRect(x,0,10,720);}
    const m=document.querySelector("#minimap").getContext("2d");
    m.fillStyle="#000";m.fillRect(0,0,100,100);
    if(${drawMap}) {m.fillStyle="#fff";m.fillRect(0,0,50,100);}
    </script>`;
  const [drawn, blank, uniform] = await Promise.all([
    runBrowserChecks(scene(true), { screenshotPath: shot() }),
    runBrowserChecks(scene(false), { screenshotPath: shot() }),
    runBrowserChecks(scene(true, false), { screenshotPath: shot() }),
  ]);
  assert.equal(gate(drawn, "canvas.renders").status, "passed", gate(drawn, "canvas.renders").note);
  assert.equal(gate(blank, "canvas.renders").status, "passed", gate(blank, "canvas.renders").note);
  assert.equal(gate(drawn, "minimap.present").status, "passed");
  assert.equal(gate(blank, "minimap.present").status, "failed");
  assert.equal(gate(uniform, "canvas.renders").status, "failed");
  assert.match(gate(uniform, "canvas.renders").note, /blank frame/);
});

test("captures cannot replace an existing evidence file", async () => {
  const screenshotPath = shot();
  const first = await runBrowserChecks(walls, { screenshotPath });
  assert.equal(first.screenshotSaved, true);
  const original = await readFile(screenshotPath);
  const second = await runBrowserChecks(empty, { screenshotPath });
  assert.equal(second.screenshotSaved, false);
  assert.equal(gate(second, "screenshot.captured").status, "failed");
  assert.deepEqual(await readFile(screenshotPath), original);
});

test("native WebRTC policy and deny proxy block UDP and TURN TCP in pages, popups and frames", async () => {
  const udp = createSocket("udp4");
  let udpPackets = 0;
  let tcpConnections = 0;
  udp.on("message", () => udpPackets++);
  await new Promise((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const tcp = createTcpServer((socket) => {
    tcpConnections++;
    socket.destroy();
  });
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const targets = { udpPort: udp.address().port, tcpPort: tcp.address().port };
  const startRtc = async ({ udpPort, tcpPort }) => {
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: `stun:127.0.0.1:${udpPort}` },
        {
          urls: `turn:127.0.0.1:${tcpPort}?transport=tcp`,
          username: "synthetic",
          credential: "synthetic",
        },
      ],
    });
    // Keep the object alive until the context is closed.
    globalThis.syntheticRtcConnection = connection;
    connection.createDataChannel("synthetic");
    await connection.setLocalDescription(await connection.createOffer());
    return true;
  };
  let protectedBrowser;
  try {
    // Positive control uses the exact response CSP and Playwright routes:
    // neither controls WebRTC's native sockets on an ordinary launch.
    const controlContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      await restrictArtifactContext(controlContext);
      await controlContext.route(
        "http://rtc-control.invalid/",
        (route) =>
          route.fulfill({
            headers: { "content-security-policy": ARTIFACT_CSP, "content-type": "text/html" },
            body: injectCsp("<!doctype html><body>synthetic WebRTC control</body>"),
          }),
        { times: 1 },
      );
      const control = await controlContext.newPage();
      await control.goto("http://rtc-control.invalid/");
      assert.equal(await control.evaluate(startRtc, targets), true);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      assert.ok(udpPackets > 0, "unhardened control reaches the UDP trap");
      assert.ok(tcpConnections > 0, "unhardened control reaches the TCP trap");
    } finally {
      await controlContext.close();
    }
    udpPackets = 0;
    tcpConnections = 0;

    protectedBrowser = await launchArtifactBrowser();
    const context = await protectedBrowser.newContext({ serviceWorkers: "block" });
    await restrictArtifactContext(context);
    const page = await context.newPage();
    // Deliberately omit CSP in these realms: native restrictions must also
    // cover fresh constructors obtained from a popup or an about:blank frame.
    await page.setContent('<iframe src="about:blank"></iframe>');
    assert.equal(await page.evaluate(startRtc, targets), true);
    const frame = page.frames().find((entry) => entry !== page.mainFrame());
    assert.ok(frame);
    assert.equal(await frame.evaluate(startRtc, targets), true);
    const opened = context.waitForEvent("page");
    await page.evaluate(() => window.open("about:blank"));
    const popup = await opened;
    assert.equal(await popup.evaluate(startRtc, targets), true);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    assert.equal(udpPackets, 0);
    assert.equal(tcpConnections, 0);
    await context.close();

    // Exercise the actual runner, not only the exported launch helper.
    const injected =
      walls +
      `<script>(${startRtc.toString()})(${JSON.stringify(targets)})
      .then(() => console.log("RTC:attempted"));</script>`;
    const result = await runBrowserChecks(injected, { screenshotPath: shot() });
    assert.equal(result.degraded, false);
    assert.ok(result.consoleLines.some((line) => line.msg === "RTC:attempted"));
    assert.equal(gate(result, "canvas.renders").status, "passed");
    assert.equal(udpPackets, 0);
    assert.equal(tcpConnections, 0);
  } finally {
    await protectedBrowser?.close();
    udp.close();
    await new Promise((resolve) => tcp.close(resolve));
  }
});
