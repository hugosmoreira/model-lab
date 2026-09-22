import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function binding(script, extra = [], temporaryRoot = tmpdir()) {
  const fixture = mkdtempSync(join(temporaryRoot, "model-lab-listener-test-"));
  const probe = join(fixture, "socket-probe.mjs");
  // Next dev loads config before listening and searches ancestor directories.
  // Stop that search here, even when TEMP is inside an operator's checkout.
  writeFileSync(join(fixture, "next.config.mjs"), "export default {};\n");
  // Observe the actual OS socket in this isolated, empty application fixture.
  // The fixture has no credentials, build output or provider code.
  // This hook neither supplies nor modifies the hostname passed to listen().
  writeFileSync(
    probe,
    `import { writeSync } from 'node:fs';
import { Server } from 'node:net';
import { Server as HttpServer } from 'node:http';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (this instanceof HttpServer) {
    this.prependOnceListener('listening', () => {
      writeSync(1, 'SOCKET_PROBE=' + JSON.stringify(this.address()) + '\\n');
      // Exit synchronously before Next's later listeners load application config.
      process.exit(0);
    });
  }
  return listen.apply(this, args);
};
setTimeout(() => process.exit(91), 8000).unref();
`,
  );
  // Explicit allowlist: do not inherit provider keys or an operator's NODE_OPTIONS.
  const env = {};
  for (const name of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    HOME: fixture,
    USERPROFILE: fixture,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(probe).href}`,
  });
  const [executable, ...args] = script.split(/\s+/);
  assert.equal(executable, "next", "Review the socket test if the server launcher changes");
  try {
    const child = spawnSync(process.execPath, [nextCli, ...args, "--port", "0", ...extra], {
      cwd: fixture,
      env,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const match = child.stdout.match(/^SOCKET_PROBE=(.+)$/m);
    assert.ok(match, `Next did not expose a socket observation: ${child.stdout}`);
    return JSON.parse(match[1]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("listener probe never loads an ancestor Next configuration", () => {
  const parent = mkdtempSync(join(tmpdir(), "model-lab-listener-parent-"));
  writeFileSync(join(parent, "next.config.mjs"), 'throw new Error("ANCESTOR_CONFIG_LOADED");\n');
  try {
    for (const command of ["dev", "start"]) {
      assert.equal(binding(scripts[command], [], parent).address, "127.0.0.1");
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

for (const command of ["dev", "start"]) {
  test(`actual Next ${command} defaults to a loopback-only socket`, () => {
    const socket = binding(scripts[command]);
    assert.equal(socket.address, "127.0.0.1");
    assert.equal(socket.family, "IPv4");
    assert.ok(socket.port > 0);
  });

  test(`actual Next ${command} retains explicit operator hostname opt-in`, () => {
    assert.equal(binding(scripts[command], ["--hostname", "0.0.0.0"]).address, "0.0.0.0");
  });
}
