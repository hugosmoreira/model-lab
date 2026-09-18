import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { browserArchiveEntries } from "../scripts/install-browser.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("browser installer verifies pinned archive hashes before extraction", () => {
  const bytes = zipSync({ "chrome-headless-shell-synthetic/browser": strToU8("synthetic") });
  assert.equal(Object.keys(browserArchiveEntries(bytes, digest(bytes))).length, 1);
  assert.throws(() => browserArchiveEntries(bytes, "0".repeat(64)), /SHA-256 mismatch/);
});

test("browser installer rejects traversal and platform-absolute archive paths", () => {
  for (const name of [
    "chrome-headless-shell-synthetic/../../outside",
    "/chrome-headless-shell-synthetic/outside",
    "C:/chrome-headless-shell-synthetic/outside",
    "chrome-headless-shell-synthetic/..\\outside",
    "unexpected-root/outside",
  ]) {
    const bytes = zipSync({ [name]: strToU8("synthetic") });
    assert.throws(() => browserArchiveEntries(bytes, digest(bytes)), /Unsafe browser archive path/);
  }
});

test("browser installer rejects excessive archive entries before unpacking", () => {
  const files = Object.fromEntries(
    Array.from({ length: 2_001 }, (_, index) => [
      `chrome-headless-shell-synthetic/${index}`,
      new Uint8Array(),
    ]),
  );
  const bytes = zipSync(files);
  assert.throws(() => browserArchiveEntries(bytes, digest(bytes)), /extraction limit exceeded/);
});
