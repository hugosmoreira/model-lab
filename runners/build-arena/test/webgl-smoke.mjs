/** Synthetic graphics compatibility gate for native dependency/image changes. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register("./ts-resolve.mjs", import.meta.url);
const { runBrowserChecks, closeBrowserChecks } = await import("../src/checks/browser-checks.ts");

const html = `<!doctype html><html><body style="margin:0">
<canvas width="800" height="600"></canvas><script>
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
if (!gl) throw Error('WebGL context unavailable');
function shader(type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source); gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw Error('Shader compilation failed');
  return result;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER,
  'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }'));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER,
  'precision mediump float; void main() { float c = mod(floor(gl_FragCoord.x / 40.0) + floor(gl_FragCoord.y / 40.0), 2.0); gl_FragColor = vec4(c, 1.0-c, 0.25, 1.0); }'));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Shader linking failed');
gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const attribute = gl.getAttribLocation(program, 'position');
gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
function draw() { gl.drawArrays(gl.TRIANGLES, 0, 6); requestAnimationFrame(draw); }
draw();
const first = new Uint8Array(4), second = new Uint8Array(4);
gl.readPixels(20, 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, first);
gl.readPixels(60, 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, second);
if (gl.getError() !== gl.NO_ERROR || first[1] < 240 || second[0] < 240 || first[0] > 10 || second[1] > 10) {
  throw Error('WebGL shader did not produce the expected distinct pixels');
}
console.log('WEBGL_CONTROL=' + JSON.stringify({
  vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
  version: gl.getParameter(gl.VERSION), first: Array.from(first), second: Array.from(second)
}));
</script></body></html>`;

const directory = await mkdtemp(join(tmpdir(), "model-lab-webgl-"));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
try {
  const screenshot = join(directory, "webgl.png");
  const result = await runBrowserChecks(html, { screenshotPath: screenshot });
  assert.equal(result.degraded, false, "Browser execution must not be skipped");
  assert.equal(result.screenshotSaved, true, "WebGL screenshot capture must succeed");
  assert.ok((await readFile(screenshot)).subarray(0, 8).equals(pngSignature));
  const control = result.consoleLines.find((line) => line.msg.startsWith("WEBGL_CONTROL="));
  assert.ok(control, "The real shader/pixel control must finish inside the restricted runner");
  const graphics = JSON.parse(control.msg.slice("WEBGL_CONTROL=".length));
  assert.deepEqual(graphics.first, [0, 255, 64, 255]);
  assert.deepEqual(graphics.second, [255, 0, 64, 255]);

  // A fresh artifact still renders after the graphics context is disposed.
  const followup = await runBrowserChecks(
    '<!doctype html><canvas width="800" height="600"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="blue";c.fillRect(0,0,800,600);console.log("FOLLOWUP_2D_OK");</script>',
    { screenshotPath: join(directory, "followup.png") },
  );
  assert.equal(followup.degraded, false);
  assert.equal(followup.screenshotSaved, true);
  assert.ok(followup.consoleLines.some((line) => line.msg === "FOLLOWUP_2D_OK"));
  console.log(JSON.stringify({ status: "passed", graphics, followup2d: "passed" }));
} finally {
  await closeBrowserChecks();
  await rm(directory, { recursive: true, force: true });
}
