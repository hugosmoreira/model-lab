/** Single-host cross-process admission, including memory-metadata installations.
 * SQLite transactions serialize both acquisition and dead-owner reclamation.
 * A live or uncertain PID is never evicted because its heartbeat is old.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WORKLOAD_LIMITS } from "./workload";

export const ADMISSION_STALE_MS = 30_000;
const PROCESS_KEY = Symbol.for("model-lab.admission-process");
const state = globalThis as typeof globalThis & { [PROCESS_KEY]?: string };
const processToken = (state[PROCESS_KEY] ??= randomUUID());

export class RunCapacityError extends Error {
  constructor() {
    super(
      `This data directory already has ${WORKLOAD_LIMITS.activeRuns} active runs. Wait for a run to finish or cancel one before starting another.`,
    );
    this.name = "RunCapacityError";
  }
}

interface Owner {
  token: string;
  pid: number;
  host: string;
  process_token: string;
  heartbeat: number;
}

function stopped(owner: Owner): boolean {
  if (Date.now() - owner.heartbeat <= ADMISSION_STALE_MS) return false;
  // Like recovery leases: one host per data volume; a stale foreign hostname
  // represents host/container replacement, not a supported concurrent host.
  if (owner.host !== hostname()) return true;
  if (owner.pid === process.pid) return owner.process_token !== processToken;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function canonicalRoot(root: string): string {
  mkdirSync(root, { recursive: true });
  return realpathSync(root);
}

/** A reservation transfers once from service preparation to actual execution. */
export interface RunAdmission {
  claim(root: string): void;
  release(): void;
}

export function acquireRunAdmission(root: string): RunAdmission {
  const canonical = canonicalRoot(root);
  const db = new DatabaseSync(join(canonical, ".workload.sqlite"));
  const token = randomUUID();
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    db.exec(`CREATE TABLE IF NOT EXISTS active_runs (
      token TEXT PRIMARY KEY, pid INTEGER NOT NULL CHECK(pid > 0),
      host TEXT NOT NULL, process_token TEXT NOT NULL, heartbeat REAL NOT NULL
    )`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const owners = db.prepare("SELECT * FROM active_runs").all() as unknown as Owner[];
      const remove = db.prepare("DELETE FROM active_runs WHERE token = ?");
      for (const owner of owners) if (stopped(owner)) remove.run(owner.token);
      const count = db.prepare("SELECT COUNT(*) AS n FROM active_runs").get() as { n: number };
      if (count.n >= WORKLOAD_LIMITS.activeRuns) throw new RunCapacityError();
      db.prepare("INSERT INTO active_runs VALUES (?, ?, ?, ?, ?)").run(
        token,
        process.pid,
        hostname(),
        processToken,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }
  let released = false;
  let releaseRequested = false;
  let cleanupWarned = false;
  let claimed = false;
  function tryRelease(): void {
    if (released) return;
    try {
      db.prepare("DELETE FROM active_runs WHERE token = ?").run(token);
      db.close();
      released = true;
      clearInterval(timer);
    } catch {
      // A transient lock must not turn a completed run into a failure or
      // strand its permit while this PID remains alive. Retain the connection
      // and retry on the timer (and on explicit repeated release calls).
      if (!cleanupWarned) {
        cleanupWarned = true;
        console.warn("[model-lab] workload cleanup delayed; retrying");
      }
    }
  }
  const timer = setInterval(() => {
    if (releaseRequested) {
      tryRelease();
      return;
    }
    try {
      db.prepare("UPDATE active_runs SET heartbeat = ? WHERE token = ?").run(Date.now(), token);
    } catch {
      console.warn("[model-lab] workload heartbeat could not be persisted");
    }
  }, 5_000);
  timer.unref();
  return {
    claim(candidateRoot) {
      if (released || releaseRequested || claimed || canonicalRoot(candidateRoot) !== canonical)
        throw new Error("Invalid or already consumed run admission");
      claimed = true;
    },
    release() {
      if (released) return;
      releaseRequested = true;
      tryRelease();
    },
  };
}
