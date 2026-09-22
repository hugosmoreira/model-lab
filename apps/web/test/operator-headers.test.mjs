import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);

test("Next loads operator protection headers for pages, APIs and downloads", () => {
  const root = mkdtempSync(join(tmpdir(), "model-lab-headers-"));
  const app = join(root, "apps", "web");
  mkdirSync(join(app, "scripts"), { recursive: true });
  // Strip only types in the fixture, avoiding Next's automatic dependency
  // installation for a TypeScript project with no fixture node_modules.
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  writeFileSync(
    join(app, "next.config.mjs"),
    `const __dirname = ${JSON.stringify(app)};\n${stripTypeScriptTypes(source)}`,
  );
  // Load the real config and real env loader against an empty synthetic root.
  // Never import the operator's config in place or inherit provider credentials.
  writeFileSync(
    join(app, "scripts", "load-env.cjs"),
    `module.exports = require(${JSON.stringify(fileURLToPath(new URL("../scripts/load-env.cjs", import.meta.url)))});`,
  );
  const env = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { HOME: root, USERPROFILE: root, NODE_ENV: "production" });
  const code = `
    const load = require(${JSON.stringify(require.resolve("next/dist/server/config"))}).default;
    const { PHASE_PRODUCTION_SERVER } = require(${JSON.stringify(require.resolve("next/constants"))});
    load(PHASE_PRODUCTION_SERVER, process.cwd()).then(async config => {
      console.log('HEADERS=' + JSON.stringify(await config.headers?.() ?? []));
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const child = spawnSync(process.execPath, ["-e", code], {
      cwd: app,
      env,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const match = child.stdout.match(/^HEADERS=(.+)$/m);
    assert.ok(match, child.stdout);
    const rules = JSON.parse(match[1]);
    const allPaths = rules.find((rule) => rule.source === "/:path*");
    assert.ok(allPaths, "Protection must cover the entire application");
    const headers = Object.fromEntries(
      allPaths.headers.map(({ key, value }) => [key.toLowerCase(), value]),
    );
    assert.match(headers["content-security-policy"], /(?:^|;)\s*frame-ancestors 'none'(?:;|$)/);
    assert.equal(headers["x-frame-options"], "DENY");
    assert.equal(headers["x-content-type-options"], "nosniff");
    assert.equal(headers["referrer-policy"], "no-referrer");
    assert.equal(
      headers["strict-transport-security"],
      undefined,
      "TLS policy belongs at the HTTPS proxy",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
