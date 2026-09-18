import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const loader = fileURLToPath(new URL("../scripts/load-env.cjs", import.meta.url));

function loadFixture(mode) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-env-test-"));
  const app = join(root, "apps", "web");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(
    join(root, ".env"),
    'ML_ENV_SHELL=root\nML_ENV_APP=root\nML_ENV_ROOT="root # value"\nML_ENV_COMMENT=plain # comment\nML_ENV_EMPTY=root\n',
  );
  writeFileSync(join(app, ".env"), "ML_ENV_APP=app\nML_ENV_BASE=app-base\n");
  writeFileSync(
    join(app, ".env.local"),
    "ML_ENV_SHELL=app-local\nML_ENV_APP=local\nML_ENV_LOCAL=local\nML_ENV_EMPTY=\n",
  );
  for (const envMode of ["development", "production", "test"]) {
    writeFileSync(join(app, `.env.${envMode}`), `ML_ENV_APP=${envMode}\n`);
    writeFileSync(
      join(app, `.env.${envMode}.local`),
      `ML_ENV_APP=${envMode}-local\nML_ENV_EXPANDED=$ML_ENV_APP/expanded\n`,
    );
  }
  const childEnv = { ...process.env, ML_ENV_SHELL: "shell" };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("ML_ENV_") && key !== "ML_ENV_SHELL") delete childEnv[key];
  }
  // The parent may be Next or a test runner: none of its dotenv state should
  // suppress the isolated child's synthetic fixture.
  delete childEnv.__NEXT_PROCESSED_ENV;
  delete childEnv.NODE_ENV;
  if (mode !== undefined) childEnv.NODE_ENV = mode;
  try {
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(loader)}).loadWorkspaceEnvironment(); console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('ML_ENV_')))))`,
      ],
      { cwd: app, env: childEnv, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout.trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI/web env: shell, app mode/local files and root fallback precedence", () => {
  for (const mode of [undefined, "development", "production"]) {
    const env = loadFixture(mode);
    const expectedMode = mode ?? "development";
    assert.equal(env.ML_ENV_SHELL, "shell");
    assert.equal(env.ML_ENV_APP, `${expectedMode}-local`);
    assert.equal(env.ML_ENV_EXPANDED, `${expectedMode}-local/expanded`);
    assert.equal(env.ML_ENV_LOCAL, "local");
    assert.equal(env.ML_ENV_BASE, "app-base");
    assert.equal(env.ML_ENV_ROOT, "root # value");
    assert.equal(env.ML_ENV_COMMENT, "plain");
    assert.equal(env.ML_ENV_EMPTY, "", "intentional app empty value must override root");
  }
});

test("CLI/web env: test mode skips app .env.local just as Next does", () => {
  const env = loadFixture("test");
  assert.equal(env.ML_ENV_APP, "test-local");
  assert.equal(env.ML_ENV_LOCAL, undefined);
  assert.equal(env.ML_ENV_EMPTY, "root");
});
