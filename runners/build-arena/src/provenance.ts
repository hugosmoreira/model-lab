import { execFileSync } from "node:child_process";
import { computeFingerprint, replayConfiguration } from "./config-fingerprint";
import type { RunnerConfig } from "./types";

export interface SourceRevision {
  commit: string | null;
  dirty: boolean | null;
  source: "git" | "build-environment" | "unavailable";
}

export interface RunCreationRecord {
  schemaVersion: 1;
  createdAt: string;
  fingerprint: string;
  config: RunnerConfig;
  redactedFields: string[];
  sourceRevision: SourceRevision;
}

/** Capture once at creation, never substitute the exporter's later checkout. */
export function captureSourceRevision(cwd = process.cwd()): SourceRevision {
  const supplied = process.env["MODEL_LAB_SOURCE_REVISION"];
  if (supplied && /^[0-9a-f]{40,64}$/i.test(supplied)) {
    return {
      commit: supplied.toLowerCase(),
      dirty:
        process.env["MODEL_LAB_SOURCE_DIRTY"] === "0"
          ? false
          : process.env["MODEL_LAB_SOURCE_DIRTY"] === "1"
            ? true
            : null,
      source: "build-environment",
    };
  }
  try {
    const options = { cwd, encoding: "utf8" as const, timeout: 2_000, windowsHide: true };
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      ...options,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new Error("invalid revision");
    const dirty =
      execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        ...options,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== "";
    return { commit, dirty, source: "git" };
  } catch {
    return { commit: null, dirty: null, source: "unavailable" };
  }
}

export function captureRunCreation(cfg: RunnerConfig): RunCreationRecord {
  const safe = replayConfiguration(cfg);
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    fingerprint: computeFingerprint(safe.config),
    config: safe.config,
    redactedFields: safe.redactedFields,
    sourceRevision: captureSourceRevision(),
  };
}
