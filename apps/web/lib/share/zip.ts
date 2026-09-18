/**
 * Zip helpers for run bundles — SERVER-ONLY (node:fs).
 *
 * Built on fflate: pure JavaScript, no native code, and it only ever
 * *creates* archives here. (The previous adm-zip dependency carried an
 * unfixed extraction advisory the app could never hit, but scanners could
 * not tell.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync, type Zippable } from "fflate";

const STORED = new Set([".png", ".jpg", ".jpeg", ".zip", ".gz"]);

function levelFor(name: string): 0 | 6 {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && STORED.has(name.slice(dot).toLowerCase()) ? 0 : 6;
}

/** Zip an in-memory map of `path → content`. Paths use forward slashes. */
export function zipFiles(files: Record<string, string | Uint8Array>): Buffer {
  const entries: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    entries[name] = [bytes, { level: levelFor(name) }];
  }
  return Buffer.from(zipSync(entries));
}

/** Zip every file under `root`, entries named relative to it. */
export function zipDirectory(root: string): Buffer {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files[relative(root, full).split("\\").join("/")] = readFileSync(full);
      }
    }
  };
  walk(root);
  return zipFiles(files);
}
