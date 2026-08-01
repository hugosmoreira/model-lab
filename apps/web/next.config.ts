import path from "node:path";
import type { NextConfig } from "next";

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
