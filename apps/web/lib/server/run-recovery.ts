/**
 * Single-host SQLite ownership records, shared by CLI and web processes.
 * Records live beside the database, so an alternate artifact directory cannot
 * hide a live CLI owner from the web app. Network-shared, multi-host SQLite is
 * not supported. A stale record from another hostname means container/host
 * replacement or restore under this deployment contract.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { SqliteStore, type RunStore } from "@model-lab/store";

export const RUN_LEASE_HEARTBEAT_MS = 5_000;
export const RUN_LEASE_STALE_MS = 30_000;

const PROCESS_KEY = Symbol.for("model-lab.run-owner-process");
const runtime = globalThis as typeof globalThis & { [PROCESS_KEY]?: string };
const PROCESS_TOKEN = (runtime[PROCESS_KEY] ??= randomUUID());
const inFlight = new WeakMap<RunStore, Promise<RecoveryReport>>();
const warned = new Set<string>();

export interface RunOwner {
  version: 1;
  ownerToken: string;
  processToken: string;
  pid: number;
  hostname: string;
  heartbeatAt: number;
}

export interface RecoveryOptions {
  /** Explicit roots are useful for isolated tests; production uses the SQLite path. */
  ownerRoot?: string;
  now?: () => number;
  hostname?: string;
  pid?: number;
  processToken?: string;
  processAlive?: (pid: number) => boolean | null;
  heartbeatMs?: number;
}

export interface RecoveryReport {
  recovered: string[];
  uncertain: { runId: string; reason: string }[];
}

function ownerRoot(store: RunStore, options: RecoveryOptions): string | null {
  if (options.ownerRoot !== undefined) return options.ownerRoot;
  return store instanceof SqliteStore ? `${store.databasePath}.owners` : null;
}

function ownerFile(root: string, runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new Error("Invalid run owner identity");
  return join(root, `${runId}.json`);
}

function readOwner(file: string): RunOwner | null {
  try {
    if (statSync(file).size > 2_048) return null;
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<RunOwner>;
    if (
      value.version !== 1 ||
      typeof value.ownerToken !== "string" ||
      typeof value.processToken !== "string" ||
      typeof value.hostname !== "string" ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid ?? 0) < 1 ||
      typeof value.heartbeatAt !== "number" ||
      !Number.isFinite(value.heartbeatAt)
    ) {
      return null;
    }
    return value as RunOwner;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean | null {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH" ? false : null;
  }
}

/** Fresh leases and uncertain process identities never authorize recovery. */
export function ownerHasStopped(owner: RunOwner, options: RecoveryOptions = {}): boolean {
  const now = (options.now ?? Date.now)();
  if (now - owner.heartbeatAt <= RUN_LEASE_STALE_MS) return false;
  const host = options.hostname ?? hostname();
  if (owner.hostname !== host) return true;
  const pid = options.pid ?? process.pid;
  const token = options.processToken ?? PROCESS_TOKEN;
  if (owner.pid === pid) return owner.processToken !== token;
  return (options.processAlive ?? processAlive)(owner.pid) === false;
}

function ownIdentity(options: RecoveryOptions): RunOwner {
  return {
    version: 1,
    ownerToken: randomUUID(),
    processToken: options.processToken ?? PROCESS_TOKEN,
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? hostname(),
    heartbeatAt: (options.now ?? Date.now)(),
  };
}

export interface RunLease {
  refresh(): void;
  /** Stop refreshing but retain ownership evidence when persistence fails. */
  stop(): void;
  release(): void;
}

/** Acquire before publishing the running row, and keep it until persistence finishes. */
export function acquireRunLease(
  store: RunStore,
  runId: string,
  options: RecoveryOptions = {},
): RunLease | null {
  const root = ownerRoot(store, options);
  if (root === null) return null;
  mkdirSync(root, { recursive: true });
  const file = ownerFile(root, runId);
  const owner = ownIdentity(options);
  writeFileSync(file, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  let released = false;
  function refresh(): void {
    if (released || readOwner(file)?.ownerToken !== owner.ownerToken) return;
    owner.heartbeatAt = (options.now ?? Date.now)();
    const temp = `${file}.${owner.ownerToken}.tmp`;
    writeFileSync(temp, JSON.stringify(owner), { mode: 0o600 });
    renameSync(temp, file);
  }
  const timer = setInterval(() => {
    try {
      refresh();
    } catch {
      // Same-host PID checks still protect a running process from a missed
      // heartbeat; make filesystem failures visible without logging secrets.
      console.warn("[model-lab] run owner heartbeat could not be persisted:", runId);
    }
  }, options.heartbeatMs ?? RUN_LEASE_HEARTBEAT_MS);
  timer.unref();
  return {
    refresh,
    stop() {
      released = true;
      clearInterval(timer);
    },
    release() {
      released = true;
      clearInterval(timer);
      if (readOwner(file)?.ownerToken === owner.ownerToken) unlinkSync(file);
    },
  };
}

function acquireRecoveryLock(file: string, options: RecoveryOptions): (() => void) | null {
  const lock = `${file}.recovery`;
  const identity = ownIdentity(options);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lock, JSON.stringify(identity), { flag: "wx", mode: 0o600 });
      return () => {
        if (readOwner(lock)?.ownerToken === identity.ownerToken) unlinkSync(lock);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const previous = readOwner(lock);
      if (attempt !== 0 || previous === null || !ownerHasStopped(previous, options)) return null;
      unlinkSync(lock);
    }
  }
  return null;
}

/**
 * Preserve evidence, mark interrupted work partial, and never resume a provider
 * call. Old/invalid records without ownership evidence remain visible as
 * uncertain; absence of a file is not proof that a legacy writer has stopped.
 */
export function reconcileInterruptedRuns(
  store: RunStore,
  options: RecoveryOptions = {},
): Promise<RecoveryReport> {
  const existing = inFlight.get(store);
  if (existing !== undefined) return existing;
  const result = reconcile(store, options).finally(() => inFlight.delete(store));
  inFlight.set(store, result);
  return result;
}

async function reconcile(store: RunStore, options: RecoveryOptions): Promise<RecoveryReport> {
  const report: RecoveryReport = { recovered: [], uncertain: [] };
  const root = ownerRoot(store, options);
  if (root === null) return report;
  for (const run of await store.listRuns()) {
    if (run.status !== "running" && run.status !== "queued" && run.status !== "paused") continue;
    const file = ownerFile(root, run.id);
    const owner = readOwner(file);
    if (owner === null) {
      const reason =
        "No valid ownership record; verify any legacy writer before resolving this run.";
      report.uncertain.push({ runId: run.id, reason });
      if (!warned.has(run.id)) {
        warned.add(run.id);
        console.warn("[model-lab] recovery uncertain:", run.id, reason);
      }
      continue;
    }
    if (!ownerHasStopped(owner, options)) continue;
    const releaseLock = acquireRecoveryLock(file, options);
    if (releaseLock === null) continue;
    try {
      const currentOwner = readOwner(file);
      if (currentOwner?.ownerToken !== owner.ownerToken || !ownerHasStopped(currentOwner, options))
        continue;
      const current = await store.getRun(run.id);
      if (current === null || !["running", "queued", "paused"].includes(current.run.status))
        continue;
      const now = (options.now ?? Date.now)();
      const completedAt = new Date(now).toISOString();
      const narrative =
        "The process that owned this run stopped before terminal persistence. Recorded evidence is preserved; no provider calls were replayed.";
      await store.updateRunStatus(run.id, {
        status: "partial",
        completedAt,
        elapsedSec: Math.max(0, (now - Date.parse(run.startedAt)) / 1_000),
        verdict: { label: "Interrupted", narrative },
      });
      await store.appendEvent({
        t: completedAt,
        type: "run.partial",
        runId: run.id,
        endpointId: null,
        sampleIndex: null,
        level: "warn",
        message: narrative,
        payload: { reason: "owner_process_stopped", replayed: false },
      });
      // Only the same dead owner may be removed. Another owner is never
      // deleted merely because a previous recovery attempt began first.
      if (readOwner(file)?.ownerToken === owner.ownerToken) unlinkSync(file);
      report.recovered.push(run.id);
    } finally {
      releaseLock();
    }
  }
  return report;
}
