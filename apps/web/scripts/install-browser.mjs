import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import {
  BROWSER_RUNTIME,
  browserRuntimeInstallation,
} from "../../../runners/build-arena/src/checks/browser-runtime.ts";

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 750 * 1024 * 1024;
const MAX_FILES = 2_000;

export function browserArchiveEntries(bytes, expectedHash) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Browser archive is too large");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHash) throw new Error("Browser archive SHA-256 mismatch");
  let count = 0;
  let expanded = 0;
  return unzipSync(bytes, {
    filter(entry) {
      count += 1;
      expanded += entry.originalSize;
      const segments = entry.name.split("/");
      if (
        isAbsolute(entry.name) ||
        /[\\:\u0000]/.test(entry.name) ||
        segments.some((part) => part === ".." || part === ".") ||
        !segments[0]?.startsWith("chrome-headless-shell-")
      )
        throw new Error("Unsafe browser archive path");
      if (count > MAX_FILES || expanded > MAX_EXPANDED_BYTES) {
        throw new Error("Browser archive extraction limit exceeded");
      }
      return true;
    },
  });
}

async function downloadArchive(url) {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://storage.googleapis.com" ||
    !parsed.pathname.startsWith("/chrome-for-testing-public/")
  ) {
    throw new Error("Browser download must use the pinned official archive host");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!response.ok || !response.body)
    throw new Error(`Browser download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) {
    await response.body.cancel();
    throw new Error("Browser archive is too large");
  }
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) throw new Error("Browser archive is too large");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function installBrowser() {
  const spec = browserRuntimeInstallation();
  const marker = join(spec.directory, ".model-lab-browser.json");
  try {
    const installed = JSON.parse(await readFile(marker, "utf8"));
    if (
      installed.version === BROWSER_RUNTIME.version &&
      installed.sha256 === spec.sha256 &&
      (await stat(spec.executablePath)).isFile()
    ) {
      console.log(`Verified browser archive already installed: ${spec.executablePath}`);
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Never delete or overwrite an existing incomplete/user-owned installation.
  try {
    await stat(spec.directory);
    throw new Error(`Browser directory already exists but is not verified: ${spec.directory}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(
    `Downloading pinned Chrome Headless Shell ${BROWSER_RUNTIME.version} (${spec.platform})`,
  );
  const archive = await downloadArchive(spec.url);
  const entries = browserArchiveEntries(archive, spec.sha256);
  if (!(spec.executable in entries)) throw new Error("Browser archive has no expected executable");
  await mkdir(spec.cache, { recursive: true });
  const staging = join(spec.cache, `.model-lab-install-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const [name, data] of Object.entries(entries)) {
      const target = resolve(staging, name);
      const inside = relative(staging, target);
      if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
        throw new Error("Browser archive path escapes staging directory");
      }
      if (name.endsWith("/")) {
        await mkdir(target, { recursive: true });
      } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data, { flag: "wx", mode: 0o644 });
      }
    }
    await chmod(join(staging, spec.executable), 0o755);
    await writeFile(
      join(staging, ".model-lab-browser.json"),
      JSON.stringify({
        version: BROWSER_RUNTIME.version,
        sha256: spec.sha256,
        source: spec.url,
      }) + "\n",
      { flag: "wx" },
    );
    await mkdir(dirname(spec.directory), { recursive: true });
    await rename(staging, spec.directory);
  } catch (error) {
    // Staging was created here, under the explicitly resolved cache root.
    if (
      dirname(staging) === spec.cache &&
      staging.startsWith(join(spec.cache, ".model-lab-install-"))
    ) {
      await rm(staging, { recursive: true, force: true });
    }
    throw error;
  }
  console.log(`Installed pinned browser: ${spec.executablePath}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await installBrowser();
}
