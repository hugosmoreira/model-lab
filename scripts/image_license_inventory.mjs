/** Describe license metadata and retained notices in the actual Linux image. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const noticePattern = /^(licen[cs]e|copying|copyright|notice)([.-]|$)/i;
const packages = new Map();

function notice(path) {
  return {
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function addPackage(path) {
  const manifest = join(path, "package.json");
  if (!existsSync(manifest)) return;
  const resolved = realpathSync(path);
  if (packages.has(resolved)) return;
  const data = JSON.parse(readFileSync(manifest, "utf8"));
  const notices = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && noticePattern.test(entry.name))
    .map((entry) => notice(join(resolved, entry.name)));
  packages.set(resolved, {
    name: data.name ?? basename(path),
    version: data.version ?? null,
    license: data.license ?? data.licenses ?? null,
    path: relative(root, resolved),
    notices,
  });
}

for (const entry of readdirSync(join(root, "node_modules/.pnpm"), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const modules = join(root, "node_modules/.pnpm", entry.name, "node_modules");
  if (!existsSync(modules)) continue;
  for (const child of readdirSync(modules)) {
    const path = join(modules, child);
    if (!existsSync(path) || child === ".bin") continue;
    if (child.startsWith("@")) {
      for (const scoped of readdirSync(path)) addPackage(join(path, scoped));
    } else addPackage(path);
  }
}

const systemNotices = [];
if (existsSync("/usr/share/doc")) {
  for (const directory of readdirSync("/usr/share/doc")) {
    const path = join("/usr/share/doc", directory, "copyright");
    if (existsSync(path)) systemNotices.push(notice(path));
  }
}
const runtimeNotices = [];
if (existsSync("/usr/local/LICENSE")) runtimeNotices.push(notice("/usr/local/LICENSE"));
function browserNotices(directory, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && noticePattern.test(entry.name)) runtimeNotices.push(notice(path));
    if (entry.isDirectory()) browserNotices(path, depth + 1);
  }
}
browserNotices("/ms-playwright");
const supplementalNotices = [];
function supplementalFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile()) supplementalNotices.push(notice(path));
    if (entry.isDirectory()) supplementalFiles(path);
  }
}
supplementalFiles(join(root, "licenses"));
if (existsSync(join(root, "THIRD_PARTY_NOTICES.md"))) {
  supplementalNotices.push(notice(join(root, "THIRD_PARTY_NOTICES.md")));
}
const list = [...packages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
process.stdout.write(
  JSON.stringify(
    {
      scope: "Installed pnpm workspace packages in this image; metadata is not a legal review",
      node: process.version,
      packages: list,
      packagesWithoutRootNotice: list
        .filter((pkg) => pkg.notices.length === 0)
        .map((pkg) => `${pkg.name}@${pkg.version}`),
      systemNotices,
      runtimeNotices,
      supplementalNotices,
    },
    null,
    2,
  ) + "\n",
);
