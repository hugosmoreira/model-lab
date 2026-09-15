/**
 * Local filesystem persistence for runs.
 * Root: env MODEL_LAB_DATA_DIR, else <repo>/artifacts-data (repo root found by
 * walking up to pnpm-workspace.yaml from cwd).
 *
 * Layout:
 *   artifacts/<runPrefix>/<modelShort>/raycaster[-sN].html
 *   raw/<runId>/<endpointId>/<n>.txt          (immutable, write-once)
 *   screenshots/<runPrefix>/<modelShort>-sN.png
 *   runs/<runId>/events.jsonl                 (append-only)
 *   runs/<runId>/run.json                     (snapshot, overwritten)
 *   bundles/<runId>/…                         (exportBundle output)
 *
 * SECURITY (audit §11): every externally-influenced path segment goes through
 * sanitizeSegment — strips ../, path separators, and null bytes.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { RunEvent } from "@model-lab/schemas";
import type { StoredRunResults } from "./types";

export const DATA_DIR_ENV = "MODEL_LAB_DATA_DIR";

/** Path-traversal mitigation: a segment can never escape its directory. */
export function sanitizeSegment(segment: string): string {
  const cleaned = segment
    .replace(/\0/g, "")
    .replace(/\.\./g, "")
    .replace(/[/\\:]/g, "-")
    .replace(/[^A-Za-z0-9._@-]/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "unnamed";
}

/** "anthropic/claude-sonnet-4-6@q4" → "claude-sonnet-4" (canonical truncation). */
export function shortModelName(endpointId: string): string {
  const slash = endpointId.indexOf("/");
  const tail = slash >= 0 ? endpointId.slice(slash + 1) : endpointId;
  const at = tail.indexOf("@");
  const noQuant = at >= 0 ? tail.slice(0, at) : tail;
  return sanitizeSegment(noQuant).slice(0, 16);
}

/** "run_8f3ac21e" → "8f3a" (matches the prototype's artifacts/8f3a/... paths). */
export function runPrefix(runId: string): string {
  const stripped = runId.replace(/^run_/, "");
  return sanitizeSegment((stripped.length > 0 ? stripped : runId).slice(0, 4));
}

function defaultRoot(): string {
  const env = process.env[DATA_DIR_ENV];
  if (env !== undefined && env !== "") return resolve(env);
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "artifacts-data");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), "artifacts-data");
}

function isEexist(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "EEXIST"
  );
}

export interface WrittenArtifact {
  absPath: string;
  relPath: string; // relative to store root, forward slashes
  filename: string;
  sizeKb: number;
}

export class FsRunStore {
  readonly root: string;

  constructor(root?: string) {
    this.root = root !== undefined ? resolve(root) : defaultRoot();
  }

  private ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true });
  }

  runDir(runId: string): string {
    return join(this.root, "runs", sanitizeSegment(runId));
  }

  artifactDir(runId: string, endpointId: string): string {
    return join(this.root, "artifacts", runPrefix(runId), shortModelName(endpointId));
  }

  artifactFilename(sampleIndex: number): string {
    return sampleIndex <= 1 ? "raycaster.html" : `raycaster-s${sampleIndex}.html`;
  }

  writeArtifact(
    runId: string,
    endpointId: string,
    sampleIndex: number,
    html: string,
  ): WrittenArtifact {
    const dir = this.artifactDir(runId, endpointId);
    this.ensureDir(dir);
    const filename = this.artifactFilename(sampleIndex);
    const absPath = join(dir, filename);
    writeFileSync(absPath, html, "utf8");
    const sizeKb = Math.max(1, Math.round(Buffer.byteLength(html, "utf8") / 1024));
    return {
      absPath,
      relPath: relative(this.root, absPath).split("\\").join("/"),
      filename,
      sizeKb,
    };
  }

  /** Immutable raw model output — write-once; a second write is a no-op. */
  writeRaw(runId: string, endpointId: string, sampleIndex: number, text: string): string {
    const dir = join(this.root, "raw", sanitizeSegment(runId), sanitizeSegment(endpointId));
    this.ensureDir(dir);
    const absPath = join(dir, `${Math.max(1, Math.floor(sampleIndex))}.txt`);
    try {
      writeFileSync(absPath, text, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if (!isEexist(err)) throw err;
    }
    return absPath;
  }

  screenshotPath(runId: string, endpointId: string, sampleIndex: number): string {
    const dir = join(this.root, "screenshots", runPrefix(runId));
    this.ensureDir(dir);
    return join(dir, `${shortModelName(endpointId)}-s${Math.max(1, Math.floor(sampleIndex))}.png`);
  }

  appendEvent(runId: string, event: RunEvent): void {
    const dir = this.runDir(runId);
    this.ensureDir(dir);
    appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  readEvents(runId: string): RunEvent[] {
    const file = join(this.runDir(runId), "events.jsonl");
    if (!existsSync(file)) return [];
    const events: RunEvent[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        events.push(JSON.parse(trimmed) as RunEvent);
      } catch {
        // tolerate a torn tail line from a crashed writer
      }
    }
    return events;
  }

  saveSnapshot(runId: string, snapshot: StoredRunResults): void {
    const dir = this.runDir(runId);
    this.ensureDir(dir);
    writeFileSync(join(dir, "run.json"), JSON.stringify(snapshot, null, 2), "utf8");
  }

  loadSnapshot(runId: string): StoredRunResults | null {
    const file = join(this.runDir(runId), "run.json");
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as StoredRunResults;
    } catch {
      return null;
    }
  }

  bundleDir(runId: string): string {
    return join(this.root, "bundles", sanitizeSegment(runId));
  }
}
