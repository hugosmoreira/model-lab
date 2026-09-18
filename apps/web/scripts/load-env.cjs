/** Shared startup environment for Next and the CLI. Never import from client code. */
/* eslint-disable @typescript-eslint/no-require-imports -- This module is shared with Next's CommonJS config loader. */
const { existsSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { parseEnv } = require("node:util");

// Resolve the env loader through the installed Next version so CLI and Next use
// exactly the same app dotenv precedence, quoting and variable expansion.
const nextRequire = createRequire(require.resolve("next/package.json"));
const { loadEnvConfig } = nextRequire("@next/env");

/** @param {string} [startDir] */
function findWorkspaceRoot(startDir = process.cwd()) {
  let dir = startDir;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Cannot find the Model Lab workspace root");
    dir = parent;
  }
  return dir;
}

/**
 * Shell values win, followed by Next's app env files, then root `.env` fallbacks.
 * Root fallbacks use Node's dotenv grammar (quotes, comments and multiline
 * values); Next variable expansion applies only to the app's env files.
 *
 * @param {{ workspaceRoot?: string, dev?: boolean }} [options]
 */
function loadWorkspaceEnvironment(options = {}) {
  const root = options.workspaceRoot ?? findWorkspaceRoot();
  const dev = options.dev ?? process.env.NODE_ENV !== "production";
  loadEnvConfig(join(root, "apps", "web"), dev);
  const rootEnv = join(root, ".env");
  if (!existsSync(rootEnv)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = { findWorkspaceRoot, loadWorkspaceEnvironment };
