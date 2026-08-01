/**
 * # @model-lab/store — persistence layer for Model Lab
 *
 * SERVER-SIDE ONLY. Never import this package from a client component: it
 * reads `process.env`, opens `node:sqlite` databases, and holds the Supabase
 * service-role key. No `NEXT_PUBLIC_` variable exists anywhere in it.
 *
 * ## Usage
 *
 * ```ts
 * import { getStore } from "@model-lab/store";
 * const store = await getStore();          // singleton, backend from env
 * const runs = await store.listRuns();
 * ```
 *
 * ## Environment contract
 *
 * - `MODEL_LAB_STORE` — `memory` (default) | `sqlite` | `supabase`
 *   - `memory`: Maps, auto-seeds the demo scenario (run_8f3ac21e, completed
 *     timeline) on first access.
 *   - `sqlite`: Node 22 built-in `node:sqlite`; file from
 *     `MODEL_LAB_SQLITE_PATH` (default `<repo>/artifacts-data/model-lab.db`).
 *   - `supabase`: needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 *     (service-role, server-only — see docs/SUPABASE_SETUP.md); schema is
 *     supabase/migrations/0001_init.sql.
 *
 * ## Invariants
 *
 * - `samples` / `artifacts` / `run_events` are INSERT-only; a sample becomes
 *   immutable once 'scored' or 'failed' (StoreError("IMMUTABLE")).
 * - Score corrections go through the append-only annotations stream.
 * - All three backends satisfy the same `RunStore` interface and pass
 *   `runStoreConformance`.
 */
export {
  StoreError,
  type RunStatusPatch,
  type RunStore,
  type RunWithConfig,
  type SeedFixtures,
  type StoreErrorCode,
  type StoredRunEvent,
} from "./types";
export { MemoryStore } from "./memory";
export { SqliteStore, defaultSqlitePath } from "./sqlite";
export { SupabaseStore, type SupabaseStoreOptions } from "./supabase";
export { getStore, resetStore, resolveBackend, type StoreBackend } from "./factory";
export { demoFixtures } from "./demo";
export { runStoreConformance } from "./conformance";
