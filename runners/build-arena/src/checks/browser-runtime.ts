import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import manifest from "../../browser-runtime.json" with { type: "json" };

export const BROWSER_RUNTIME = manifest;

export function browserRuntimeInstallation() {
  const platform = `${process.platform}-${process.arch}`;
  const spec = manifest.platforms[platform as keyof typeof manifest.platforms];
  if (spec === undefined) {
    throw new Error(
      `No verified browser archive for ${platform}; see the supported-platform matrix`,
    );
  }
  const playwrightCache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const configuredCache =
    process.env.MODEL_LAB_BROWSER_CACHE ||
    (playwrightCache && playwrightCache !== "0" ? playwrightCache : "");
  if (configuredCache && !isAbsolute(configuredCache)) {
    throw new Error("MODEL_LAB_BROWSER_CACHE / PLAYWRIGHT_BROWSERS_PATH must be an absolute path");
  }
  const cache = resolve(
    configuredCache ||
      join(
        process.platform === "win32"
          ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
          : process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
        "model-lab-browser",
      ),
  );
  const directory = join(cache, manifest.version, platform);
  return { ...spec, platform, cache, directory, executablePath: join(directory, spec.executable) };
}

export function artifactBrowserExecutable(): string {
  const override = process.env.MODEL_LAB_BROWSER_EXECUTABLE;
  if (override) {
    if (!isAbsolute(override))
      throw new Error("MODEL_LAB_BROWSER_EXECUTABLE must be an absolute path");
    return override;
  }
  return browserRuntimeInstallation().executablePath;
}

export function supportedBrowserVersion(version: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split(".").map(Number);
  const minimum = manifest.minimumVersion.split(".").map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] !== minimum[index]) return actual[index]! > minimum[index]!;
  }
  return true;
}
