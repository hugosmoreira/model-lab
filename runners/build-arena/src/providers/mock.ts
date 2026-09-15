/**
 * Deterministic keyless mock provider for E2E tests.
 * Streams a small VALID self-contained raycaster (canvas + WASD listeners +
 * minimap, no network) chunk by chunk with ~40ms delays (~2s total),
 * deterministic per (model, sampleIndex). With injectFailure it emits an
 * artifact with a deliberate null-canvas bug (id mismatch: #view vs #screen)
 * to exercise the sample.failed path.
 *
 * Verified mode (req.task present): echoes the task's expected answer in a
 * scorer-appropriate shape — exact-match verbatim, contains with prose around
 * it, json-field as a fenced JSON object. With req.answerWrong (the executor
 * sets it for the FIRST endpoint's LAST task) it answers deterministically
 * wrong to exercise the 0-score path.
 */
import type { GenerateRequest, Provider, ProviderChunk, Task } from "../types";
import { approxTokens, sleep } from "./util";

export interface MockProviderOptions {
  chunkDelayMs?: number; // default 40
  chunkCount?: number; // default 50 (≈2s total)
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildMockRaycasterHtml(
  model: string,
  sampleIndex: number,
  injectFailure: boolean,
): string {
  const seed = hashSeed(`${model}#${sampleIndex}`);
  const hue = seed % 360;
  const canvasId = injectFailure ? "view" : "screen";
  const bugComment = injectFailure
    ? '\n// BUG (deliberate): the canvas id is "view" but the lookup asks for "screen" — cv is null'
    : "";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>One-Shot Raycaster — ${model} s${sampleIndex}</title>
<style>
html,body{margin:0;height:100%;background:#06060c;overflow:hidden}
#${canvasId}{display:block}
#minimap{position:fixed;top:12px;right:12px;background:#000;border:2px solid #e8e8f2}
#hud{position:fixed;left:12px;bottom:12px;color:#f4f4fa;background:#0d0d15;font:14px/1.4 monospace;padding:6px 10px;border:1px solid #3a3a4a}
</style>
</head>
<body>
<canvas id="${canvasId}" width="960" height="600"></canvas>
<canvas id="minimap" width="96" height="72"></canvas>
<div id="hud">WASD move · A/D turn · ${model} · sample ${sampleIndex}</div>
<script>
"use strict";
// deterministic mock artifact — ${model} sample ${sampleIndex} · palette hue ${hue} · seed ${seed}
var MAP=[[1,1,1,1,1,1,1,1],[1,0,0,0,0,0,0,1],[1,0,1,0,0,1,0,1],[1,0,0,0,1,0,0,1],[1,0,0,0,0,0,0,1],[1,1,1,1,1,1,1,1]];
var cv=document.getElementById('screen');
var ctx=cv.getContext('2d');${bugComment}
var mm=document.getElementById('minimap');
var mctx=mm.getContext('2d');
var px=1.5,py=1.5,pa=0.7,keys={};
addEventListener('keydown',function(e){keys[e.key.toLowerCase()]=true;});
addEventListener('keyup',function(e){keys[e.key.toLowerCase()]=false;});
function fit(){cv.width=innerWidth;cv.height=innerHeight;}
addEventListener('resize',fit);
fit();
function wall(x,y){var r=MAP[y|0];return r?(r[x|0]||0):1;}
function cast(a){var d=0,x=px,y=py;while(d<10){x+=Math.cos(a)*0.02;y+=Math.sin(a)*0.02;d+=0.02;if(wall(x,y)===1){var fx=x%1;return{d:d,side:(fx<0.05||fx>0.95)?1:0,tx:((x+y)*6)%1};}}return{d:10,side:0,tx:0};}
function frame(){
var sp=0.05;
if(keys.w){px+=Math.cos(pa)*sp;py+=Math.sin(pa)*sp;}
if(keys.s){px-=Math.cos(pa)*sp;py-=Math.sin(pa)*sp;}
if(keys.a){pa-=0.06;}
if(keys.d){pa+=0.06;}
pa+=0.004;
var w=cv.width,h=cv.height;
ctx.fillStyle='#0d0d16';ctx.fillRect(0,0,w,h/2);
ctx.fillStyle='#181822';ctx.fillRect(0,h/2,w,h/2);
for(var c=0;c<w;c+=2){
var ra=pa-0.5+(c/w);
var hit=cast(ra);
var cd=hit.d*Math.cos(ra-pa);
var wh=Math.min(h,h/Math.max(cd,0.1));
var sh=Math.max(12,60-hit.d*6)|0;
var tex=((hit.tx*24|0)%2)?6:0;
ctx.fillStyle='hsl(${hue},48%,'+(hit.side?(sh-8+tex):(sh+tex))+'%)';
ctx.fillRect(c,(h-wh)/2,2,wh);
}
mctx.fillStyle='#000';mctx.fillRect(0,0,96,72);
for(var my=0;my<MAP.length;my++){for(var mx=0;mx<8;mx++){if(MAP[my][mx]===1){mctx.fillStyle='hsl(${hue},40%,62%)';mctx.fillRect(mx*12,my*12,11,11);}}}
mctx.fillStyle='#fff';mctx.fillRect(px*12-2,py*12-2,4,4);
requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>`;
}

/**
 * Deterministic wrong-but-plausible value: numbers drift by +1; strings become
 * a decoy that never CONTAINS the expected answer (so `contains` fails too).
 */
export function mockWrongValue(expected: string): string {
  const n = Number(expected);
  if (expected.trim() !== "" && Number.isFinite(n)) return String(n + 1);
  return "unverified-answer";
}

/** Build {"a":{"b":value}} from dot-path "a.b" (numeric strings → numbers). */
function nestedFromPath(path: string, value: string): Record<string, unknown> {
  const n = Number(value);
  const coerced: unknown = value.trim() !== "" && Number.isFinite(n) ? n : value;
  const segments = path.split(".").filter((s) => s !== "");
  const root: Record<string, unknown> = {};
  let cursor = root;
  segments.forEach((segment, i) => {
    if (i === segments.length - 1) {
      cursor[segment] = coerced;
    } else {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
    }
  });
  return root;
}

/** Deterministic mock answer for a verified task (wrong when asked to be). */
export function buildMockVerifiedAnswer(task: Task, answerWrong: boolean): string {
  if (task.scorer === "json-field" && task.jsonField !== undefined) {
    const value = answerWrong ? mockWrongValue(task.jsonField.expected) : task.jsonField.expected;
    return (
      "```json\n" + JSON.stringify(nestedFromPath(task.jsonField.path, value), null, 2) + "\n```"
    );
  }
  const expected = task.expected ?? "";
  const answer = answerWrong ? mockWrongValue(expected) : expected;
  // contains: realistic prose around the answer; exact-match: verbatim echo
  return task.scorer === "contains" ? `Answer: ${answer}` : answer;
}

export class MockProvider implements Provider {
  readonly kind = "mock" as const;
  private readonly chunkDelayMs: number;
  private readonly chunkCount: number;

  constructor(opts: MockProviderOptions = {}) {
    this.chunkDelayMs = opts.chunkDelayMs ?? 40;
    this.chunkCount = opts.chunkCount ?? 50;
  }

  async *generate(req: GenerateRequest): AsyncGenerator<ProviderChunk, void, void> {
    // verified-task path: short deterministic answer, ~12 chunks (~0.5s)
    const text =
      req.task !== undefined
        ? buildMockVerifiedAnswer(req.task, req.answerWrong === true)
        : buildMockRaycasterHtml(req.model, req.sampleIndex ?? 1, req.injectFailure === true);
    const chunks = req.task !== undefined ? Math.min(12, this.chunkCount) : this.chunkCount;
    const chunkSize = Math.max(1, Math.ceil(text.length / chunks));
    for (let i = 0; i < text.length; i += chunkSize) {
      await sleep(this.chunkDelayMs, req.signal);
      yield { type: "delta", text: text.slice(i, i + chunkSize) };
    }
    yield { type: "usage", tokensIn: approxTokens(req.prompt), tokensOut: approxTokens(text) };
  }
}
