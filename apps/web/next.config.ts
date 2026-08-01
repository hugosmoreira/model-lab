import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Monorepo convenience: Next only auto-loads env files from apps/web, but the
 * workspace root `.env` is a natural place for shared local secrets. Merge any
 * variables not already set (apps/web/.env.local still wins). Values never
 * reach the client — nothing here is NEXT_PUBLIC_.
 */
function loadWorkspaceRootEnv(): void {
  const rootEnv = path.join(__dirname, "../../.env");
  if (!fs.existsSync(rootEnv)) return;
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] === undefined) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
    process.env[key] = value;
  }
}
loadWorkspaceRootEnv();

const nextConfig: NextConfig = {
  /* Workspace packages ship TS source (main: ./src/index.ts) — Next compiles
     them. Store + runner are imported from server code only. */
  transpilePackages: [
    "@model-lab/schemas",
    "@model-lab/store",
    "@model-lab/build-arena-runner",
  ],
  /* Playwright (dynamic import inside the runner's browser checks) must stay
     an external runtime require — bundling breaks its __dirname-relative
     browser registry lookups. */
  serverExternalPackages: ["playwright", "playwright-core"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
