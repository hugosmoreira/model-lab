/**
 * Store factory — the one entry point app code should use.
 *
 * ## Environment contract (server-side only — never `NEXT_PUBLIC_`)
 *
 * | Variable                    | Values / default                              |
 * | --------------------------- | --------------------------------------------- |
 * | `MODEL_LAB_STORE`           | `memory` (default) \| `sqlite` \| `supabase`  |
 * | `MODEL_LAB_SQLITE_PATH`     | sqlite file; default `<repo>/artifacts-data/model-lab.db` |
 * | `SUPABASE_URL`              | required when `MODEL_LAB_STORE=supabase`      |
 * | `SUPABASE_SERVICE_ROLE_KEY` | required when `MODEL_LAB_STORE=supabase`      |
 *
 * - `memory` auto-seeds the demo scenario (`run_8f3ac21e`, completed
 *   timeline) on first access so every screen has real store data.
 * - `sqlite` / `supabase` persist across restarts and are NOT auto-seeded;
 *   call `store.seedDemo(demoFixtures())` explicitly when demo data is wanted.
 *
 * The singleton is cached on `globalThis` (keyed by backend) so Next.js dev
 * hot-reloads reuse one instance; `getStore()` returns a shared promise so
 * concurrent first callers all await the same construction + seed.
 */
import { demoFixtures } from "./demo";
import { MemoryStore } from "./memory";
import { SqliteStore } from "./sqlite";
import { SupabaseStore } from "./supabase";
import { StoreError, type RunStore } from "./types";

export type StoreBackend = "memory" | "sqlite" | "supabase";

const GLOBAL_KEY = Symbol.for("model-lab.store.singleton");

interface CachedStore {
  backend: StoreBackend;
  promise: Promise<RunStore>;
}

/** Reads MODEL_LAB_STORE; throws StoreError("CONFIG") on unknown values. */
export function resolveBackend(): StoreBackend {
  const raw = (process.env.MODEL_LAB_STORE ?? "memory").toLowerCase().trim();
  if (raw === "" || raw === "memory") return "memory";
  if (raw === "sqlite" || raw === "supabase") return raw;
  throw new StoreError(
    "CONFIG",
    `MODEL_LAB_STORE="${raw}" is invalid — use "memory" | "sqlite" | "supabase"`,
  );
}

async function construct(backend: StoreBackend): Promise<RunStore> {
  switch (backend) {
    case "memory": {
      const store = new MemoryStore();
      await store.seedDemo(demoFixtures());
      return store;
    }
    case "sqlite":
      return new SqliteStore();
    case "supabase":
      return new SupabaseStore();
  }
}

/**
 * Returns the process-wide store singleton for the backend selected by
 * `MODEL_LAB_STORE`. Safe to call from any server module; concurrent callers
 * share one construction.
 */
export function getStore(): Promise<RunStore> {
  const backend = resolveBackend();
  const g = globalThis as { [GLOBAL_KEY]?: CachedStore };
  const cached = g[GLOBAL_KEY];
  if (cached && cached.backend === backend) return cached.promise;
  const promise = construct(backend).catch((err: unknown) => {
    resetStore(); // do not cache a failed construction
    throw err;
  });
  g[GLOBAL_KEY] = { backend, promise };
  return promise;
}

/** Drops the cached singleton (tests / backend switches). */
export function resetStore(): void {
  delete (globalThis as { [GLOBAL_KEY]?: CachedStore })[GLOBAL_KEY];
}
