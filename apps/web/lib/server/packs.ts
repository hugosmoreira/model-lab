/**
 * Disk-backed benchmark-pack registry (Phase 5 native slice).
 *
 * SERVER-ONLY — reads benchmark-packs/<slug>/pack.json from the repo root
 * (found by walking up to pnpm-workspace.yaml). Both on-disk packs load
 * through here: raycaster-oneshot (build-arena, prompt-only) and
 * structured-json-mini (eval, objective task list).
 *
 * SECURITY: the slug is externally influenced (POST /api/runs body) — it is
 * validated against a strict allowlist pattern before touching the filesystem,
 * so it can never traverse out of benchmark-packs/.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Task } from "@model-lab/build-arena-runner";

const DiskTask = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  expected: z.string().optional(),
  scorer: z.enum(["exact-match", "contains", "json-field"]),
  jsonField: z.object({ path: z.string().min(1), expected: z.string() }).optional(),
});

const DiskPack = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(["build-arena", "eval"]),
  prompt: z.string().optional(),
  browserCheckCount: z.number().optional(),
  estOutputTokensPerModel: z.number().optional(),
  estOutputTokensPerTask: z.number().optional(),
  scorer: z.string().optional(),
  description: z.string().optional(),
  license: z.string(),
  tasks: z.array(DiskTask).optional(),
});
export type DiskPack = z.infer<typeof DiskPack>;

/** Lowercase kebab slugs only — anything else never reaches the filesystem. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Load one pack definition from disk. Returns null for invalid slugs, missing
 * files, unparseable JSON, or a pack.json whose slug does not match its
 * directory — callers treat null as "no native pack".
 */
export function loadPackFromDisk(slug: string): DiskPack | null {
  if (!SLUG_PATTERN.test(slug)) return null;
  const file = join(repoRoot(), "benchmark-packs", slug, "pack.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = DiskPack.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success || parsed.data.slug !== slug) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Disk tasks → runner Task[] (optional fields only set when present). */
export function tasksForPack(pack: DiskPack): Task[] {
  return (pack.tasks ?? []).map((t) => ({
    id: t.id,
    prompt: t.prompt,
    scorer: t.scorer,
    ...(t.expected !== undefined ? { expected: t.expected } : {}),
    ...(t.jsonField !== undefined ? { jsonField: t.jsonField } : {}),
  }));
}
