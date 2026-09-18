/**
 * Local filesystem persistence for runs.
 * Root: env MODEL_LAB_DATA_DIR, else <repo>/artifacts-data (repo root found by
 * walking up to pnpm-workspace.yaml from cwd).
 *
 * Layout:
 *   artifacts/v2/<run identity>/<endpoint identity>/raycaster[-sN].html
 *   raw/v2/<run identity>/<endpoint identity>/<n>.txt
 *   screenshots/v2/<run identity>/<endpoint identity>/sN.png
 *   runs/v2/<run identity>/creation.json       (immutable creation config)
 *   runs/v2/<run identity>/events.jsonl        (append-only)
 *   runs/v2/<run identity>/run.json            (snapshot, overwritten)
 *   bundles/v2/<run identity>/<export id>/…    (immutable export)
 *
 * SECURITY (audit §11): every externally-influenced path segment goes through
 * sanitizeSegment — strips ../, path separators, and null bytes.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RunEvent } from "@model-lab/schemas";
import { replayConfiguration } from "./config-fingerprint";
import { captureRunCreation, type RunCreationRecord } from "./provenance";
import type { RunnerConfig, StoredRunResults } from "./types";

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

/** Readable stem plus a hash of the complete identity, before sanitization. */
export function identitySegment(identity: string): string {
  return `${sanitizeSegment(identity).slice(0, 24)}-${createHash("sha256").update(identity).digest("hex")}`;
}

function sampleNumber(sampleIndex: number): number {
  if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 1) {
    throw new Error("sample index must be a positive integer");
  }
  return sampleIndex;
}

/** Equal retry writes are harmless; replacing different evidence is an error. */
function writeOnce(file: string, content: string): void {
  try {
    writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (!isEexist(err) || readFileSync(file, "utf8") !== content) throw err;
  }
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
    return join(this.root, "runs", "v2", identitySegment(runId));
  }

  /** Compatibility reader only: new writes never use truncated/sanitized IDs. */
  private existingRunFile(runId: string, filename: string): string {
    const current = join(this.runDir(runId), filename);
    if (existsSync(current)) return current;
    return join(this.root, "runs", sanitizeSegment(runId), filename);
  }

  createRun(cfg: RunnerConfig): RunCreationRecord {
    if (this.loadSnapshot(cfg.runId) !== null) throw new Error("run identity already exists");
    const record = captureRunCreation(cfg);
    this.ensureDir(this.runDir(cfg.runId));
    // An aborted creation still owns this ID; retry with a new run ID.
    writeFileSync(join(this.runDir(cfg.runId), "creation.json"), JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    return record;
  }

  loadCreation(runId: string): RunCreationRecord | null {
    const path = join(this.runDir(runId), "creation.json");
    if (!existsSync(path)) return null;
    const record = JSON.parse(readFileSync(path, "utf8")) as RunCreationRecord;
    if (record.schemaVersion !== 1 || record.config.runId !== runId) {
      throw new Error("invalid run creation record");
    }
    return record;
  }

  artifactDir(runId: string, endpointId: string): string {
    return join(this.root, "artifacts", "v2", identitySegment(runId), identitySegment(endpointId));
  }

  artifactFilename(sampleIndex: number): string {
    return sampleNumber(sampleIndex) === 1 ? "raycaster.html" : `raycaster-s${sampleIndex}.html`;
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
    writeOnce(absPath, html);
    const sizeKb = Math.max(1, Math.round(Buffer.byteLength(html, "utf8") / 1024));
    return {
      absPath,
      relPath: relative(this.root, absPath).split("\\").join("/"),
      filename,
      sizeKb,
    };
  }

  rawPath(runId: string, endpointId: string, sampleIndex: number): string {
    return join(
      this.root,
      "raw",
      "v2",
      identitySegment(runId),
      identitySegment(endpointId),
      `${sampleNumber(sampleIndex)}.txt`,
    );
  }

  /** Read the exact sample reference, including legacy directories. */
  existingRawPath(runId: string, endpointId: string, sampleIndex: number): string | null {
    const current = this.rawPath(runId, endpointId, sampleIndex);
    if (existsSync(current)) return current;
    const legacy = join(
      this.root,
      "raw",
      sanitizeSegment(runId),
      sanitizeSegment(endpointId),
      `${sampleNumber(sampleIndex)}.txt`,
    );
    return existsSync(legacy) ? legacy : null;
  }

  /** Immutable raw model output — a different second write is rejected. */
  writeRaw(runId: string, endpointId: string, sampleIndex: number, text: string): string {
    const absPath = this.rawPath(runId, endpointId, sampleIndex);
    this.ensureDir(dirname(absPath));
    writeOnce(absPath, text);
    return absPath;
  }

  screenshotPath(runId: string, endpointId: string, sampleIndex: number): string {
    const dir = join(
      this.root,
      "screenshots",
      "v2",
      identitySegment(runId),
      identitySegment(endpointId),
    );
    this.ensureDir(dir);
    return join(dir, `s${sampleNumber(sampleIndex)}.png`);
  }

  /**
   * Resolve a recorded evidence reference under this data root. Older snapshots
   * used absolute screenshot paths; rebasing only their screenshots/ suffix lets
   * copied data volumes remain readable. Symlinks cannot escape the new root.
   */
  resolveEvidencePath(reference: string, category: "artifacts" | "screenshots" | "raw"): string {
    const normalized = reference.replace(/\\/g, "/");
    let rel = normalized;
    if (isAbsolute(reference) || /^[A-Za-z]:\//.test(normalized)) {
      const local = relative(this.root, resolve(reference));
      if (!local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local)) {
        rel = local.replace(/\\/g, "/");
      } else if (category === "screenshots") {
        const marker = `/${category}/`;
        const offset = normalized.lastIndexOf(marker);
        if (offset < 0) throw new Error("invalid legacy screenshot reference");
        rel = normalized.slice(offset + 1);
      } else {
        throw new Error("evidence reference is outside the data root");
      }
    }
    const segments = rel.split("/");
    if (segments[0] !== category || segments.some((part) => part === ".." || part === "")) {
      throw new Error("invalid evidence reference");
    }
    const result = resolve(this.root, ...segments);
    const contained = (root: string, path: string): boolean => {
      const tail = relative(root, path);
      return tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
    };
    if (!contained(this.root, result)) throw new Error("evidence reference escapes data root");
    if (existsSync(result) && !contained(realpathSync(this.root), realpathSync(result))) {
      throw new Error("evidence symlink escapes data root");
    }
    return result;
  }

  appendEvent(runId: string, event: RunEvent): void {
    const dir = this.runDir(runId);
    this.ensureDir(dir);
    appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  readEvents(runId: string): RunEvent[] {
    const current = join(this.runDir(runId), "events.jsonl");
    const legacy = join(this.root, "runs", sanitizeSegment(runId), "events.jsonl");
    // An exported legacy run can acquire new export events without hiding its
    // original log. A newly created v2 run never merges a colliding legacy ID.
    const files = this.loadCreation(runId) === null ? [legacy, current] : [current];
    const events: RunEvent[] = [];
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          const event = JSON.parse(trimmed) as RunEvent;
          if (event.runId === runId) events.push(event);
        } catch {
          // tolerate a torn tail line from a crashed writer
        }
      }
    }
    return events;
  }

  saveSnapshot(runId: string, snapshot: StoredRunResults): void {
    const dir = this.runDir(runId);
    this.ensureDir(dir);
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({ ...snapshot, config: replayConfiguration(snapshot.config).config }, null, 2),
      "utf8",
    );
  }

  loadSnapshot(runId: string): StoredRunResults | null {
    const file = this.existingRunFile(runId, "run.json");
    if (!existsSync(file)) return null;
    try {
      const snapshot = JSON.parse(readFileSync(file, "utf8")) as StoredRunResults;
      return snapshot.run.id === runId ? snapshot : null;
    } catch {
      return null;
    }
  }

  bundleDir(runId: string): string {
    return join(this.root, "bundles", "v2", identitySegment(runId));
  }
}
