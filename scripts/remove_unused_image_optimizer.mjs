/** Build-time removal of unused native image decoders after verifying Next's config. */
import { readFileSync, readdirSync, rmSync } from "node:fs";

const config = JSON.parse(readFileSync("/app/apps/web/.next/required-server-files.json", "utf8"));
if (config.config?.images?.unoptimized !== true) {
  throw new Error("Refusing to remove Sharp while Next image optimization is enabled");
}
const store = "/app/node_modules/.pnpm";
for (const entry of readdirSync(store, { withFileTypes: true })) {
  if (entry.isDirectory() && /^(sharp@|@img\+sharp-)/.test(entry.name)) {
    rmSync(`${store}/${entry.name}`, { recursive: true });
  }
}
