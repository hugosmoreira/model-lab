/**
 * Store conformance — runs the backend-agnostic suite (src/conformance.ts)
 * against the memory store and a throwaway SQLite file, then re-opens the
 * SQLite file to prove the suite stays green on persisted state.
 *
 * Supabase satisfies the same suite but needs credentials, so it is not run
 * here; point `runStoreConformance` at a configured SupabaseStore locally
 * when touching packages/store/src/supabase.ts (see docs/SUPABASE_SETUP.md).
 *
 * Run with:  pnpm --filter @model-lab/store test
 *   (node's built-in type-stripping + test/ts-resolve.mjs — no install needed)
 */
import { register } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

register("./ts-resolve.mjs", import.meta.url);

const { MemoryStore, SqliteStore, runStoreConformance } = await import("../src/index.ts");

const lines = [];
let failed = false;

async function run(label, make) {
  try {
    const store = await make();
    const passed = await runStoreConformance(store);
    lines.push(`  PASS  ${label} — ${passed} assertions`);
  } catch (err) {
    failed = true;
    lines.push(`  FAIL  ${label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "model-lab-store-"));
try {
  await run("memory", async () => new MemoryStore());
  const file = path.join(tmp, "conformance.db");
  await run("sqlite (fresh file)", async () => new SqliteStore(file));
  await run("sqlite (reopened, persisted state)", async () => new SqliteStore(file));
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the sqlite handle may outlive us on Windows; the temp dir is disposable */
  }
}

console.log("");
console.log("STORE CONFORMANCE");
for (const line of lines) console.log(line);
console.log(failed ? "STORE CONFORMANCE FAIL" : "STORE CONFORMANCE PASS");
process.exit(failed ? 1 : 0);
