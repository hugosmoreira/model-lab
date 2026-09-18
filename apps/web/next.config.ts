import path from "node:path";
import type { NextConfig } from "next";
import { loadWorkspaceEnvironment } from "./scripts/load-env.cjs";

/**
 * Monorepo convenience: Next only auto-loads env files from apps/web, but the
 * workspace root `.env` is a natural place for shared local secrets. Merge any
 * variables not already set (apps/web/.env.local still wins). Values never
 * reach the client — nothing here is NEXT_PUBLIC_.
 */
loadWorkspaceEnvironment({ workspaceRoot: path.join(__dirname, "../..") });

const nextConfig: NextConfig = {
  // Evidence images are served directly; this app has no next/image callers.
  // Keep the unused native image optimizer unavailable in every deployment.
  images: { unoptimized: true },
  /* Linting is a separate CI gate (`pnpm lint`, root eslint.config.mjs); the
     build stays a build. Next 16 drops the built-in lint step anyway. */
  eslint: { ignoreDuringBuilds: true },
  /* Workspace packages ship TS source (main: ./src/index.ts) — Next compiles
     them. Store + runner are imported from server code only. */
  transpilePackages: ["@model-lab/schemas", "@model-lab/store", "@model-lab/build-arena-runner"],
  /* Playwright (dynamic import inside the runner's browser checks) must stay
     an external runtime require — bundling breaks its __dirname-relative
     browser registry lookups. */
  serverExternalPackages: ["playwright", "playwright-core"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
